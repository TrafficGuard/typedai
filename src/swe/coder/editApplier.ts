import * as path from 'node:path';
import { logger } from '#o11y/logger';
import type { IFileSystemService } from '#shared/files/fileSystemService';
import type { VersionControlSystem } from '#shared/scm/versionControlSystem';
import type { EditBlock } from './coderTypes';
import { doReplace } from './patchUtils'; // Updated import

export class EditApplier {
	constructor(
		private fs: IFileSystemService,
		private vcs: VersionControlSystem | null,
		private lenientWhitespace: boolean,
		private fence: [string, string],
		private rootPath: string, // Absolute path to the project root
		private absFnamesInChat: Set<string>, // Absolute paths of files explicitly in chat for fallback
		private autoCommit: boolean, // For committing successful edits
		private dryRun: boolean,
	) {}

	private getRepoFilePath(relativePath: string): string {
		return path.resolve(this.rootPath, relativePath);
	}

	private getRelativeFilePath(absolutePath: string): string {
		return path.relative(this.rootPath, absolutePath);
	}

	private async fileExists(absolutePath: string): Promise<boolean> {
		return this.fs.fileExists(absolutePath);
	}

	private async readText(absolutePath: string): Promise<string | null> {
		try {
			return await this.fs.readFile(absolutePath);
		} catch (e: any) {
			logger.warn(`Failed to read file at ${absolutePath}: ${e.message}`);
			return null;
		}
	}

	private async writeText(absolutePath: string, content: string): Promise<void> {
		// Note: content is expected to end with a newline, as ensured by the _doReplace processing chain.
		await this.fs.writeFile(absolutePath, content);
	}

	async apply(blocks: EditBlock[]): Promise<{ appliedFilePaths: Set<string>; failedEdits: EditBlock[] }> {
		const appliedFilePaths = new Set<string>(); // Stores relative paths
		const failedEdits: EditBlock[] = [];

		for (const edit of blocks) {
			const originalRelativePath = edit.filePath;
			const originalAbsolutePath = this.getRepoFilePath(originalRelativePath);
			let currentContent: string | null = null;

			if (await this.fileExists(originalAbsolutePath)) {
				currentContent = await this.readText(originalAbsolutePath);
			}

			let newContent = doReplace(originalRelativePath, currentContent, edit.originalText, edit.updatedText, this.fence, this.lenientWhitespace);

			let appliedToAbsolutePath = originalAbsolutePath;
			let appliedRelativePath = originalRelativePath;

			// Fallback logic
			if (newContent === undefined && currentContent !== null) {
				logger.debug(`Edit for ${originalRelativePath} failed. Attempting fallback on other in-chat files.`);
				for (const chatFileAbs of this.absFnamesInChat) {
					if (chatFileAbs === originalAbsolutePath) continue;

					const chatFileRel = this.getRelativeFilePath(chatFileAbs);
					let fallbackContent: string | null = null;
					if (await this.fileExists(chatFileAbs)) {
						fallbackContent = await this.readText(chatFileAbs);
					}

					if (fallbackContent !== null) {
						const fallbackNewContent = doReplace(chatFileRel, fallbackContent, edit.originalText, edit.updatedText, this.fence, this.lenientWhitespace);
						if (fallbackNewContent !== undefined) {
							logger.info(`Applied edit originally for ${originalRelativePath} to ${chatFileRel} as a fallback.`);
							newContent = fallbackNewContent;
							appliedToAbsolutePath = chatFileAbs;
							appliedRelativePath = chatFileRel;
							break; // Found a successful fallback
						}
					}
				}
			}

			if (newContent !== undefined) {
				if (!this.dryRun) {
					try {
						await this.writeText(appliedToAbsolutePath, newContent);
					} catch (e: any) {
						logger.error(`Failed to write applied edit to ${appliedRelativePath}: ${e.message}`);
						failedEdits.push({ ...edit, filePath: originalRelativePath }); // Report failure against original path
						continue;
					}
				}
				logger.info(`Successfully applied edit to ${appliedRelativePath}${this.dryRun ? ' (dry run)' : ''}`);
				appliedFilePaths.add(appliedRelativePath);
			} else {
				logger.warn(`Failed to apply edit for ${originalRelativePath}, no suitable match or fallback found.`);
				failedEdits.push(edit);
			}
		}

		if (this.autoCommit && !this.dryRun && this.vcs && appliedFilePaths.size > 0) {
			const commitMessage = 'Applied LLM-generated edits';
			try {
				const filesToCommit = Array.from(appliedFilePaths);
				// Use the more precise method already available in the interface
				await this.vcs.addAndCommitFiles(filesToCommit, commitMessage);
				logger.info(`Auto-committed changes for ${filesToCommit.length} files: ${filesToCommit.join(', ')}.`);
			} catch (commitError: any) {
				logger.error({ err: commitError }, 'Auto-commit failed after applying edits.');
				// This error is logged, but doesn't make the apply operation fail at this stage.
				// The orchestrator (SearchReplaceCoder) might handle this if it's critical.
			}
		}

		return { appliedFilePaths, failedEdits };
	}
}
