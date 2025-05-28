import { platform } from 'node:os';
import * as path from 'node:path';
import { getFileSystem } from '#agent/agentContextLocalStorage';
import { logger } from '#o11y/logger';
import type { LLM, LlmMessage } from '#shared/model/llm.model';
import type { IFileSystemService } from '#shared/services/fileSystemService';
import type { VersionControlSystem } from '#shared/services/versionControlSystem';
import { _stripFilename } from '#swe/coder/applySearchReplaceUtils';
import { EDIT_BLOCK_PROMPTS } from '#swe/coder/searchReplacePrompts';
import { PatchUtils } from './patchUtils'; // Added import

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
		const edits = this._getEdits();
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
				// Python: self.repo.commit(fnames=self.need_commit_before_edits)
				// This requires staging and committing specific files.
				// Assuming `this.vcs.commitFiles(dirtyFilesArray, "Aider: Committing uncommitted changes before applying LLM edits")`
				// If not available, a general commit is a fallback.
				await this.vcs.addAllTrackedAndCommit('Aider: Committing uncommitted changes before applying LLM edits');
				logger.info('Successfully committed dirty files.');
			} catch (commitError: any) {
				logger.error({ err: commitError }, 'Dirty commit failed for uncommitted changes.');
				this.reflectedMessage = `Failed to commit uncommitted changes for ${dirtyFilesArray.join(', ')}: ${commitError.message}`;
				throw commitError; // This is a blocking issue for applying edits safely.
			}
		}

		const { passed, failed } = await this._applyEdits(editsToApply);

		if (failed.length > 0) {
			// This method will set this.reflectedMessage
			await this._generateFailedEditReport(failed, passed);
		}

		return new Set(passed.map((edit) => edit.filePath)); // Return relative paths
	}

	/** Corresponds to EditBlockCoder.get_edits */
	private _getEdits(): EditBlock[] {
		return this._findOriginalUpdateBlocks(this.currentLlmResponseContent, this.fence);
	}

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

	/** Corresponds to EditBlockCoder.apply_edits */
	private async _applyEdits(edits: EditBlock[]): Promise<{ passed: EditBlock[]; failed: EditBlock[] }> {
		const passed: EditBlock[] = [];
		const failed: EditBlock[] = [];

		for (const edit of edits) {
			const relativePath = edit.filePath;
			const absolutePath = this.getRepoFilePath(relativePath);
			let currentContent: string | null = null;

			if (await this._fileExists(absolutePath)) {
				currentContent = await this._readText(absolutePath);
			}

			// Use PatchUtils._doReplace
			let newContent = PatchUtils._doReplace(
				relativePath,
				currentContent,
				edit.originalText,
				edit.updatedText,
				this.fence,
				this.lenientLeadingWhitespace,
			);

			let appliedToPath = absolutePath;
			let appliedRelPath = relativePath;

			// Fallback logic from Python: try patching other files in chat
			if (newContent === undefined && currentContent !== null) {
				logger.debug(`Edit for ${relativePath} failed. Attempting fallback on other in-chat files.`);
				for (const chatFileAbs of this.absFnamesInChat) {
					if (chatFileAbs === absolutePath) continue;

					const chatFileRel = this.getRelativeFilePath(chatFileAbs);
					let fallbackContent: string | null = null;
					if (await this._fileExists(chatFileAbs)) {
						fallbackContent = await this._readText(chatFileAbs);
					}

					if (fallbackContent !== null) {
						// Use PatchUtils._doReplace for fallback
						const fallbackNewContent = PatchUtils._doReplace(
							chatFileRel,
							fallbackContent,
							edit.originalText,
							edit.updatedText,
							this.fence,
							this.lenientLeadingWhitespace,
						);
						if (fallbackNewContent !== undefined) {
							logger.info(`Applied edit originally for ${relativePath} to ${chatFileRel} as a fallback.`);
							newContent = fallbackNewContent;
							appliedToPath = chatFileAbs;
							appliedRelPath = chatFileRel;
							break; // Found a successful fallback
						}
					}
				}
			}

			if (newContent !== undefined) {
				if (!this.dryRun) {
					try {
						await this._writeText(appliedToPath, newContent);
					} catch (e: any) {
						logger.error(`Failed to write applied edit to ${appliedRelPath}: ${e.message}`);
						failed.push({ ...edit, filePath: relativePath }); // Original path for failure report
						continue; // Skip adding to passed
					}
				}
				logger.info(`Successfully applied edit to ${appliedRelPath}${this.dryRun ? ' (dry run)' : ''}`);
				passed.push({ ...edit, filePath: appliedRelPath }); // filePath might have changed due to fallback
			} else {
				logger.warn(`Failed to apply edit for ${relativePath}, no suitable match or fallback found.`);
				failed.push(edit);
			}
		}
		return { passed, failed };
	}

	/** Generates error report for failed edits and sets `this.reflectedMessage` */
	private async _generateFailedEditReport(failed: EditBlock[], passed: EditBlock[]): Promise<void> {
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
		if (passed.length > 0) {
			const pblocks = passed.length === 1 ? 'block' : 'blocks';
			report += `\n# The other ${passed.length} SEARCH/REPLACE ${pblocks} were applied successfully.\n`;
			report += `Don't re-send them.\nJust reply with fixed versions of the ${blocks} above that failed to match.\n`;
		}
		this.reflectedMessage = report;
	}

	// ---- Start of parsing/replacement logic (from aider/coders/editblock_coder.py) ----
	// These methods are direct ports or adaptations of the Python helper functions.

	_findOriginalUpdateBlocks(llmResponseContent: string, fenceForFilenameScan: [string, string]): EditBlock[] {
		// Corresponds to find_original_update_blocks from editblock_coder.py
		const edits: EditBlock[] = [];
		if (!llmResponseContent) return edits;
		let content = llmResponseContent;

		// Pre-process to ensure markers are on new lines if they are immediately preceded by non-whitespace characters.
		// This handles cases like "filename.ext<<<<<<< SEARCH" by converting to "filename.ext\n<<<<<<< SEARCH"
		content = content.replace(/([^\r\n])(<<<<<<< SEARCH|=======|>>>>>>> REPLACE)/g, '$1\n$2');

		if (!content.endsWith('\n')) {
			content += '\n';
		}

		// Regex to split by markers, keeping the markers.
		// Each marker must be at the start of a line, optionally followed by spaces, then a newline.
		const splitRegex = new RegExp(`^(${SEARCH_MARKER}|${DIVIDER_MARKER}|${REPLACE_MARKER})[ ]*\\n`, 'gm');

		// Perform the split. `split` with a capturing group inserts the captured delimiters into the array.
		// E.g., "A<M1>B<M2>C" split by /(<M1>|<M2>)/ becomes ["A", "<M1>", "B", "<M2>", "C"]
		// If it starts/ends with delimiter or has consecutive delimiters, empty strings can appear.
		// E.g. "<M1>A<M2>" -> ["", "<M1>", "A", "<M2>", ""]
		const rawParts = content.split(splitRegex);
		// Filter out potential `undefined` values that `split` might introduce in some JS engines if a group doesn't match,
		// and remove empty strings that result from content starting/ending with a delimiter or consecutive delimiters,
		// UNLESS that empty string is actual content (e.g. empty search/replace block).
		// The crucial part is that `parts[i+1]` should be a marker, and `parts[i+2]` its content.
		// A simple filter(Boolean) might remove legitimate empty content blocks.
		// Let's refine the loop to handle potentially empty content parts carefully.
		const parts = rawParts.filter((p) => p !== undefined);

		let currentFilePath: string | undefined = undefined;
		let i = 0;

		while (i < parts.length) {
			const potentialPrecedingText = parts[i];

			if (i + 1 >= parts.length) break; // Not enough parts for a marker

			const marker = parts[i + 1];

			if (marker.startsWith(SEARCH_MARKER)) {
				const filePathFromPreceding = this._findFilename(potentialPrecedingText, fenceForFilenameScan[0]);
				if (filePathFromPreceding) {
					currentFilePath = filePathFromPreceding;
				}

				if (!currentFilePath) {
					logger.warn('Search block found without a valid preceding or sticky filename. Skipping block.', {
						textBeforeSearch: potentialPrecedingText.substring(0, 100),
					});
					i += 2; // Advance past potentialPrecedingText and SEARCH_MARKER
					continue;
				}

				// Expect: OriginalText, DividerMarker, UpdatedText, ReplaceMarker
				// Indices: i+2         i+3            i+4          i+5
				if (i + 5 >= parts.length) {
					logger.warn(`Malformed block for ${currentFilePath}: Incomplete structure after SEARCH_MARKER. Found ${parts.length - (i + 1)} parts instead of 4.`);
					break;
				}

				const originalText = parts[i + 2];
				const dividerMarker = parts[i + 3];
				const updatedText = parts[i + 4];
				const replaceMarker = parts[i + 5];

				if (!dividerMarker.startsWith(DIVIDER_MARKER)) {
					logger.warn(
						`Malformed block for ${currentFilePath}: Expected DIVIDER_MARKER, found ${dividerMarker.trim()}. Content: ${originalText.substring(0, 100)}`,
					);
					i += 2; // Skip potentialPrecedingText and SEARCH_MARKER, try to resync
					continue;
				}
				if (!replaceMarker.startsWith(REPLACE_MARKER)) {
					logger.warn(
						`Malformed block for ${currentFilePath}: Expected REPLACE_MARKER, found ${replaceMarker.trim()}. Content: ${updatedText.substring(0, 100)}`,
					);
					// Advance past potentialPrecedingText, SEARCH_MARKER, originalText, DIVIDER_MARKER
					i += 4;
					continue;
				}

				edits.push({ filePath: currentFilePath, originalText, updatedText });
				i += 6; // Consumed: potentialPrecedingText, S_M, originalText, D_M, updatedText, R_M
			} else {
				// Current part `parts[i]` is not followed by a SEARCH_MARKER.
				// This means `parts[i]` is some text, and `parts[i+1]` is an unexpected DIVIDER/REPLACE or end of content.
				// Advance by 2 to look for the next SEARCH_MARKER.
				i += 2;
			}
		}
		return edits;
	}

	/**
	 * Finds a filename from the last few lines of the preceding text content.
	 * Corresponds to find_filename from aider's editblock_coder.py.
	 * Uses the _stripFilename utility.
	 */
	private _findFilename(precedingContent: string, fenceOpen: string): string | undefined {
		// Corresponds to find_filename from aider's editblock_coder.py
		// Process lines from bottom up from the precedingContent.
		const lines = precedingContent.split('\n');

		// Take last 3 lines, or fewer if not enough lines.
		// Python version reverses then takes up to 3.
		// Here, we access from the end of the non-reversed array.
		const numLinesToConsider = Math.min(lines.length, 3);
		for (let k = 0; k < numLinesToConsider; k++) {
			// lineIndex goes from lines.length-1 down to lines.length-numLinesToConsider
			const lineIndex = lines.length - 1 - k;
			const line = lines[lineIndex];

			const filename = _stripFilename(line, fenceOpen);
			if (filename) {
				return filename;
			}
			// Python's logic: if line is not a filename and not a fence, stop.
			// This means if we see "random text" on line N-1, we don't look at N-2.
			const trimmedLine = line.trim();
			if (!trimmedLine.startsWith(fenceOpen) && trimmedLine !== '') {
				// If it's the last line of precedingContent (k=0) and it's not a filename/fence,
				// then no filename is found from this line. If it's not the last line (k>0),
				// and this line breaks the pattern, we stop searching further up.
				return undefined;
			}
		}
		return undefined;
	}

	// Remove the local _stripFilename as it's now imported from searchReplaceUtils
	// private _stripFilename(...) { ... }

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
