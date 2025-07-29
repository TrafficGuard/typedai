import * as path from 'node:path';
import { logger } from '#o11y/logger';
import type { IFileSystemService } from '#shared/files/fileSystemService';
import type { EditBlock } from './coderTypes';
import { doReplace } from './patchUtils';

export interface ApplyEditsOptions {
	fs: IFileSystemService;
	lenientWhitespace: boolean;
	fence: [string, string];
	rootPath: string;
}

export async function applyEdits(blocks: EditBlock[], options: ApplyEditsOptions): Promise<{ appliedFilePaths: Set<string>; failedEdits: EditBlock[] }> {
	const { fs, lenientWhitespace, fence, rootPath } = options;
	const appliedFilePaths = new Set<string>(); // Stores relative paths
	const failedEdits: EditBlock[] = [];

	for (const edit of blocks) {
		const originalRelativePath = edit.filePath;
		const originalAbsolutePath = path.resolve(rootPath, originalRelativePath);
		let currentContent: string | null = null;

		if (await fs.fileExists(originalAbsolutePath)) {
			try {
				currentContent = await fs.readFile(originalAbsolutePath);
			} catch (e: any) {
				logger.warn(`Failed to read file at ${originalAbsolutePath}: ${e.message}`);
				currentContent = null;
			}
		}

		const newContent = doReplace(originalRelativePath, currentContent, edit.originalText, edit.updatedText, fence, lenientWhitespace);

		if (newContent !== undefined) {
			try {
				await fs.writeFile(originalAbsolutePath, newContent);
			} catch (e: any) {
				logger.error(`Failed to write applied edit to ${originalRelativePath}: ${e.message}`);
				failedEdits.push({ ...edit, filePath: originalRelativePath }); // Report failure against original path
				continue;
			}
			logger.info(`Successfully applied edit to ${originalRelativePath}`);
			appliedFilePaths.add(originalRelativePath);
		} else {
			logger.warn(`Failed to apply edit for ${originalRelativePath}, no suitable match or fallback found.`);
			failedEdits.push(edit);
		}
	}

	return { appliedFilePaths, failedEdits };
}
