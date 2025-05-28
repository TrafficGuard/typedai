import { platform } from 'node:os';
import * as path from 'node:path';
import { getFileSystem } from '#agent/agentContextLocalStorage';
import { logger } from '#o11y/logger';
import type { LLM, LlmMessage } from '#shared/model/llm.model';
import type { IFileSystemService } from '#shared/services/fileSystemService';
import type { VersionControlSystem } from '#shared/services/versionControlSystem';
// import { _stripFilename } from '#swe/coder/applySearchReplaceUtils'; // _stripFilename is not directly used here
import { EDIT_BLOCK_PROMPTS } from '#swe/coder/searchReplacePrompts';
import * as PatchUtils from './patchUtils'; // Import all as PatchUtils
import { findOriginalUpdateBlocks } from './editBlockParser';

const SEARCH_MARKER = '<<<<<<< SEARCH';
const DIVIDER_MARKER = '=======';
const REPLACE_MARKER = '>>>>>>> REPLACE';

// Default fence for code blocks within the LLM response,
// not to be confused with the SEARCH/REPLACE markers.
// Python's Coder.choose_fence() dynamically selects this if "```" is in file content.
// For simplicity, we start with a fixed default.
const DEFAULT_FENCE_OPEN = '```';
const DEFAULT_FENCE_CLOSE = '```';

export interface EditBlock {
	filePath: string; // Relative to rootPath
	originalText: string;
	updatedText: string;
}

export type FileEditBlocks = Map<string, EditBlock[]>;

export type EditFormat = 'diff' | 'diff-fenced';

interface SearchReplaceCoderOptions {
	autoCommits?: boolean;
	/** Auto-commit of dirty files before edits */
	dirtyCommits?: boolean;
	dryRun?: boolean;
	editFormat?: EditFormat;
	lenientLeadingWhitespace?: boolean;
	// initialFiles?: string[]; // Relative paths of files already in chat context
}

// Define an interface for the prompt options
interface SearchReplaceCoderPromptOptions extends SearchReplaceCoderOptions {
	language?: string;
	suggestShellCommands?: boolean;
	useLazyPrompt?: boolean;
	useOvereagerPrompt?: boolean;
	// A simple string for quad_backtick_reminder, can be enhanced later if needed
	quadBacktickReminder?: string;
}
export class ApplySearchReplace {
	private fileSystemService: IFileSystemService;
	private vcs: VersionControlSystem | null;
	private rootPath: string; // Absolute path to the project root (e.g., git repo root)
	private absFnamesInChat: Set<string>; // Absolute paths of files explicitly in chat
	private fence: [string, string];
	private lenientLeadingWhitespace: boolean; // <<< Add this line
	private initiallyDirtyFiles: Set<string>; // Relative paths of files that were dirty when we started

	private autoCommits: boolean;
	private dirtyCommits: boolean; // If true, commit uncommitted changes in targeted files before applying LLM edits
	private dryRun: boolean;

	// State during processing of one LLM response
	private currentLlmResponseContent = '';
	private language: string;
	private suggestShellCommands: boolean;
	private useLazyPrompt: boolean;
	private useOvereagerPrompt: boolean;
	private quadBacktickReminder: string;

	private async _fileExists(absolutePath: string): Promise<boolean> {
		return this.fileSystemService.fileExists(absolutePath);
	}

	private async _readText(absolutePath: string): Promise<string | null> {
		try {
			return await this.fileSystemService.readFile(absolutePath);
		} catch (e: any) {
			logger.warn(`Failed to read file at ${absolutePath}: ${e.message}`);
			return null;
		}
	}

	private async _writeText(absolutePath: string, content: string): Promise<void> {
		await this.fileSystemService.writeFile(absolutePath, content);
	}
	public reflectedMessage: string | null = null; // For error messages to potentially send back to LLM

	constructor(
		rootPath: string, // Should be the project's root directory (e.g., git repo root)
		initialFiles: string[] = [], // Relative paths from rootPath, for files already "in chat"
		options: SearchReplaceCoderPromptOptions = { editFormat: 'diff' }, // Use the new options type
	) {
		const agentFs = getFileSystem(); // Assumes agent context is appropriately set up by the caller
		if (!agentFs) {
			throw new Error('FileSystemService not available from agent context. Ensure agent context is initialized.');
		}
		this.fileSystemService = agentFs;
		// Attempt to get VCS; it might be null if not in a repo or VCS is disabled.
		// FileSystemService.getVcsRoot() determines if it's a repo.
		this.vcs = this.fileSystemService.getVcsRoot() ? this.fileSystemService.getVcs() : null;

		this.rootPath = path.resolve(rootPath);

		this.absFnamesInChat = new Set(initialFiles.map((relPath) => this.getRepoFilePath(relPath)));
		this.initiallyDirtyFiles = new Set();

		// The `fence` is for code block delimiters (e.g., ```).
		// Python's Coder.choose_fence() dynamically selects this.
		// For 'diff' and 'diff-fenced', "```" is typical.
		// This could be made configurable if options.editFormat implies different fencing.
		this.fence = [DEFAULT_FENCE_OPEN, DEFAULT_FENCE_CLOSE];

		this.autoCommits = options.autoCommits ?? true;
		this.dirtyCommits = options.dirtyCommits ?? true;
		this.dryRun = options.dryRun ?? false;
		this.lenientLeadingWhitespace = options.lenientLeadingWhitespace ?? false; // <<< Add this line to initialize

		// Initialize new prompt-related options
		this.language = options.language ?? 'TypeScript';
		this.suggestShellCommands = options.suggestShellCommands ?? true;
		this.useLazyPrompt = options.useLazyPrompt ?? false; // Default to false unless specified
		this.useOvereagerPrompt = options.useOvereagerPrompt ?? false; // Default to false
		this.quadBacktickReminder = options.quadBacktickReminder ?? ''; // Default to empty
	}

	getFence() {
		return this.fence;
	}

	private getRepoFilePath(relativePath: string): string {
		return path.resolve(this.rootPath, relativePath);
	}

	private getRelativeFilePath(absolutePath: string): string {
		return path.relative(this.rootPath, absolutePath);
	}

	public async initializeDirtyFileTracking(): Promise<void> {
		if (!this.vcs || !this.dirtyCommits) return;

		// Check all files currently in chat
		for (const absPath of this.absFnamesInChat) {
			const relPath = this.getRelativeFilePath(absPath);
			if (await this.vcs.isDirty(relPath)) {
				this.initiallyDirtyFiles.add(relPath);
				logger.info(`File ${relPath} was dirty before editing session started.`);
			}
		}
	}

	/**
	 * Main method to process an LLM response and apply SEARCH/REPLACE edits.
	 * Corresponds to Coder.apply_updates in Python.
	 * @param llmResponseContent The raw response from the LLM.
	 * @param llm The LLM to use to requesting re-sends of failed patches
	 * @returns A Set of relative file paths that were successfully edited.
	 *          Returns null if a critical error occurred that warrants an LLM reflection/retry.
	 *          An empty set means no edits were applied or found.
	 */
	public async applyLlmResponse(llmResponseContent: string, llm: LLM): Promise<Set<string> | null> {
		this.currentLlmResponseContent = llmResponseContent;
		this.reflectedMessage = null; // Reset before processing

		try {
			const editedFilesRelativePaths = await this._updateFiles();

			if (this.reflectedMessage) {
				logger.warn({
					message: 'Edits resulted in a reflected message, indicating partial or full failure.',
					reflectedMessage: this.reflectedMessage,
					editedFiles: Array.from(editedFilesRelativePaths),
				});
				console.log(this.reflectedMessage);
				// Even if some files were edited, the reflected message takes precedence for retry.
				return null;
			}

			if (editedFilesRelativePaths.size > 0 && this.autoCommits && !this.dryRun && this.vcs) {
				const commitMessage = 'Applied LLM-generated edits'; // Simplified commit message
				try {
					// To commit only specific files, VCS interface might need enhancement.
					// For now, using addAllTrackedAndCommit or a general commit.
					// Python: self.repo.commit(fnames=edited, context=context, aider_edits=True)
					// This implies staging *only* the edited files.
					// Assuming `this.vcs.commitFiles(Array.from(editedFilesRelativePaths), commitMessage)` if available.
					// Or, more generally:
					await this.vcs.addAllTrackedAndCommit(commitMessage);
					logger.info(`Auto-committed changes for ${editedFilesRelativePaths.size} files.`);
				} catch (commitError: any) {
					logger.error({ err: commitError }, 'Auto-commit failed after applying edits.');
					// This might not be a reason to set reflectedMessage, but it's a post-edit failure.
				}
			}
			return editedFilesRelativePaths;
		} catch (error: any) {
			logger.error({ err: error }, 'Critical error applying LLM response edits.');
			this.reflectedMessage = this.reflectedMessage || `Error applying updates: ${error.message}`;
			return null;
		}
	}

	/** Corresponds to Coder.update_files */
	private async _updateFiles(): Promise<Set<string>> {
		const edits = findOriginalUpdateBlocks(this.currentLlmResponseContent, this.fence);
		if (!edits.length) {
			logger.info('No SEARCH/REPLACE blocks found in the LLM response.');
			return new Set();
		}

		const { editsToApply, pathsToDirtyCommit } = await this._prepareToEdit(edits);

		logger.info(`Found ${editsToApply.length} edits to apply`);

		if (this.vcs && this.dirtyCommits && pathsToDirtyCommit.size > 0 && !this.dryRun) {
			const dirtyFilesArray = Array.from(pathsToDirtyCommit);
			logger.info(`Found uncommitted changes in files targeted for edit: ${dirtyFilesArray.join(', ')}. Attempting dirty commit.`);
			try {
				await this.vcs.addAllTrackedAndCommit('Aider: Committing uncommitted changes before applying LLM edits');
				logger.info('Successfully committed dirty files.');
			} catch (commitError: any) {
				logger.error({ err: commitError }, 'Dirty commit failed for uncommitted changes.');
				this.reflectedMessage = `Failed to commit uncommitted changes for ${dirtyFilesArray.join(', ')}: ${commitError.message}`;
				throw commitError; // This is a blocking issue for applying edits safely.
			}
		}

		// Instantiate and use EditApplier
		const applier = new EditApplier(
			this.fileSystemService,
			this.vcs,
			this.lenientLeadingWhitespace,
			this.fence,
			this.rootPath,
			this.absFnamesInChat,
			this.autoCommits,
			this.dryRun,
		);

		const { appliedFilePaths, failedEdits } = await applier.apply(editsToApply);

		if (failedEdits.length > 0) {
			// This method will set this.reflectedMessage
			await this._generateFailedEditReport(failedEdits, appliedFilePaths.size);
		}

		return appliedFilePaths; // Return relative paths
	}

	// _getEdits method removed as findOriginalUpdateBlocks is called directly in _updateFiles

	/** Corresponds to Coder.prepare_to_edit */
	private async _prepareToEdit(edits: EditBlock[]): Promise<{ editsToApply: EditBlock[]; pathsToDirtyCommit: Set<string> }> {
		const allowedEdits: EditBlock[] = [];
		const seenPaths: Map<string, boolean> = new Map(); // Cache for `isAllowedToEdit` result per path
		const pathsToDirtyCommit = new Set<string>(); // Relative paths

		for (const edit of edits) {
			const relativePath = edit.filePath;
			let isAllowed = seenPaths.get(relativePath);

			if (isAllowed === undefined) {
				isAllowed = await this._isAllowedToEdit(relativePath, edit.originalText, pathsToDirtyCommit);
				seenPaths.set(relativePath, isAllowed);
			}

			if (isAllowed) {
				allowedEdits.push(edit);
			}
		}
		return { editsToApply: allowedEdits, pathsToDirtyCommit };
	}

	/** Corresponds to Coder.allowed_to_edit */
	private async _isAllowedToEdit(relativePath: string, originalTextIfNew: string, pathsToDirtyCommit: Set<string>): Promise<boolean> {
		const absolutePath = this.getRepoFilePath(relativePath);

		if (this.absFnamesInChat.has(absolutePath)) {
			await this._checkForDirtyCommit(relativePath, pathsToDirtyCommit);
			return true;
		}

		const fileExists = await this._fileExists(absolutePath);

		if (!fileExists) {
			// Use PatchUtils for stripping
			const isIntentToCreate = !PatchUtils._stripQuotedWrapping(originalTextIfNew, relativePath, this.fence).trim();
			if (!isIntentToCreate) {
				logger.warn(`Skipping edit for non-existent file ${relativePath} with non-empty SEARCH block.`);
				return false;
			}
			logger.info(`Edit targets new file ${relativePath}. Assuming permission to create.`);
			// No actual file creation here; `_applyEdits` + `_doReplaceTs` handles it.
		} else {
			logger.info(`Edit targets file ${relativePath} not previously in chat. Assuming permission to edit.`);
		}

		// If allowed, add to chat and check for dirty commit
		this.absFnamesInChat.add(absolutePath);
		// TODO: Python's Coder.check_added_files() warns if too many files/tokens are in chat.
		// This could be added here.
		await this._checkForDirtyCommit(relativePath, pathsToDirtyCommit);
		return true;
	}

	/** Corresponds to Coder.check_for_dirty_commit */
	private async _checkForDirtyCommit(relativePath: string, pathsToDirtyCommit: Set<string>): Promise<void> {
		if (!this.vcs || !this.dirtyCommits || !(await this.vcs.isDirty(relativePath))) {
			return;
		}

		// Only add to pathsToDirtyCommit if this file was dirty before we started editing
		if (this.initiallyDirtyFiles.has(relativePath)) {
			logger.info(`File ${relativePath} has uncommitted changes from before our editing session.`);
			pathsToDirtyCommit.add(relativePath);
		} else {
			logger.info(`File ${relativePath} has uncommitted changes from our current editing session, skipping dirty commit.`);
		}
	}

	// _applyEdits method is removed and its logic moved to EditApplier.ts

	/** Generates error report for failed edits and sets `this.reflectedMessage` */
	private async _generateFailedEditReport(failed: EditBlock[], numPassed: number): Promise<void> {
		const numFailed = failed.length;
		const blocks = numFailed === 1 ? 'block' : 'blocks';
		let report = `# ${numFailed} SEARCH/REPLACE ${blocks} failed to match!\n`;

		for (const edit of failed) {
			report += `\n## SearchReplaceNoExactMatch: This SEARCH block failed to exactly match lines in ${edit.filePath}\n`;
			report += `<<<<<<< SEARCH\n${edit.originalText}=======\n${edit.updatedText}>>>>>>> REPLACE\n\n`;

			const absolutePath = this.getRepoFilePath(edit.filePath);
			let content: string | null = null;
			if (await this._fileExists(absolutePath)) {
				content = await this._readText(absolutePath);
			}

			if (content) {
				// const didYouMean = this._findSimilarLines(edit.originalText, content); // findSimilarLines is complex
				// if (didYouMean) {
				//     report += `Did you mean to match some of these actual lines from ${edit.filePath}?\n\n`;
				//     report += `${this.fence[0]}\n${didYouMean}\n${this.fence[1]}\n\n`;
				// }
				if (edit.updatedText && content.includes(edit.updatedText)) {
					report += `NOTE: The REPLACE lines are already present in ${edit.filePath}. Consider if this block is needed.\n\n`;
				}
			}
		}
		report += 'The SEARCH section must exactly match an existing block of lines including all white space, comments, indentation, etc.\n';
		if (numPassed > 0) {
			const pblocks = numPassed === 1 ? 'block' : 'blocks';
			report += `\n# The other ${numPassed} SEARCH/REPLACE ${pblocks} were applied successfully.\n`;
			report += `Don't re-send them.\nJust reply with fixed versions of the ${blocks} above that failed to match.\n`;
		}
		this.reflectedMessage = report;
	}

	// ---- Start of parsing/replacement logic (from aider/coders/editblock_coder.py) ----
	// These methods are direct ports or adaptations of the Python helper functions.

	// REMOVE the _findOriginalUpdateBlocks method from ApplySearchReplace
	// REMOVE the _findFilename method from ApplySearchReplace

	// REMOVE the following methods from ApplySearchReplace as they are now in PatchUtils:
	// _stripQuotedWrapping
	// _doReplace
	// _prep
	// _normalizeAndOutdent
	// _perfectReplace
	// _matchButForLeadingWhitespace
	// _replacePartWithMissingLeadingWhitespace
	// _tryDotDotDots
	// _escapeRegExp
	// _replaceMostSimilarChunk

	// Add this method inside the ApplySearchReplace class
	private async _formatFileForPrompt(relativePath: string): Promise<string | null> {
		const absolutePath = this.getRepoFilePath(relativePath);
		const content = await this._readText(absolutePath);
		if (content === null) {
			logger.warn(`Could not read file ${relativePath} for prompt inclusion.`);
			// Return a placeholder or skip if content is critical and unreadable
			return `${relativePath}\n[Could not read file content]`;
		}
		// Determine language for fence from file extension, default to 'text'
		const lang = path.extname(relativePath).substring(1) || 'text';
		return `${relativePath}\n${this.fence[0]}${lang}\n${content}\n${this.fence[1]}`;
	}

	public async buildPrompt(
		userRequest: string,
		additionalFilesToChatRelativePaths: string[] = [],
		readOnlyFilesRelativePaths: string[] = [],
		repoMapContent?: string,
	): Promise<LlmMessage[]> {
		const messages: LlmMessage[] = [];

		// --- System Prompt ---
		// ... (existing system prompt setup code remains unchanged) ...
		let finalRemindersText = '';
		if (this.useLazyPrompt) finalRemindersText += EDIT_BLOCK_PROMPTS.lazy_prompt;
		if (this.useOvereagerPrompt) finalRemindersText += EDIT_BLOCK_PROMPTS.overeager_prompt;

		let shellCmdPromptSection = '';
		if (this.suggestShellCommands) {
			shellCmdPromptSection = EDIT_BLOCK_PROMPTS.shell_cmd_prompt.replace('{platform}', platform());
		} else {
			shellCmdPromptSection = EDIT_BLOCK_PROMPTS.no_shell_cmd_prompt.replace('{platform}', platform());
		}

		const mainSystemContent = EDIT_BLOCK_PROMPTS.main_system
			.replace('{language}', this.language)
			.replace('{final_reminders}', finalRemindersText.trim())
			.replace('{shell_cmd_prompt_section}', shellCmdPromptSection);

		const systemReminderContent = EDIT_BLOCK_PROMPTS.system_reminder
			.replace(/{fence_0}/g, this.fence[0])
			.replace(/{fence_1}/g, this.fence[1])
			.replace('{quad_backtick_reminder}', this.quadBacktickReminder)
			.replace('{rename_with_shell_section}', this.suggestShellCommands ? EDIT_BLOCK_PROMPTS.rename_with_shell : '')
			.replace('{go_ahead_tip_section}', EDIT_BLOCK_PROMPTS.go_ahead_tip)
			.replace('{final_reminders}', finalRemindersText.trim())
			.replace('{shell_cmd_reminder_section}', this.suggestShellCommands ? EDIT_BLOCK_PROMPTS.shell_cmd_reminder : '');

		messages.push({
			role: 'system',
			content: `${mainSystemContent}\n\n${systemReminderContent}`,
		});

		// --- Example Messages ---
		EDIT_BLOCK_PROMPTS.example_messages_template.forEach((msgTemplate) => {
			messages.push({
				role: msgTemplate.role as 'system' | 'user' | 'assistant',
				content: msgTemplate.content.replace(/{fence_0}/g, this.fence[0]).replace(/{fence_1}/g, this.fence[1]),
			});
		});

		// --- File Context ---
		additionalFilesToChatRelativePaths.forEach((relPath) => {
			this.absFnamesInChat.add(this.getRepoFilePath(relPath));
		});

		const currentFilesInChatRelative = Array.from(this.absFnamesInChat).map((absPath) => this.getRelativeFilePath(absPath));

		if (currentFilesInChatRelative.length > 0) {
			// Modified part for editable files
			let filesContentBlock = EDIT_BLOCK_PROMPTS.files_content_prefix;
			for (const relPath of currentFilesInChatRelative) {
				const formattedFile = await this._formatFileForPrompt(relPath);
				// formattedFile will include a placeholder if reading failed, so always add it.
				filesContentBlock += `\n\n${formattedFile}`;
			}
			messages.push({ role: 'user', content: filesContentBlock });
			messages.push({ role: 'assistant', content: EDIT_BLOCK_PROMPTS.files_content_assistant_reply });
		} else if (repoMapContent) {
			messages.push({ role: 'user', content: EDIT_BLOCK_PROMPTS.files_no_full_files_with_repo_map });
			messages.push({ role: 'assistant', content: EDIT_BLOCK_PROMPTS.files_no_full_files_with_repo_map_reply });
		} else {
			messages.push({ role: 'user', content: EDIT_BLOCK_PROMPTS.files_no_full_files });
			// No standard assistant reply for this one in python version, so we omit it too.
		}

		if (readOnlyFilesRelativePaths.length > 0) {
			// Modified part for read-only files
			let readOnlyFilesContentBlock = EDIT_BLOCK_PROMPTS.read_only_files_prefix;
			for (const relPath of readOnlyFilesRelativePaths) {
				const formattedFile = await this._formatFileForPrompt(relPath);
				// formattedFile will include a placeholder if reading failed, so always add it.
				readOnlyFilesContentBlock += `\n\n${formattedFile}`;
			}
			messages.push({ role: 'user', content: readOnlyFilesContentBlock });
			// Adding a custom assistant reply for clarity, as Python's is generic or missing here.
			messages.push({ role: 'assistant', content: 'Ok, I will treat these files as read-only and not propose changes to them.' });
		}

		// Add repo map content if provided and not already handled by files_no_full_files_with_repo_map
		// (i.e., if there are files in chat, or no files in chat and no repo map specific message was used)
		if (repoMapContent && (currentFilesInChatRelative.length > 0 || !EDIT_BLOCK_PROMPTS.files_no_full_files_with_repo_map)) {
			messages.push({
				role: 'user',
				content: `${EDIT_BLOCK_PROMPTS.repo_content_prefix}\n${repoMapContent}`,
			});
			messages.push({ role: 'assistant', content: 'Ok, I will use this repository information for context.' });
		}

		messages.push({ role: 'user', content: userRequest });

		return messages;
	}
}
