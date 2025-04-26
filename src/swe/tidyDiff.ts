import { getFileSystem, llms } from '#agent/agentContextLocalStorage';
import { FileSystemWrite } from '#functions/storage/fileSystemWrite';
import { logger } from '#o11y/logger';
import { span } from '#o11y/trace';

interface TidyPatch {
	filePath: string;
	/** A unique block of text from the *current* file content to find and replace */
	search: string;
	/** The replacement text. Use an empty string to delete the 'search' block. */
	replace: string;
}

/**
 * Reviews the diff since a base commit/branch and applies minor tidying changes.
 * Focuses on removing spurious comments, reverting unnecessary deletions, and minor style fixes
 * introduced in the diff, using a patch-like mechanism.
 * @param baseCommitOrBranch The git commit sha or branch name to diff against.
 */
// @span() // Decorators cannot be applied directly to exported functions like this. Manual span needed if tracing is required.
export async function tidyDiff(baseCommitOrBranch: string): Promise<void> {
	logger.info(`Tidying diff since ${baseCommitOrBranch}`);
	const fs = getFileSystem();
	const vcs = fs.getVcs();
	const diff = await vcs.getDiff(baseCommitOrBranch);

	if (!diff.trim()) {
		logger.info('No diff found to tidy.');
		return;
	}
	// TODO should convert the diffs to the current code only like in the rawCode var in addCodeWithLineNumbers() in gitLabCodeReview.ts

	// Note: Using a direct prompt string here instead of buildPrompt as the structure is very specific.
	const prompt = `
You are a meticulous code reviewer focused on tidying up code changes.
Analyze the following git diff, which represents recent changes compared to ${baseCommitOrBranch}.

<diff>
${diff}
</diff>

Your goal is to identify minor issues *introduced by these changes* and provide instructions to fix them using search and replace on the *current* file content. Focus ONLY on:
1.  **Removing Spurious Comments:** Find comments added in the diff (lines starting with '+') that add no value (e.g., "// Adding here", "// Fixed bug", "// Temporary variable", "console.log('debug')"). Provide a search/replace to remove them entirely (replace with empty string).
2.  **Reverting Unnecessary Deletions:** If a line was deleted (starts with '-') but seems important, unrelated to the main task, or accidentally removed, provide a search/replace instruction to add it back. You'll need to find an adjacent line in the *current* code to use in the 'search' block and construct the 'replace' block to include the original line plus the deleted line.
3.  **Minor Style Adjustments:** For lines added (start with '+'), if they have minor style inconsistencies (e.g., wrong indentation compared to neighbors, inconsistent spacing), provide a search/replace to fix them. Ensure the 'search' block uniquely identifies the problematic lines in the current code.

**Important Rules:**
*   The 'search' string MUST uniquely identify the target lines in the *current* version of the file (after the diff changes were applied). Include enough context lines (neighboring lines) if necessary for uniqueness.
*   The 'search' string MUST exactly match the content in the current file, including all whitespace and line breaks.
*   Do NOT suggest functional changes, refactoring, or requirement-related edits. This is purely about cleaning up the diff itself.
*   Do NOT suggest removing logging statements unless they are clearly temporary debug statements (like 'console.log("debug")').
*   If reverting a deletion, the 'replace' block should contain the original context line(s) from the 'search' block *plus* the line(s) that were deleted, in the correct order.
*   If removing a line (like a spurious comment), the 'replace' block should contain the context lines from the 'search' block *minus* the line to be removed. If the line to remove is the only line in 'search', 'replace' should be an empty string.

Respond ONLY with a JSON object in the following format. Provide an empty array for "tidyPatches" if no tidying is needed.

<json>
{
  "tidyPatches": [
    {
      "filePath": "path/to/file.ext",
      "search": "unique string block from current file to find\\nincluding necessary context lines\\nand exact whitespace",
      "replace": "replacement string block\\nwith the tidied content\\nor empty string to delete"
    }
    // ... more patches
  ]
}
</json>
`;

	try {
		const response = (await llms().medium.generateJson(prompt, { id: 'Tidy Diff' })) as {
			tidyPatches: TidyPatch[];
		};

		if (!response || !Array.isArray(response.tidyPatches) || response.tidyPatches.length === 0) {
			logger.info('No tidying actions identified.');
			return;
		}

		logger.info(`Applying ${response.tidyPatches.length} tidy patches.`);
		const fileWriter = new FileSystemWrite();
		let appliedPatches = false; // Flag to track if any changes were made

		for (const patch of response.tidyPatches) {
			if (!patch.filePath || typeof patch.search !== 'string' || typeof patch.replace !== 'string') {
				logger.warn('Skipping invalid patch:', patch);
				continue;
			}
			try {
				logger.info(`Applying tidy patch to ${patch.filePath}`);
				// Use the existing patchEditFile function which handles file reading/writing and search/replace.
				await fileWriter.patchEditFile(patch.filePath, patch.search, patch.replace);
				appliedPatches = true; // Mark that a patch was successfully applied
			} catch (editError) {
				logger.error(`Failed to apply tidy patch to ${patch.filePath}: ${editError.message}`, {
					search: patch.search,
					replace: patch.replace,
				});
				// Continue to the next patch even if one fails
			}
		}

		// Commit the tidying changes
		try {
			// Check if any patches were successfully applied before committing
			if (appliedPatches) {
				// Call commit with only the message, assuming it handles staging or commits all changes.
				await vcs.commit('Apply automated code tidying');
				logger.info('Committed tidying changes.');
			} else {
				logger.info('No files were successfully changed by tidying patches.');
			}
		} catch (commitError) {
			logger.error(`Failed to commit tidying changes: ${commitError.message}`);
			// Log the error but don't throw, as the main task might still be complete.
		}
	} catch (llmError) {
		logger.error(`Error during diff tidying LLM call: ${llmError.message}`);
		// Don't throw, allow the workflow to continue.
	}
}
