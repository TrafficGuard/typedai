import * as fs from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { getFileSystem } from '#agent/agentContextLocalStorage';
import { logger } from '#o11y/logger';

/**
 * Adds to the file selection any custom rules/conventions files matching the Cursor and Aider naming standards
 * which are in the same folder or parents folders or the files in the file selection.
 * @param fileSelection
 */
export async function includeAlternativeAiToolFiles(fileSelection: string[]) {
	logger.warn('includeAlternativeAiToolFiles not yet correctly implemented');
	if (logger.warn) return;
	// https://docs.cursor.com/context/rules-for-ai
	const cursorRules = '.cursorrules';
	// https://aider.chat/docs/usage/conventions.html
	const aiderConventions = 'CONVENTIONS.md';
	// TODO read the .aider.conf.yml config file
	// Cline .clinerules https://github.com/cline/cline/discussions/622#discussioncomment-11666441
	// Continue.dev
	// https://docs.continue.dev/reference?ref=blog.continue.dev#rules

	const fileSelectionSet = new Set(fileSelection);

	const folderSet = new Set<string>();

	const cwd = getFileSystem().getWorkingDirectory();

	// Create a set of all the folders which contains the folders from the file selection files, and all the parent folders up to the Git repository root.
	for (const file of fileSelection) {
		let currentFolder = dirname(join(cwd, file));

		while (currentFolder && currentFolder !== '.') {
			folderSet.add(currentFolder);

			// Check if we've reached the git repository root
			try {
				const gitStats = await fs.lstat(join(currentFolder, '.git'));
				if (gitStats.isDirectory()) break;
			} catch {
				// .git doesn't exist in this folder, continue up the tree
			}

			// Move to parent folder
			const parentFolder = dirname(currentFolder);
			if (parentFolder === currentFolder) {
				break; // Prevent infinite loop at root
			}
			currentFolder = parentFolder;
		}
	}

	// Go through this set of folders and check if the standards files from the other AI tools exist in those folders.
	// If so, add them to the fileSelection list (if its not already in the fileSelection set)
	await Promise.all(
		Array.from(folderSet).map(async (folder) => {
			const cursorRulesPath = join(folder, cursorRules);
			const conventionsPath = join(folder, aiderConventions);

			const [cursorExists, conventionsExists] = await Promise.all([
				fs
					.lstat(cursorRulesPath)
					.then((stats) => stats.isFile())
					.catch(() => false),
				fs
					.lstat(conventionsPath)
					.then((stats) => stats.isFile())
					.catch(() => false),
			]);

			if (cursorExists && !fileSelectionSet.has(cursorRulesPath)) {
				fileSelection.push(cursorRulesPath);
				fileSelectionSet.add(cursorRulesPath);
			}

			if (conventionsExists && !fileSelectionSet.has(conventionsPath)) {
				fileSelection.push(conventionsPath);
				fileSelectionSet.add(conventionsPath);
			}
		}),
	);
}
