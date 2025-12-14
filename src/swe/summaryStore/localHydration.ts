import path from 'node:path';
import { getFileSystem } from '#agent/agentContextUtils';
import { typedaiDirName } from '#app/appDirs';
import { logger } from '#o11y/logger';
import type { IFileSystemService } from '#shared/files/fileSystemService';
import type { Summary } from '#swe/index/llmSummaries';

/**
 * Writes Cloud SQL summaries to the local .typedai/docs/ structure.
 * This hydrates the local cache so the existing incremental build logic can work.
 */
export async function hydrateLocalSummaries(summaries: Map<string, Summary>, fss: IFileSystemService = getFileSystem()): Promise<void> {
	if (summaries.size === 0) {
		logger.debug('No summaries to hydrate locally');
		return;
	}

	logger.info({ count: summaries.size }, 'Hydrating local summaries from Cloud SQL');

	const workingDir = fss.getWorkingDirectory();
	const docsDir = path.join(workingDir, typedaiDirName, 'docs');

	let written = 0;
	let skipped = 0;

	for (const [summaryPath, summary] of summaries) {
		const localPath = getLocalSummaryPath(summaryPath, docsDir);

		try {
			// Check if local file exists with same hash (already up to date)
			if (await fss.fileExists(localPath)) {
				try {
					const existingContent = await fss.readFile(localPath);
					const existingSummary: Summary = JSON.parse(existingContent);
					if (existingSummary.meta?.hash === summary.meta.hash) {
						skipped++;
						continue;
					}
				} catch {
					// If we can't read/parse existing file, overwrite it
				}
			}

			// Write the summary file
			await fss.writeFile(localPath, JSON.stringify(summary, null, 2));
			written++;
		} catch (error) {
			logger.warn({ error, path: summaryPath }, 'Failed to write local summary file');
		}
	}

	logger.info({ written, skipped, total: summaries.size }, 'Completed local hydration');
}

/**
 * Reads all local summaries from .typedai/docs/ structure.
 * Returns summaries ready for pushing to Cloud SQL.
 */
export async function readLocalSummaries(fss: IFileSystemService = getFileSystem()): Promise<Map<string, Summary>> {
	const summaries = new Map<string, Summary>();
	const workingDir = fss.getWorkingDirectory();
	const docsDir = path.join(workingDir, typedaiDirName, 'docs');

	const dirExists = await fss.directoryExists(docsDir).catch(() => false);
	if (!dirExists) {
		logger.debug('No local docs directory found');
		return summaries;
	}

	try {
		const files = await fss.listFilesRecursively(docsDir, false);

		for (const file of files) {
			if (!file.endsWith('.json')) continue;

			try {
				const content = await fss.readFile(file);
				const summary: Summary = JSON.parse(content);
				if (summary.path) {
					summaries.set(summary.path, summary);
				}
			} catch (error) {
				logger.warn({ error, file }, 'Failed to read local summary file');
			}
		}
	} catch (error) {
		logger.error({ error }, 'Failed to list local summary files');
	}

	logger.debug({ count: summaries.size }, 'Read local summaries');
	return summaries;
}

/**
 * Converts a summary path to the local file system path.
 *
 * Summary paths follow these patterns:
 * - File summaries: "src/services/auth.ts" -> ".typedai/docs/src/services/auth.ts.json"
 * - Folder summaries: "src/services" (ends with /_index or has summary_type='folder')
 *   -> ".typedai/docs/src/services/_index.json"
 * - Project summary: "_project_summary" -> ".typedai/docs/_project_summary.json"
 */
function getLocalSummaryPath(summaryPath: string, docsDir: string): string {
	// Project summary special case
	if (summaryPath === '_project_summary') {
		return path.join(docsDir, '_project_summary.json');
	}

	// Folder summary (path ends with /_index or is just _index)
	if (summaryPath.endsWith('/_index') || summaryPath === '_index') {
		const folderPath = summaryPath.replace(/\/_index$/, '').replace(/^_index$/, '');
		return path.join(docsDir, folderPath, '_index.json');
	}

	// Check if path looks like a folder (no extension and not _index)
	// This handles the case where folder summaries are stored with just the folder path
	const ext = path.extname(summaryPath);
	if (!ext && !summaryPath.includes('.')) {
		return path.join(docsDir, summaryPath, '_index.json');
	}

	// Regular file summary
	return path.join(docsDir, `${summaryPath}.json`);
}

/**
 * Deletes orphaned local summary files that don't exist in Cloud SQL.
 */
export async function deleteOrphanedLocalSummaries(cloudPaths: Set<string>, fss: IFileSystemService = getFileSystem()): Promise<number> {
	const workingDir = fss.getWorkingDirectory();
	const docsDir = path.join(workingDir, typedaiDirName, 'docs');

	const dirExists = await fss.directoryExists(docsDir).catch(() => false);
	if (!dirExists) {
		return 0;
	}

	let deleted = 0;
	const files = await fss.listFilesRecursively(docsDir, false);

	for (const file of files) {
		if (!file.endsWith('.json')) continue;

		try {
			const content = await fss.readFile(file);
			const summary: Summary = JSON.parse(content);

			if (summary.path && !cloudPaths.has(summary.path)) {
				await fss.deleteFile(file);
				deleted++;
				logger.debug({ path: summary.path }, 'Deleted orphaned local summary');
			}
		} catch {
			// Skip files we can't read
		}
	}

	if (deleted > 0) {
		logger.info({ deleted }, 'Cleaned up orphaned local summaries');
	}

	return deleted;
}
