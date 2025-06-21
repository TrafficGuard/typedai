import * as path from 'node:path';
import { getFileSystem, llms } from '#agent/agentContextLocalStorage';
import { buildFileSystemTreePrompt } from '#agent/agentPromptUtils';
import { func, funcClass } from '#functionSchema/functionDecorators';
import { logger } from '#o11y/logger';
import type { AgentLLMs } from '#shared/agent/agent.model';
import type { IFileSystemService } from '#shared/files/fileSystemService';
import type { LLM, LlmMessage } from '#shared/llm/llm.model';
import { messageText, user } from '#shared/llm/llm.model';
import type { VersionControlSystem } from '#shared/scm/versionControlSystem';
import type { EditBlock } from '#swe/coder/coderTypes';
import { CoderExhaustedAttemptsError } from '../sweErrors';
import type { EditFormat } from './coderTypes';
import { MODEL_EDIT_FORMATS } from './constants';
import { EditApplier } from './editApplier';
import { parseEditResponse } from './editBlockParser';
import type { EditSession, RequestedFileEntry, RequestedPackageInstallEntry, RequestedQueryEntry } from './editSession';
import { newSession } from './editSession';
import { tryFixSearchBlock } from './fixSearchReplaceBlock';
import { stripQuotedWrapping } from './patchUtils';
import { buildFailedEditsReflection, buildValidationIssuesReflection } from './reflectionUtils';
import { EDIT_BLOCK_PROMPTS } from './searchReplacePrompts';
import { validateBlocks } from './validators/compositeValidator';
import { ModuleAliasRule } from './validators/moduleAliasRule';
import { PathExistsRule } from './validators/pathExistsRule';
import type { ValidationIssue, ValidationRule } from './validators/validationRule';

const MAX_ATTEMPTS = 5;
const DEFAULT_FENCE_OPEN = '```';
const DEFAULT_FENCE_CLOSE = '```';
const DEFAULT_LENIENT_WHITESPACE = true;

// Helper function to parse file requests from LLM response
function parseAddFilesRequest(responseText: string): RequestedFileEntry[] | null {
	if (!responseText) return null;
	const match = responseText.match(/<add-files-json>([\s\S]*?)<\/add-files-json>/);
	if (!match || !match[1]) {
		return null;
	}

	const jsonString = match[1];
	try {
		const parsed = JSON.parse(jsonString);
		if (parsed && Array.isArray(parsed.files)) {
			const requestedFiles: RequestedFileEntry[] = [];
			for (const item of parsed.files) {
				if (typeof item.filePath === 'string' && typeof item.reason === 'string') {
					requestedFiles.push({ filePath: item.filePath, reason: item.reason });
				} else {
					logger.warn('Invalid item in files array for add-files-json', { item });
					return null; // Strict parsing: if one item is bad, reject all
				}
			}
			return requestedFiles.length > 0 ? requestedFiles : null;
		}
		logger.warn('Invalid structure for add-files-json content', { jsonString });
		return null;
	} catch (error) {
		logger.error({ err: error }, 'Failed to parse JSON from add-files-json block');
		return null;
	}
}

// New helper function to parse query requests
function parseAskQueryRequest(responseText: string): RequestedQueryEntry[] | null {
	if (!responseText) return null;
	const matches = Array.from(responseText.matchAll(/<ask-query>([\s\S]*?)<\/ask-query>/g));
	if (!matches.length) return null;

	const requestedQueries: RequestedQueryEntry[] = [];
	for (const match of matches) {
		if (match[1]) {
			requestedQueries.push({ query: match[1].trim() });
		}
	}
	return requestedQueries.length > 0 ? requestedQueries : null;
}

// New helper function to parse package install requests
function parseInstallPackageRequest(responseText: string): RequestedPackageInstallEntry[] | null {
	if (!responseText) return null;
	const match = responseText.match(/<install-packages-json>([\s\S]*?)<\/install-packages-json>/);
	if (!match || !match[1]) {
		return null;
	}

	const jsonString = match[1];
	try {
		const parsed = JSON.parse(jsonString);
		if (parsed && Array.isArray(parsed.packages)) {
			const requestedPackages: RequestedPackageInstallEntry[] = [];
			for (const item of parsed.packages) {
				if (typeof item.packageName === 'string' && typeof item.reason === 'string') {
					requestedPackages.push({ packageName: item.packageName, reason: item.reason });
				} else {
					logger.warn('Invalid item in packages array for install-packages-json', { item });
					return null; // Strict parsing
				}
			}
			return requestedPackages.length > 0 ? requestedPackages : null;
		}
		logger.warn('Invalid structure for install-packages-json content', { jsonString });
		return null;
	} catch (error) {
		logger.error({ err: error }, 'Failed to parse JSON from install-packages-json block');
		return null;
	}
}

@funcClass(__filename)
export class SearchReplaceCoder {
	private vcs: VersionControlSystem | null;
	private readonly precomputedSystemMessage: string;
	private readonly precomputedExampleMessages: LlmMessage[];
	private readonly systemReminderForUserPrompt: string;

	constructor(
		private llms: AgentLLMs,
		private fs: IFileSystemService = getFileSystem(),
		private rules: ValidationRule[] = [new PathExistsRule(), new ModuleAliasRule()],
	) {
		this.vcs = this.fs.getVcsRoot() ? this.fs.getVcs() : null;

		const fence = this.getFence();
		const language = 'TypeScript'; // Default, can be made configurable

		// Construct the detailed reminders text that will be used in both system and user prompts
		const renameFilesReminder = 'To rename files which have been added to the chat, use shell commands at the end of your response.';

		const overeagerPromptContent = EDIT_BLOCK_PROMPTS.overeager_prompt;

		// Combine reminders for the final section of the prompt
		const finalRemindersText = `${renameFilesReminder}\n\n${overeagerPromptContent}`;

		// Specific reminder about quadruple backticks
		const quadBacktickReminderText = 'IMPORTANT: Use *quadruple* backticks ```` as fences, not triple backticks!\n';

		// Build the main system message content
		const mainSystemContent = EDIT_BLOCK_PROMPTS.main_system.replace('{language}', language).replace('{final_reminders}', finalRemindersText);

		// Build the detailed system reminder content (used in system message and user prompt suffix)
		const systemReminderContentForPrompt = EDIT_BLOCK_PROMPTS.system_reminder
			.replace(/{fence_0}/g, fence[0])
			.replace(/{fence_1}/g, fence[1])
			.replace('{quad_backtick_reminder}', quadBacktickReminderText)
			.replace('{final_reminders}', finalRemindersText);

		// The full system message combines the main content and the detailed reminders
		this.precomputedSystemMessage = `${mainSystemContent}\n\n${systemReminderContentForPrompt}`;

		// Store the detailed reminders separately to append to the user prompt
		this.systemReminderForUserPrompt = systemReminderContentForPrompt;

		// Precompute example messages, replacing fence placeholders
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
	private async _prepareToEdit(session: EditSession, parsedBlocks: EditBlock[]): Promise<{ editsToApply: EditBlock[]; pathsToDirtyCommit: Set<string> }> {
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
		currentMessages.push(user(reflectionText));
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

	/** Returns list of file paths that have changed since their snapshot. */
	private async _detectExternalChanges(session: EditSession, targetBlocks: EditBlock[]): Promise<string[]> {
		const changed: string[] = [];
		const uniquePaths = new Set(targetBlocks.map((b) => b.filePath));
		for (const relPath of uniquePaths) {
			const snapshot = session.fileContentSnapshots.get(relPath);
			if (snapshot === undefined) continue; // no snapshot → ignore
			const absPath = this.getRepoFilePath(session.workingDir, relPath);
			let current: string | null = null;
			try {
				current = await this.fs.readFile(absPath);
			} catch {
				current = null; // treat deletion as a change
			}
			if (snapshot !== current) changed.push(relPath);
		}
		return changed;
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

		let fileSystemTree = await buildFileSystemTreePrompt();
		if (!fileSystemTree) fileSystemTree = await getFileSystem().getFileSystemTree();

		messages.push({ role: 'user', content: `Here's all the files in the repository:\n${fileSystemTree}` });
		messages.push({ role: 'assistant', content: 'Ok, thanks.' });

		// File Context
		const formatFileForPrompt = async (relativePath: string): Promise<string> => {
			const absolutePath = this.getRepoFilePath(session.workingDir, relativePath);
			let fileContent: string | null = null;
			try {
				fileContent = await this.fs.readFile(absolutePath);
			} catch (e) {
				logger.warn(`Could not read file ${relativePath} for prompt inclusion or snapshot: ${(e as Error).message}`);
				// fileContent remains null
			}

			// Store snapshot
			session.fileContentSnapshots.set(relativePath, fileContent);

			if (fileContent === null) {
				return `${relativePath}\n[Could not read file content]`;
			}
			const lang = path.extname(relativePath).substring(1) || 'text';
			return `${relativePath}\n${fence[0]}${lang}\n${fileContent}\n${fence[1]}`;
		};

		const currentFilesInChatAbs = session.absFnamesInChat ?? new Set();
		if (currentFilesInChatAbs.size > 0) {
			let filesContentBlock = EDIT_BLOCK_PROMPTS.files_content_prefix;
			// Sort files alphabetically for consistent prompt order
			const sortedChatFilesRel = Array.from(currentFilesInChatAbs)
				.map((absPath) => this.getRelativeFilePath(session.workingDir, absPath))
				.sort();
			for (const relPath of sortedChatFilesRel) {
				filesContentBlock += `\n\n${await formatFileForPrompt(relPath)}`;
			}
			messages.push({ role: 'user', content: filesContentBlock });
			messages.push({ role: 'assistant', content: EDIT_BLOCK_PROMPTS.files_content_assistant_reply });
		} else {
			messages.push({ role: 'user', content: EDIT_BLOCK_PROMPTS.files_no_full_files });
		}

		if (readOnlyFilesRelativePaths.length > 0) {
			let readOnlyFilesContentBlock = EDIT_BLOCK_PROMPTS.read_only_files_prefix;
			// Sort read-only files alphabetically for consistent prompt order
			const sortedReadOnlyFilesRel = readOnlyFilesRelativePaths.sort();
			for (const relPath of sortedReadOnlyFilesRel) {
				readOnlyFilesContentBlock += `\n\n${await formatFileForPrompt(relPath)}`;
			}
			messages.push({ role: 'user', content: readOnlyFilesContentBlock });
			messages.push({ role: 'assistant', content: 'Ok, I will treat these files as read-only.' });
		}

		// If there's a repo map, and we haven't already sent a "no files" message that implies repo map usage,
		// or if we have sent files, then add the repo map.
		// The main idea is to always include repoMapContent if available, unless a more specific "no files, use map" prompt was already used.
		if (repoMapContent) {
			messages.push({ role: 'user', content: `${EDIT_BLOCK_PROMPTS.repo_content_prefix}\n${repoMapContent}` });
			messages.push({ role: 'assistant', content: 'Ok, I will use this repository information for context.' });
		}

		// Append the detailed system reminders to the user's request
		messages.push({ role: 'user', content: `${userRequest}\n\n${this.systemReminderForUserPrompt}` });
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
		session.appliedFiles = new Set<string>(); // Initialize appliedFiles set for the session

		const repoFiles = await this.fs.listFilesRecursively();

		let currentMessages: LlmMessage[] = [];
		const dryRun = false;
		let currentFailedEdits: EditBlock[] = []; // Declare currentFailedEdits here

		let llm = this.llms.medium;
		// Label for breaking out of nested loops to the main attempt loop
		while (session.attempt < MAX_ATTEMPTS) {
			session.attempt++;
			if (session.attempt === MAX_ATTEMPTS - 1) llm = this.llms.hard;

			logger.info(`SearchReplaceCoder: Attempt ${session.attempt}/${MAX_ATTEMPTS}`);

			// Only rebuild the full prompt if not in a re-application cycle from a fix
			// This check might be more complex if we decide _tryFixSearchBlock can use a different prompt structure.
			// For now, _buildPrompt is always called at the start of a main attempt.
			currentMessages = await this._buildPrompt(session, requirements, filesToEdit, readOnlyFiles);
			logger.debug({ messagesLength: currentMessages.length }, 'SearchReplaceCoder: Prompt built for LLM');

			const llmResponseMsgObj: LlmMessage = await llm.generateMessage(currentMessages, {
				id: `SearchReplaceCoder.editFiles.attempt${session.attempt}`,
				temperature: 0.05,
			});

			currentMessages.push(llmResponseMsgObj);
			session.llmResponse = messageText(llmResponseMsgObj);
			session.requestedFiles = parseAddFilesRequest(session.llmResponse);
			session.requestedQueries = parseAskQueryRequest(session.llmResponse);
			session.requestedPackageInstalls = parseInstallPackageRequest(session.llmResponse);

			// Decide which edit-response format to parse based on the model name
			const modelId = llm.getModel();
			// Sort keys by length in descending order to match longer, more specific keys first (e.g., "o3-mini" before "o3")
			const sortedModelFormatEntries = Object.entries(MODEL_EDIT_FORMATS).sort(([keyA], [keyB]) => keyB.length - keyA.length);
			const editFormat: EditFormat = sortedModelFormatEntries.find(([key]) => modelId.includes(key))?.[1] ?? 'diff';

			session.parsedBlocks = parseEditResponse(session.llmResponse, editFormat, this.getFence());

			const hasFileRequests = session.requestedFiles && session.requestedFiles.length > 0;
			const hasQueryRequests = session.requestedQueries && session.requestedQueries.length > 0;
			const hasPackageRequests = session.requestedPackageInstalls && session.requestedPackageInstalls.length > 0;
			const hasAnyMetaRequest = hasFileRequests || hasQueryRequests || hasPackageRequests;

			if (hasAnyMetaRequest) {
				let reflectionForMetaRequests = '';
				if (hasFileRequests) {
					logger.info(`LLM requested additional files: ${JSON.stringify(session.requestedFiles)}`);
					const addedFiles: string[] = [];
					const alreadyPresentFiles: string[] = [];
					for (const requestedFile of session.requestedFiles!) {
						// Basic validation on the requested path
						if (!requestedFile.filePath || typeof requestedFile.filePath !== 'string') {
							logger.warn('Invalid file path in request, skipping:', requestedFile);
							continue;
						}
						const absPath = this.getRepoFilePath(session.workingDir, requestedFile.filePath);
						if (session.absFnamesInChat?.has(absPath)) {
							alreadyPresentFiles.push(requestedFile.filePath);
						} else {
							session.absFnamesInChat?.add(absPath);
							addedFiles.push(requestedFile.filePath);
						}
					}

					if (addedFiles.length > 0) {
						reflectionForMetaRequests += `I have added the ${addedFiles.length} file(s) you requested to the chat: ${addedFiles.join(', ')}. `;
					}
					if (alreadyPresentFiles.length > 0) {
						reflectionForMetaRequests += `The following file(s) you requested were already in the chat: ${alreadyPresentFiles.join(', ')}. `;
					}
				}
				if (hasQueryRequests) {
					logger.info(`LLM asked queries: ${JSON.stringify(session.requestedQueries)}`);
					reflectionForMetaRequests += `You asked ${session.requestedQueries!.length} quer(y/ies): ${session.requestedQueries!.map((q) => `"${q.query}"`).join(', ')}. `;
				}
				if (hasPackageRequests) {
					logger.info(`LLM requested package installs: ${JSON.stringify(session.requestedPackageInstalls)}`);
					reflectionForMetaRequests += `You requested to install ${session.requestedPackageInstalls!.length} package(s): ${session.requestedPackageInstalls!.map((p) => `"${p.packageName}"`).join(', ')}. `;
				}

				if (session.parsedBlocks.length === 0) {
					// LLM made meta-request(s) and provided no edit blocks (expected behavior for meta-requests)
					reflectionForMetaRequests += 'Please proceed with the edits now that you have the additional context, or ask for more information if needed.';
					this._addReflectionToMessages(session, reflectionForMetaRequests, currentMessages);
					continue;
				}
				// LLM made meta-request(s) AND provided edit blocks. Warn but proceed with blocks.
				logger.warn(`LLM made meta-request(s) AND provided edit blocks. Processing edit blocks. Meta-requests: ${reflectionForMetaRequests}`);
			}

			const { valid: validBlocks, issues: validationIssues } = await validateBlocks(session.parsedBlocks, repoFiles, this.rules);

			// Filter out any null/undefined issues from a potentially buggy validator
			const compactIssues = validationIssues.filter((i) => i);

			if (compactIssues.length > 0) {
				this._reflectOnValidationIssues(session, compactIssues, currentMessages);
				continue;
			}

			if (validBlocks.length === 0) {
				if (session.parsedBlocks.length > 0) {
					// All blocks were invalid, but no issues were reported (or they were all null).
					this._addReflectionToMessages(
						session,
						'All provided edit blocks were invalid. Please correct them or request necessary files/information/packages using the specified formats.',
						currentMessages,
					);
				} else if (!hasAnyMetaRequest) {
					// No edit blocks were parsed, and no meta-requests were made.
					this._addReflectionToMessages(
						session,
						'No edit blocks or actionable requests (files, query, package install) were found in your response. Please provide edits in the S/R block format or request necessary items using the specified formats.',
						currentMessages,
					);
				}
				// If there were only meta-requests, we don't need to reflect again, just continue to the next attempt.
				continue;
			}

			// Handle "dirty commits" before applying edits
			const { editsToApply, pathsToDirtyCommit } = await this._prepareToEdit(session, validBlocks);
			const blocksForCurrentApplyAttempt = [...editsToApply]; // Master list of blocks for this attempt, may be modified by fixes

			// Proactive check for external file modifications before applying edits
			const externallyChanged = await this._detectExternalChanges(session, blocksForCurrentApplyAttempt);
			if (externallyChanged.length > 0) {
				this._addReflectionToMessages(
					session,
					`The following file(s) were modified after the edit blocks were generated: ${externallyChanged.join(', ')}. Their content has been updated in your context. Please regenerate the edits using the updated content.`,
					currentMessages,
				);
				continue;
			}

			if (dirtyCommits && this.vcs && pathsToDirtyCommit.size > 0 && !dryRun) {
				const dirtyFilesArray = Array.from(pathsToDirtyCommit);
				logger.info(`Found uncommitted changes in files targeted for edit: ${dirtyFilesArray.join(', ')}. Attempting dirty commit.`);
				try {
					const dirtyCommitMsg = 'Aider: Committing uncommitted changes in targeted files before applying LLM edits';
					await this.vcs.addAndCommitFiles(dirtyFilesArray, dirtyCommitMsg);
					logger.info(`Successfully committed uncommitted changes for: ${dirtyFilesArray.join(', ')}.`);
				} catch (commitError: any) {
					logger.error({ err: commitError, files: dirtyFilesArray }, `Dirty commit failed for files: ${dirtyFilesArray.join(', ')}.`);
					this._addReflectionToMessages(
						session,
						`Failed to commit uncommitted changes for ${dirtyFilesArray.join(', ')}: ${commitError.message}. Please resolve this manually or allow proceeding without committing them.`,
						currentMessages,
					);
					continue;
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

			const applierResult = await applier.apply(blocksForCurrentApplyAttempt);
			applierResult.appliedFilePaths.forEach((p) => session.appliedFiles!.add(p));
			currentFailedEdits = applierResult.failedEdits; // Assign to the outer-scoped variable

			if (currentFailedEdits.length > 0) {
				let fixesMade = 0;
				const initialFailedEditsForThisRound = [...currentFailedEdits]; // Store before modification
				const nextRoundFailedEdits: EditBlock[] = [];

				for (const failedEdit of initialFailedEditsForThisRound) {
					const filePath = failedEdit.filePath;
					const fileContentSnapshot = session.fileContentSnapshots.get(filePath);

					// Try to fix only if the file was supposed to exist and had content (i.e., not a failed new file creation with empty SEARCH block)
					// And originalText is not empty (meaning it's not a "create new file" block that failed for other reasons)
					if (fileContentSnapshot && failedEdit.originalText.trim() !== '') {
						logger.info(`Attempting to fix search block for ${filePath} in attempt ${session.attempt}`);
						const correctedBlock = await tryFixSearchBlock(
							failedEdit,
							fileContentSnapshot,
							llm, // Use the same LLM as the current attempt
							this.getFence(),
						);

						if (correctedBlock) {
							// Replace the original failed block with the corrected one in `blocksForCurrentApplyAttempt`
							const indexInMasterList = blocksForCurrentApplyAttempt.findIndex(
								(b) => b.filePath === failedEdit.filePath && b.originalText === failedEdit.originalText && b.updatedText === failedEdit.updatedText,
							);
							if (indexInMasterList !== -1) {
								blocksForCurrentApplyAttempt[indexInMasterList] = correctedBlock;
								fixesMade++;
							} else {
								// Should not happen if blocksForCurrentApplyAttempt is the true source
								logger.error('Original failed block not found in master list for replacement.');
								nextRoundFailedEdits.push(failedEdit); // Keep original failed edit
							}
						} else {
							logger.warn(`Failed to generate a corrected block for ${filePath}. Will use standard reflection if it fails again.`);
							nextRoundFailedEdits.push(failedEdit); // Keep original failed edit
						}
					} else {
						nextRoundFailedEdits.push(failedEdit); // Not a candidate for this type of fix
					}
				}

				if (fixesMade > 0) {
					logger.info(`Re-attempting to apply edits after ${fixesMade} block(s) were corrected in attempt ${session.attempt}.`);
					// Re-apply with the potentially modified blocksForCurrentApplyAttempt
					const reappliedResult = await applier.apply(blocksForCurrentApplyAttempt);
					reappliedResult.appliedFilePaths.forEach((p) => session.appliedFiles!.add(p));
					currentFailedEdits = reappliedResult.failedEdits; // Update currentFailedEdits with the result of the re-application

					if (currentFailedEdits.length === 0) {
						logger.info('All blocks applied successfully after correction and re-application.');
						session.parsedBlocks = blocksForCurrentApplyAttempt; // Store the successfully applied (potentially corrected) blocks
						break; // Exit main attempt loop
					}
				} else {
					// No fixes were made, currentFailedEdits are from the first apply, or nextRoundFailedEdits if some were not candidates
					currentFailedEdits = nextRoundFailedEdits;
				}
			}

			if (currentFailedEdits.length > 0) {
				await this._reflectOnFailedEdits(session, currentFailedEdits, session.appliedFiles!.size, currentMessages);
				continue; // Continue to next main attempt
			}

			// If we reach here, it means currentFailedEdits is empty.
			session.parsedBlocks = blocksForCurrentApplyAttempt; // Store the successfully applied blocks
			logger.info({ appliedFiles: Array.from(session.appliedFiles!) }, 'SearchReplaceCoder: Edits applied successfully.');
			break; // Exit loop on full success
		}

		if (session.attempt >= MAX_ATTEMPTS && (session.appliedFiles?.size === 0 || (currentFailedEdits && currentFailedEdits.length > 0))) {
			logger.error(`SearchReplaceCoder: Maximum attempts (${MAX_ATTEMPTS}) reached. Failing.`);
			const finalReflection =
				session.reflectionMessages.pop() || 'Unknown error after max attempts, and not all edits were successfully applied in the final attempt.';
			throw new CoderExhaustedAttemptsError(`SearchReplaceCoder failed to apply edits after ${MAX_ATTEMPTS} attempts.`, MAX_ATTEMPTS, finalReflection);
		}
		// If the loop was exited by a 'break', it means session.attempt < MAX_ATTEMPTS,
		// and all edits were applied successfully. No error is thrown.
	}
}
