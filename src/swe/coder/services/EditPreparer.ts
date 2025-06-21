import { join } from 'node:path';
import { logger } from '#o11y/logger';
import type { IFileSystemService } from '#shared/files/fileSystemService';
import type { VersionControlSystem } from '#shared/scm/versionControlSystem';
import type { EditBlock } from '../coderTypes';
import { stripQuotedWrapping } from '../patchUtils';
import type { EditSession } from '../state/EditSession';

export class EditPreparer {
	constructor(
		private fs: IFileSystemService,
		private vcs: VersionControlSystem | null,
		private fence: [string, string],
	) {}

	async prepare(
		blocks: EditBlock[],
		session: EditSession,
		fileContentSnapshots: Map<string, string | null>,
		absFnamesInChat: Set<string>,
		initiallyDirtyFiles: Set<string>,
	): Promise<PrepareResult> {
		const result: PrepareResult = {
			validBlocks: [],
			dirtyFiles: new Set(),
			externalChanges: [],
		};

		// Check for external changes first
		result.externalChanges = await this.detectExternalChanges(blocks, session, fileContentSnapshots);
		if (result.externalChanges.length > 0) {
			// If files have changed externally, we stop and report it.
			// The orchestrator will handle this by regenerating the prompt.
			return result;
		}

		// Check permissions and dirty state for each block
		for (const block of blocks) {
			const check = await this.checkFilePermissions(block, session, absFnamesInChat, initiallyDirtyFiles);
			if (check.allowed) {
				result.validBlocks.push(block);
				if (check.isDirty) {
					result.dirtyFiles.add(block.filePath);
				}
			}
			// If not allowed, the block is simply ignored and not added to validBlocks.
		}

		return result;
	}

	private getRepoFilePath(workingDir: string, relativePath: string): string {
		return join(workingDir, relativePath);
	}

	/** Returns list of file paths that have changed since their snapshot. */
	private async detectExternalChanges(blocks: EditBlock[], session: EditSession, fileContentSnapshots: Map<string, string | null>): Promise<string[]> {
		const changed: string[] = [];
		const uniquePaths = new Set(blocks.map((b) => b.filePath));
		for (const relPath of uniquePaths) {
			const snapshot = fileContentSnapshots.get(relPath);
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

	/**
	 * Checks if an edit is allowed for a given file path and determines if a "dirty commit" is needed.
	 * Corresponds to Coder.allowed_to_edit and Coder.check_for_dirty_commit.
	 */
	private async checkFilePermissions(
		block: EditBlock,
		session: EditSession,
		absFnamesInChat: Set<string>,
		initiallyDirtyFiles: Set<string>,
	): Promise<{ allowed: boolean; isDirty: boolean }> {
		const { filePath, originalText } = block;
		const absolutePath = this.getRepoFilePath(session.workingDir, filePath);
		let isDirty = false;

		if (absFnamesInChat?.has(absolutePath)) {
			if (this.vcs && initiallyDirtyFiles?.has(filePath) && (await this.vcs.isDirty(filePath))) {
				isDirty = true;
			}
			return { allowed: true, isDirty };
		}

		const fileExists = await this.fs.fileExists(absolutePath);

		if (!fileExists) {
			const isIntentToCreate = !stripQuotedWrapping(originalText, filePath, this.fence).trim();
			if (!isIntentToCreate) {
				logger.warn(`Skipping edit for non-existent file ${filePath} with non-empty SEARCH block (validation should catch this).`);
				return { allowed: false, isDirty: false };
			}
			logger.info(`Edit targets new file ${filePath}. Assuming permission to create.`);
		} else {
			logger.info(`Edit targets file ${filePath} not previously in chat. Assuming permission to edit.`);
		}

		absFnamesInChat?.add(absolutePath);

		if (this.vcs && initiallyDirtyFiles?.has(filePath) && (await this.vcs.isDirty(filePath))) {
			isDirty = true;
		}
		return { allowed: true, isDirty };
	}
}

export interface PrepareResult {
	validBlocks: EditBlock[];
	dirtyFiles: Set<string>;
	externalChanges: string[];
}
