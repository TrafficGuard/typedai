import { join } from 'node:path';
import { logger } from '#o11y/logger';
import type { IFileSystemService } from '#shared/files/fileSystemService';
import type { VersionControlSystem } from '#shared/scm/versionControlSystem';
import type { EditBlock } from '../coderTypes';
import { stripQuotedWrapping } from '../patchUtils';
import type { EditSession } from '../state/editSession';

export class EditPreparer {
	constructor(
		private fs: IFileSystemService,
		private vcs: VersionControlSystem | null,
		private fence: [string, string],
	) {}

	async prepare(blocks: EditBlock[], session: EditSession): Promise<PrepareResult> {
		const result: PrepareResult = {
			validBlocks: [],
		};

		// Check permissions and dirty state for each block
		for (const block of blocks) {
			const check = await this.checkFilePermissions(block, session);
			if (check.allowed) {
				result.validBlocks.push(block);
			}
			// If not allowed, the block is simply ignored and not added to validBlocks.
		}

		return result;
	}

	private getRepoFilePath(workingDir: string, relativePath: string): string {
		return join(workingDir, relativePath);
	}

	/**
	 * Checks if an edit is allowed for a given file path and determines if a "dirty commit" is needed.
	 * Corresponds to Coder.allowed_to_edit and Coder.check_for_dirty_commit.
	 */
	private async checkFilePermissions(block: EditBlock, session: EditSession): Promise<{ allowed: boolean }> {
		const { filePath, originalText } = block;
		const absolutePath = this.getRepoFilePath(session.workingDir, filePath);

		if (session.absFnamesInChat?.has(absolutePath)) {
			return { allowed: true };
		}

		const fileExists = await this.fs.fileExists(absolutePath);

		if (!fileExists) {
			const isIntentToCreate = !stripQuotedWrapping(originalText, filePath, this.fence).trim();
			if (!isIntentToCreate) {
				logger.warn(`Skipping edit for non-existent file ${filePath} with non-empty SEARCH block (validation should catch this).`);
				return { allowed: false };
			}
			logger.info(`Edit targets new file ${filePath}. Assuming permission to create.`);
		} else {
			logger.info(`Edit targets file ${filePath} not previously in chat. Assuming permission to edit.`);
		}

		session.addFileToChat(absolutePath);

		return { allowed: true };
	}
}

export interface PrepareResult {
	validBlocks: EditBlock[];
}
