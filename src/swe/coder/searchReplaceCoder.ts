import { platform } from 'node:os';
import * as path from 'node:path';
import { getFileSystem, llms } from '#agent/agentContextLocalStorage';
import { func, funcClass } from '#functionSchema/functionDecorators';
import { logger } from '#o11y/logger';
import type { LLM, LlmMessage } from '#shared/model/llm.model';
import { user as createUserMessage, messageText } from '#shared/model/llm.model';
import type { IFileSystemService } from '#shared/services/fileSystemService';
import type { VersionControlSystem } from '#shared/services/versionControlSystem';
import { type EditBlock } from '#swe/coder/applySearchReplace';
import { EditApplier } from './EditApplier';
import type { EditSession } from './EditSession';
import { newSession } from './EditSession';
import { findOriginalUpdateBlocks } from './editBlockParser';
import type { EditHook, HookResult } from './hooks/EditHook';
import { stripQuotedWrapping } from './patchUtils'; // Updated import
import { sessionEvents } from './sessionEvents';
import { EDIT_BLOCK_PROMPTS } from './searchReplacePrompts';
import { ModuleAliasRule } from './validators/ModuleAliasRule';
import { PathExistsRule } from './validators/PathExistsRule';
import type { ValidationIssue, ValidationRule } from './validators/ValidationRule';
import { validateBlocks } from './validators/compositeValidator';
import {
	buildValidationIssuesReflection,
	buildFailedEditsReflection,
	buildHookFailureReflection,
} from './reflectionUtils';

const MAX_ATTEMPTS = 5;
const DEFAULT_FENCE_OPEN = '```';
const DEFAULT_FENCE_CLOSE = '```';
const DEFAULT_LENIENT_WHITESPACE = true;

@funcClass(__filename)
export class SearchReplaceCoder {
	private vcs: VersionControlSystem | null;
	private readonly precomputedSystemMessage: string;
	private readonly precomputedExampleMessages: LlmMessage[];

	constructor(
		private fs: IFileSystemService = getFileSystem(),
		private llm: LLM = llms().hard,
		private rules: ValidationRule[] = [new PathExistsRule(), new ModuleAliasRule()],
		private hooks: EditHook[] = [],
	) {
		this.vcs = this.fs.getVcsRoot() ? this.fs.getVcs() : null;

		const fence = this.getFence();
		const language = 'TypeScript'; // Default, can be made configurable
		const suggestShellCommands = true; // Default, can be made configurable

		let finalRemindersText = ''; // Add useLazyPrompt/useOvereagerPrompt logic if needed
		const shellCmdPromptSection = suggestShellCommands
			? EDIT_BLOCK_PROMPTS.shell_cmd_prompt.replace('{platform}', platform())
			: EDIT_BLOCK_PROMPTS.no_shell_cmd_prompt.replace('{platform}', platform());

		const mainSystemContent = EDIT_BLOCK_PROMPTS.main_system
			.replace('{language}', language)
			.replace('{final_reminders}', finalRemindersText.trim())
			.replace('{shell_cmd_prompt_section}', shellCmdPromptSection);

		const systemReminderContent = EDIT_BLOCK_PROMPTS.system_reminder
			.replace(/{fence_0}/g, fence[0])
			.replace(/{fence_1}/g, fence[1])
			.replace('{quad_backtick_reminder}', '') // Add quadBacktickReminder if needed
			.replace('{rename_with_shell_section}', suggestShellCommands ? EDIT_BLOCK_PROMPTS.rename_with_shell : '')
			.replace('{go_ahead_tip_section}', EDIT_BLOCK_PROMPTS.go_ahead_tip)
			.replace('{final_reminders}', finalRemindersText.trim())
			.replace('{shell_cmd_reminder_section}', suggestShellCommands ? EDIT_BLOCK_PROMPTS.shell_cmd_reminder : '');
		this.precomputedSystemMessage = `${mainSystemContent}\n\n${systemReminderContent}`;

		this.precomputedExampleMessages = EDIT_BLOCK_PROMPTS.example_messages_template.map((msgTemplate) => ({
			role: msgTemplate.role as 'system' | 'user' | 'assistant',
			content: msgTemplate.content.replace(/{fence_0}/g, fence[0]).replace(/{fence_1}/g, fence[1]),
		}));
	}
 
	private getFence(): [string, string] {
		return [DEFAULT_FENCE_OPEN, DEFAULT_FENCE_CLOSE];
	}

	private getRepoFilePath(rootPath: string, relativePath: string): string {
		return path.resolve(rootPath, relativePath);
	}

	private getRelativeFilePath(rootPath: string, absolutePath: string): string {
		return path.relative(rootPath, absolutePath);
	}

	/**
	 * Initializes session context related to files, such as which files are in chat
	 * and which of those were initially dirty.
	 */
	private async _initializeSessionContext(session: EditSession, filesToEdit: string[]): Promise<void> {
		session.absFnamesInChat = new Set(filesToEdit.map((relPath) => this.getRepoFilePath(session.workingDir, relPath)));
		session.initiallyDirtyFiles = new Set();

		if (!this.vcs) return;

		for (const absPath of session.absFnamesInChat) {
			const relPath = this.getRelativeFilePath(session.workingDir, absPath);
			if (await this.vcs.isDirty(relPath)) {
				session.initiallyDirtyFiles.add(relPath);
				logger.info(`File ${relPath} was dirty before editing session started.`);
			}
		}
	}

	/**
	 * Prepares edit blocks by checking permissions and identifying files for "dirty commit".
	 * Corresponds to parts of Coder.prepare_to_edit and Coder.allowed_to_edit.
	 */
	private async _prepareToEdit(
		session: EditSession,
		parsedBlocks: EditBlock[],
	): Promise<{ editsToApply: EditBlock[]; pathsToDirtyCommit: Set<string> }> {
		const editsToApply: EditBlock[] = [];
		const pathsToDirtyCommit = new Set<string>(); // Relative paths
		const seenPaths = new Map<string, boolean>(); // Cache for isAllowedToEdit result per path

		for (const edit of parsedBlocks) {
			const relativePath = edit.filePath;
			let isAllowed = seenPaths.get(relativePath);

			if (isAllowed === undefined) {
				const { allowed, needsDirtyCommit } = await this._isAllowedToEdit(session, relativePath, edit.originalText);
				isAllowed = allowed;
				seenPaths.set(relativePath, isAllowed);
				if (needsDirtyCommit) {
					pathsToDirtyCommit.add(relativePath);
				}
			}

			if (isAllowed) {
				editsToApply.push(edit);
			}
		}
		return { editsToApply, pathsToDirtyCommit };
	}

	/**
	 * Checks if an edit is allowed for a given file path and determines if a "dirty commit" is needed.
	 * Corresponds to Coder.allowed_to_edit and Coder.check_for_dirty_commit.
	 */
	private async _isAllowedToEdit(
		session: EditSession,
		relativePath: string,
		originalTextIfNew: string,
	): Promise<{ allowed: boolean; needsDirtyCommit: boolean }> {
		const absolutePath = this.getRepoFilePath(session.workingDir, relativePath);
		let needsDirtyCommit = false;

		if (session.absFnamesInChat?.has(absolutePath)) {
			if (this.vcs && session.initiallyDirtyFiles?.has(relativePath) && (await this.vcs.isDirty(relativePath))) {
				needsDirtyCommit = true;
			}
			return { allowed: true, needsDirtyCommit };
		}

		const fileExists = await this.fs.fileExists(absolutePath);

		if (!fileExists) {
			const isIntentToCreate = !stripQuotedWrapping(originalTextIfNew, relativePath, this.getFence()).trim();
			if (!isIntentToCreate) {
				logger.warn(`Skipping edit for non-existent file ${relativePath} with non-empty SEARCH block (validation should catch this).`);
				// This case should ideally be caught by PathExistsRule, but as a safeguard:
				return { allowed: false, needsDirtyCommit: false };
			}
			logger.info(`Edit targets new file ${relativePath}. Assuming permission to create.`);
		} else {
			logger.info(`Edit targets file ${relativePath} not previously in chat. Assuming permission to edit.`);
		}

		session.absFnamesInChat?.add(absolutePath);
		// TODO: Add Coder.check_added_files() equivalent to warn if too many files/tokens are in chat.

		if (this.vcs && session.initiallyDirtyFiles?.has(relativePath) && (await this.vcs.isDirty(relativePath))) {
			needsDirtyCommit = true;
		}
		return { allowed: true, needsDirtyCommit };
	}

	private _addReflectionToMessages(session: EditSession, reflectionText: string, currentMessages: LlmMessage[]): void {
		session.reflectionMessages.push(reflectionText);
		currentMessages.push(createUserMessage(reflectionText));
		logger.warn({ reflection: reflectionText }, `SearchReplaceCoder: Reflecting to LLM for attempt ${session.attempt}.`);
	}

	private _reflectOnValidationIssues(session: EditSession, issues: ValidationIssue[], currentMessages: LlmMessage[]): void {
		const reflectionText = buildValidationIssuesReflection(issues);
		this._addReflectionToMessages(session, reflectionText, currentMessages);
	}

	private async _reflectOnFailedEdits(session: EditSession, failedEdits: EditBlock[], numPassed: number, currentMessages: LlmMessage[]): Promise<void> {
		const reflectionText = await buildFailedEditsReflection(failedEdits, numPassed, this.fs, session.workingDir);
		this._addReflectionToMessages(session, reflectionText, currentMessages);
	}

	private _reflectOnHookFailure(session: EditSession, hookName: string, hookResult: HookResult, currentMessages: LlmMessage[]): void {
		const reflectionText = buildHookFailureReflection(hookName, hookResult);
		this._addReflectionToMessages(session, reflectionText, currentMessages);
	}

	private async _buildPrompt(
		session: EditSession,
		userRequest: string,
		filesToEditRelativePaths: string[],
		readOnlyFilesRelativePaths: string[],
		repoMapContent?: string,
	): Promise<LlmMessage[]> {
		const messages: LlmMessage[] = [];
		const fence = this.getFence(); // Still needed for formatting file content

		// Use precomputed system and example messages
		messages.push({ role: 'system', content: this.precomputedSystemMessage });
		messages.push(...this.precomputedExampleMessages);

		// File Context
		const formatFileForPrompt = async (relativePath: string): Promise<string> => {
			const absolutePath = this.getRepoFilePath(session.workingDir, relativePath);
			const content = await this.fs.readFile(absolutePath);
			if (content === null) {
				logger.warn(`Could not read file ${relativePath} for prompt inclusion.`);
				return `${relativePath}\n[Could not read file content]`;
			}
			const lang = path.extname(relativePath).substring(1) || 'text';
			return `${relativePath}\n${fence[0]}${lang}\n${content}\n${fence[1]}`;
		};

		const currentFilesInChatAbs = session.absFnamesInChat ?? new Set();
		if (currentFilesInChatAbs.size > 0) {
			let filesContentBlock = EDIT_BLOCK_PROMPTS.files_content_prefix;
			for (const absPath of currentFilesInChatAbs) {
				const relPath = this.getRelativeFilePath(session.workingDir, absPath);
				filesContentBlock += `\n\n${await formatFileForPrompt(relPath)}`;
			}
			messages.push({ role: 'user', content: filesContentBlock });
			messages.push({ role: 'assistant', content: EDIT_BLOCK_PROMPTS.files_content_assistant_reply });
		} else if (repoMapContent) {
			messages.push({ role: 'user', content: EDIT_BLOCK_PROMPTS.files_no_full_files_with_repo_map });
			messages.push({ role: 'assistant', content: EDIT_BLOCK_PROMPTS.files_no_full_files_with_repo_map_reply });
		} else {
			messages.push({ role: 'user', content: EDIT_BLOCK_PROMPTS.files_no_full_files });
		}

		if (readOnlyFilesRelativePaths.length > 0) {
			let readOnlyFilesContentBlock = EDIT_BLOCK_PROMPTS.read_only_files_prefix;
			for (const relPath of readOnlyFilesRelativePaths) {
				readOnlyFilesContentBlock += `\n\n${await formatFileForPrompt(relPath)}`;
			}
			messages.push({ role: 'user', content: readOnlyFilesContentBlock });
			messages.push({ role: 'assistant', content: 'Ok, I will treat these files as read-only.' });
		}

		if (repoMapContent && (currentFilesInChatAbs.size > 0 || !EDIT_BLOCK_PROMPTS.files_no_full_files_with_repo_map)) {
			messages.push({ role: 'user', content: `${EDIT_BLOCK_PROMPTS.repo_content_prefix}\n${repoMapContent}` });
			messages.push({ role: 'assistant', content: 'Ok, I will use this repository information for context.' });
		}

		messages.push({ role: 'user', content: userRequest });
		return messages;
	}

	/**
	 * Makes the changes to the project files to meet the task requirements using search/replace blocks.
	 * Max attempts for the LLM to generate valid and applicable edits is 5.
	 * @param requirements The complete task requirements with all supporting documentation and code samples.
	 * @param filesToEdit Relative paths of files that can be edited. These will be included in the chat context.
	 * @param readOnlyFiles Relative paths of files to be used as read-only context.
	 * @param autoCommit Whether to commit the changes automatically after applying them.
	 * @param dirtyCommits If files which have uncommitted changes should be committed before applying changes.
	 */
	@func()
	async editFilesToMeetRequirements(
		requirements: string,
		filesToEdit: string[],
		readOnlyFiles: string[],
		autoCommit = true,
		dirtyCommits = true,
	): Promise<void> {
		const rootPath = this.fs.getWorkingDirectory();
		const session = newSession(rootPath, requirements);
		await this._initializeSessionContext(session, filesToEdit);

		const repoFiles = await this.fs.listFilesRecursively(); // Get all files for validation context ONCE

		let currentMessages: LlmMessage[] = [];
		const dryRun = false; // Not currently configurable at this level

		// Label for breaking out of nested loops to the main attempt loop
		attemptLoop: while (session.attempt < MAX_ATTEMPTS) {
			session.attempt++;
			logger.info(`SearchReplaceCoder: Attempt ${session.attempt}/${MAX_ATTEMPTS}`);

			currentMessages = await this._buildPrompt(session, requirements, filesToEdit, readOnlyFiles /* repoMapContent? */);
			logger.debug({ messagesLength: currentMessages.length }, 'SearchReplaceCoder: Prompt built for LLM');

			const llmResponseMsgObj: LlmMessage = await this.llm.generateMessage(currentMessages, {
				id: `SearchReplaceCoder.editFiles.attempt${session.attempt}`,
				temperature: 0.0,
			});

			currentMessages.push(llmResponseMsgObj);
			session.llmResponse = messageText(llmResponseMsgObj);

			if (!session.llmResponse?.trim() && session.attempt === 1) {
				logger.warn('SearchReplaceCoder: LLM returned an empty or whitespace-only response on first attempt.');
				// Potentially reflect or retry differently for empty responses
			}
			if (!session.llmResponse?.trim()) {
				this._addReflectionToMessages(session, 'The LLM returned an empty response. Please provide the edits.', currentMessages);
				continue attemptLoop;
			}

			session.parsedBlocks = findOriginalUpdateBlocks(session.llmResponse, this.getFence());
			const { valid: validBlocks, issues: validationIssues } = validateBlocks(session.parsedBlocks, repoFiles, this.rules);

			if (validationIssues.length > 0) {
				this._reflectOnValidationIssues(session, validationIssues, currentMessages);
				continue attemptLoop;
			}

			if (validBlocks.length === 0) {
				logger.info('SearchReplaceCoder: No valid edit blocks to apply after validation.');
				// If LLM provided blocks but all were invalid, it's a form of failure.
				// If LLM provided no blocks, it might be asking a question or refusing.
				// Depending on the LLM response structure, this might need more nuanced handling.
				// For now, if no valid blocks, and no validation issues (e.g. LLM asked a question),
				// we might need to check if the response is a question or a refusal.
				// If it just provided 0 blocks, reflect that.
				if (session.parsedBlocks.length > 0) { // It provided blocks, but none were valid
					this._addReflectionToMessages(session, 'All provided edit blocks were invalid. Please correct them.', currentMessages);
				} else { // It provided no blocks at all
					this._addReflectionToMessages(session, 'No edit blocks were found in your response. Please provide the edits in the S/R block format.', currentMessages);
				}
				continue attemptLoop;
			}

			// Handle "dirty commits" before applying edits
			const { editsToApply, pathsToDirtyCommit } = await this._prepareToEdit(session, validBlocks);
			if (dirtyCommits && this.vcs && pathsToDirtyCommit.size > 0 && !dryRun) {
				const dirtyFilesArray = Array.from(pathsToDirtyCommit);
				logger.info(`Found uncommitted changes in files targeted for edit: ${dirtyFilesArray.join(', ')}. Attempting dirty commit.`);
				try {
					await this.vcs.addAllTrackedAndCommit('Aider: Committing uncommitted changes before applying LLM edits');
					logger.info('Successfully committed dirty files.');
				} catch (commitError: any) {
					logger.error({ err: commitError }, 'Dirty commit failed for uncommitted changes.');
					this._addReflectionToMessages(session, `Failed to commit uncommitted changes for ${dirtyFilesArray.join(', ')}: ${commitError.message}. Please resolve this manually or allow proceeding without committing them.`, currentMessages);
					continue attemptLoop;
				}
			}

			const applier = new EditApplier(
				this.fs,
				this.vcs,
				DEFAULT_LENIENT_WHITESPACE,
				this.getFence(),
				session.workingDir,
				session.absFnamesInChat ?? new Set(),
				autoCommit,
				dryRun,
			);

			const { appliedFilePaths, failedEdits } = await applier.apply(editsToApply);

			if (failedEdits.length > 0) {
				await this._reflectOnFailedEdits(session, failedEdits, appliedFilePaths.size, currentMessages);
				continue attemptLoop;
			}

			session.appliedFiles = appliedFilePaths;
			logger.info({ appliedFiles: Array.from(session.appliedFiles) }, 'SearchReplaceCoder: Edits applied successfully.');

			let allHooksPassed = true;
			for (const hook of this.hooks) {
				logger.info(`Running hook: ${hook.name}`);
				const hookResult = await hook.run(session);
				if (!hookResult.ok) {
					logger.warn(`Hook ${hook.name} failed: ${hookResult.message}`);
					sessionEvents.emit('hook-failed', { hook: hook.name, msg: hookResult.message });
					this._reflectOnHookFailure(session, hook.name, hookResult, currentMessages);
					allHooksPassed = false;
					continue attemptLoop;
				}
				logger.info(`Hook ${hook.name} completed successfully.`);
			}

			if (allHooksPassed) {
				sessionEvents.emit('applied', { files: Array.from(session.appliedFiles) });
				logger.info('SearchReplaceCoder: All edits applied and hooks passed successfully.');
				return; // Success
			}
			// If a hook failed, the attemptLoop will continue due to `continue attemptLoop`
		}

		logger.error(`SearchReplaceCoder: Maximum attempts (${MAX_ATTEMPTS}) reached. Failing.`);
		const finalReflection = session.reflectionMessages.pop() || 'Unknown error after max attempts.';
		throw new Error(`Failed to apply edits after ${MAX_ATTEMPTS} attempts. Last reflection: ${finalReflection}`);
	}
}
