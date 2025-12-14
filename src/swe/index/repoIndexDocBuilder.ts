import { createHash } from 'node:crypto';
import { promises as fs, Stats } from 'node:fs';
import path, { basename, dirname, join } from 'node:path';
import type { Span } from '@opentelemetry/api';
import micromatch from 'micromatch';
import { getFileSystem } from '#agent/agentContextUtils';
import { typedaiDirName } from '#app/appDirs';
import { openAIFlexGPT5Nano } from '#llm/multi-agent/openaiFlex';
import { defaultLLMs } from '#llm/services/defaultLlms';
import { logger } from '#o11y/logger';
import { withActiveSpan } from '#o11y/trace';
import type { IFileSystemService } from '#shared/files/fileSystemService';
import type { LLM } from '#shared/llm/llm.model';
import { AI_INFO_FILENAME } from '#swe/projectDetection';
// Cloud SQL Summary Store imports
import { getSummaryStoreConfig, isDatabaseEnabled } from '#swe/summaryStore/config';
import { hydrateLocalSummaries, readLocalSummaries } from '#swe/summaryStore/localHydration';
import { getRepositoryId } from '#swe/summaryStore/repoId';
import { createSummaryStore } from '#swe/summaryStore/summaryStoreAdapter';
import { loadSyncState, recordPendingPush, recordSuccessfulPull, recordSuccessfulPush } from '#swe/summaryStore/syncState';
import { errorToString } from '#utils/errors';
import {
	type BatchSummaryResult,
	type FileSummaryRequest,
	createBatchSummaryGenerator,
	hasPendingBatchJob,
	resumeBatchJob,
	submitBatchJobWithPersistence,
} from './batchSummaryGenerator';
import { type Summary, generateDetailedSummaryPrompt, generateFileSummary, generateFolderSummary } from './llmSummaries';

/**
 * This module builds summary documentation for a project/repository, to assist with searching in the repository.
 * This should generally be run in the root folder of a project/repository.
 * The documentation summaries are saved in a parallel directory structure under the.typedai/docs folder
 *
 * The documentation is generated bottom-up, and takes into account the parent folder summaries available upto the repository root.
 * Given initially there isn't any folder level summaries, two passes are initially required.
 *
 * It's advisable to manually create the top level summary before running this.
 */

// Configuration constants
const BATCH_SIZE = 10;

function hash(content: string): string {
	return createHash('md5').update(content).digest('hex');
}

export class IndexDocBuilder {
	constructor(
		private readonly fss: IFileSystemService,
		private readonly llm: LLM,
		private readonly generateFileSummaryFn: typeof generateFileSummary = generateFileSummary,
		private readonly generateFolderSummaryFn: typeof generateFolderSummary = generateFolderSummary,
	) {}

	private static getSummaryFileName(filePath: string): string {
		// filePath is already relative to CWD from processFile/buildFolderSummary
		const fileName = basename(filePath);
		const dirPath = dirname(filePath);
		return join(typedaiDirName, 'docs', dirPath, `${fileName}.json`);
	}

	private static combineFileAndSubFoldersSummaries(fileSummaries: Summary[], subFolderSummaries: Summary[]): string {
		// Sort subfolders before files for consistency
		const sortedSubFolderSummaries = subFolderSummaries.sort((a, b) => a.path.localeCompare(b.path));
		const sortedFileSummaries = fileSummaries.sort((a, b) => a.path.localeCompare(b.path));

		const allSummaries = [...sortedSubFolderSummaries, ...sortedFileSummaries];
		return allSummaries.map((summary) => `${summary.path}:\n${summary.long}`).join('\n\n');
	}

	async buildIndexDocsInternal(): Promise<void> {
		logger.info('Building index docs');
		await withActiveSpan('Build index docs', async (span: Span) => {
			try {
				await this.deleteOrphanedSummaries().catch((error) => logger.warn(error));

				const workingDir = this.fss.getWorkingDirectory();
				const projectInfoPath = path.join(workingDir, AI_INFO_FILENAME);
				let projectInfoData: string;
				try {
					projectInfoData = await this.fss.readFile(projectInfoPath);
				} catch (e: any) {
					if (e.code === 'ENOENT') {
						logger.warn(`${AI_INFO_FILENAME} not found at ${projectInfoPath}. Cannot determine indexDocs patterns.`);
						throw new Error(`${AI_INFO_FILENAME} not found`);
					}
					throw e;
				}

				const projectInfos = JSON.parse(projectInfoData);
				const projectInfo = projectInfos[0];
				const indexDocsPatterns: string[] = projectInfo.indexDocs || [];

				if (indexDocsPatterns.length === 0) {
					logger.warn('No indexDocs patterns found in AI_INFO_FILENAME. No files/folders will be indexed.');
				}

				const precomputedPatternBases = indexDocsPatterns.map((pattern) => {
					const normalizedPattern = pattern.split(path.sep).join('/');
					const scanResult = micromatch.scan(normalizedPattern, { dot: true });
					let base = scanResult.base;
					if (!scanResult.isGlob && base !== '' && path.basename(base).includes('.') && !base.endsWith('/')) {
						base = path.dirname(base);
					}
					if (base.endsWith('/') && base.length > 1) {
						base = base.slice(0, -1);
					}
					if (base === '.') base = '';
					return { originalPattern: normalizedPattern, baseDir: base, isGlob: scanResult.isGlob };
				});

				const fileMatchesIndexDocs = (filePath: string): boolean => {
					if (path.isAbsolute(filePath)) {
						filePath = path.relative(workingDir, filePath);
					}
					const normalizedPath = filePath.split(path.sep).join('/');
					return micromatch.isMatch(normalizedPath, indexDocsPatterns, { dot: true });
				};

				const folderMatchesIndexDocs = (folderPath: string): boolean => {
					if (indexDocsPatterns.length === 0) return false;
					const normalizedFolderPath = folderPath === '.' ? '' : folderPath.split(path.sep).join('/');
					for (const { originalPattern, baseDir, isGlob } of precomputedPatternBases) {
						if (baseDir.startsWith(normalizedFolderPath)) {
							if (normalizedFolderPath === '' || baseDir === normalizedFolderPath || baseDir.startsWith(`${normalizedFolderPath}/`)) {
								return true;
							}
						}
						if (normalizedFolderPath.startsWith(baseDir)) {
							if (baseDir === '') {
								if (isGlob || originalPattern === baseDir) return true;
							} else {
								if (normalizedFolderPath === baseDir || normalizedFolderPath.startsWith(`${baseDir}/`)) {
									if (isGlob || baseDir === normalizedFolderPath) return true;
								}
							}
						}
					}
					return false;
				};

				const startFolder = workingDir;
				await this.processFolderRecursively(startFolder, fileMatchesIndexDocs, folderMatchesIndexDocs);
				await withActiveSpan('generateTopLevelSummary', async () => {
					await this.generateTopLevelSummaryInternal();
				});
			} catch (error) {
				logger.error(`Failed to build summary docs: ${errorToString(error)}`);
				throw error;
			}
		});
	}

	async processFile(filePath: string): Promise<void> {
		const relativeFilePath = path.relative(this.fss.getWorkingDirectory(), filePath);
		const summaryFilePath = IndexDocBuilder.getSummaryFileName(relativeFilePath);

		let fileContents: string;
		try {
			// The isFile check is removed; fss.readFile will throw an error for a directory,
			// which is caught below, achieving the same goal.
			fileContents = await this.fss.readFile(filePath);
		} catch (e: any) {
			logger.error(`Error reading or stat-ing source file ${filePath}: ${errorToString(e)}. Skipping this file.`);
			return;
		}

		const currentContentHash = hash(fileContents);

		if (await this.fss.fileExists(summaryFilePath)) {
			try {
				const summaryFileContent = await this.fss.readFile(summaryFilePath);
				const existingSummary: Summary = JSON.parse(summaryFileContent);
				if (existingSummary.meta?.hash === currentContentHash) {
					logger.debug(`Summary for ${relativeFilePath} is up to date (hash match).`);
					return;
				}
				logger.info(`Content hash mismatch for ${relativeFilePath}. Regenerating summary.`);
			} catch (e: any) {
				if (e instanceof SyntaxError) {
					logger.warn(`Error parsing existing summary file ${summaryFilePath}: ${errorToString(e)}. Regenerating summary.`);
				} else {
					logger.warn(`Error reading summary file ${summaryFilePath}: ${errorToString(e)}. Proceeding to generate summary.`);
				}
			}
		} else {
			logger.debug(`Summary file ${summaryFilePath} not found. Generating new summary.`);
		}

		const parentSummaries = await this.getParentSummaries(dirname(filePath));
		const doc = await this.generateFileSummaryFn(fileContents, parentSummaries, this.llm);
		doc.path = relativeFilePath;
		doc.meta = { hash: currentContentHash };

		// fss.writeFile is expected to handle recursive directory creation.
		await this.fss.writeFile(summaryFilePath, JSON.stringify(doc, null, 2));
		logger.debug(`Completed summary for ${relativeFilePath}`);
	}

	async processFilesInFolder(folderPath: string, fileMatchesIndexDocs: (filePath: string) => boolean): Promise<void> {
		const filesAndFolders = await this.fss.listFilesInDirectory(folderPath);
		const filteredFiles = filesAndFolders
			.filter((name) => !name.endsWith('/'))
			.filter((file) => {
				const fullRelativePath = path.relative(this.fss.getWorkingDirectory(), path.join(folderPath, file));
				return fileMatchesIndexDocs(fullRelativePath);
			});

		if (filteredFiles.length === 0) return;

		logger.debug(`Processing ${filteredFiles.length} files in folder ${folderPath}`);
		const errors: Array<{ file: string; error: Error }> = [];

		await withActiveSpan('processFilesInBatches', async (span: Span) => {
			for (let i = 0; i < filteredFiles.length; i += BATCH_SIZE) {
				const batch = filteredFiles.slice(i, i + BATCH_SIZE);
				await Promise.all(
					batch.map(async (file) => {
						const filePath = join(folderPath, file);
						try {
							await this.processFile(filePath);
						} catch (e: any) {
							// Ensure 'e' is typed
							logger.error(e, `Failed to process file ${filePath}`);
							errors.push({ file: filePath, error: e as Error });
						}
					}),
				);
				logger.debug(`Completed batch ${Math.floor(i / BATCH_SIZE) + 1} of ${Math.ceil(filteredFiles.length / BATCH_SIZE)}`);
			}
		});

		if (errors.length > 0) {
			logger.error(`Failed to process ${errors.length} files in folder ${folderPath}`);
			errors.forEach(({ file, error }) => logger.error(`${file}: ${errorToString(error)}`));
		}
	}

	async processFolderRecursively(
		folderPath: string,
		fileMatchesIndexDocs: (filePath: string) => boolean,
		folderMatchesIndexDocs: (folderPath: string) => boolean,
	): Promise<void> {
		logger.info(`Processing folder: ${folderPath}`);
		await withActiveSpan('processFolderRecursively', async (span: Span) => {
			try {
				const subFolders = await this.fss.listFolders(folderPath);

				// Process all subfolders in parallel for maximum efficiency
				await Promise.all(
					subFolders.map(async (subFolder) => {
						const subFolderPath = path.join(folderPath, subFolder);
						const relativeSubFolderPath = path.relative(this.fss.getWorkingDirectory(), subFolderPath);
						if (folderMatchesIndexDocs(relativeSubFolderPath)) {
							await this.processFolderRecursively(subFolderPath, fileMatchesIndexDocs, folderMatchesIndexDocs);
						} else {
							logger.debug(`Skipping folder ${subFolderPath} as it does not match any indexDocs patterns`);
						}
					}),
				);

				await this.processFilesInFolder(folderPath, fileMatchesIndexDocs);
				await this.buildFolderSummary(folderPath, fileMatchesIndexDocs, folderMatchesIndexDocs);
			} catch (error) {
				logger.error(`Error processing folder ${folderPath}: ${errorToString(error)}`);
				throw error;
			}
		});
	}

	async buildFolderSummary(
		folderPath: string,
		fileMatchesIndexDocs: (filePath: string) => boolean,
		folderMatchesIndexDocs: (folderPath: string) => boolean,
	): Promise<void> {
		const relativeFolderPath = path.relative(this.fss.getWorkingDirectory(), folderPath);
		if (relativeFolderPath === '') {
			logger.debug('Skipping folder summary for root directory, as it is handled by the project summary.');
			return;
		}
		const folderSummaryFilePath = join(typedaiDirName, 'docs', relativeFolderPath, '_index.json');

		const fileSummaries = await this.getFileSummaries(folderPath, fileMatchesIndexDocs);
		const subFolderSummaries = await this.getSubFolderSummaries(folderPath, folderMatchesIndexDocs);

		if (!fileSummaries.length && !subFolderSummaries.length) {
			logger.debug(`No child summaries to build folder summary for ${relativeFolderPath}. Skipping.`);
			try {
				await fs.unlink(folderSummaryFilePath);
				logger.debug(`Deleted obsolete folder summary ${folderSummaryFilePath}`);
			} catch (e: any) {
				if (e.code !== 'ENOENT') {
					logger.warn(`Could not delete obsolete folder summary ${folderSummaryFilePath}: ${errorToString(e)}`);
				}
			}
			return;
		}

		const childrenHashes = [...fileSummaries, ...subFolderSummaries]
			.sort((a, b) => a.path.localeCompare(b.path))
			.map((s) => `${s.path}:${s.meta.hash}`)
			.join(',');
		const currentChildrensCombinedHash = hash(childrenHashes);

		if (await this.fss.fileExists(folderSummaryFilePath)) {
			try {
				const existingSummaryContent = await this.fss.readFile(folderSummaryFilePath);
				const existingSummary: Summary = JSON.parse(existingSummaryContent);
				if (existingSummary.meta?.hash === currentChildrensCombinedHash) {
					logger.debug(`Folder summary for ${relativeFolderPath} is up to date (hash match).`);
					return;
				}
				logger.info(`Children hash mismatch for folder ${relativeFolderPath}. Regenerating summary.`);
			} catch (e: any) {
				if (e instanceof SyntaxError) {
					logger.warn(`Error parsing existing folder summary file ${folderSummaryFilePath}: ${errorToString(e)}. Regenerating summary.`);
				} else {
					logger.warn(`Error reading folder summary file ${folderSummaryFilePath}: ${errorToString(e)}. Proceeding to generate summary.`);
				}
			}
		} else {
			logger.debug(`Folder summary file ${folderSummaryFilePath} not found. Generating new summary.`);
		}

		try {
			const combinedSummaryText = IndexDocBuilder.combineFileAndSubFoldersSummaries(fileSummaries, subFolderSummaries);
			const parentSummaries = await this.getParentSummaries(folderPath);
			const folderSummary = await this.generateFolderSummaryFn(this.llm, combinedSummaryText, parentSummaries); // Use easy LLM for folder summaries
			folderSummary.path = relativeFolderPath;
			folderSummary.meta = { hash: currentChildrensCombinedHash };

			// fss.writeFile is expected to handle recursive directory creation.
			await this.fss.writeFile(folderSummaryFilePath, JSON.stringify(folderSummary, null, 2));
			logger.info(`Generated summary for folder ${relativeFolderPath}`);
		} catch (error) {
			logger.error(`Failed to generate summary for folder ${folderPath}: ${errorToString(error)}`);
			throw error;
		}
	}

	async getFileSummaries(folderPath: string, fileMatchesIndexDocs: (filePath: string) => boolean): Promise<Summary[]> {
		const fileNames = (await this.fss.listFilesInDirectory(folderPath)).filter((name) => !name.endsWith('/'));
		const summaries: Summary[] = [];

		for (const fileName of fileNames) {
			const absoluteFilePath = join(folderPath, fileName);
			const relativeFilePath = path.relative(this.fss.getWorkingDirectory(), absoluteFilePath);

			if (fileMatchesIndexDocs(relativeFilePath)) {
				const summaryPath = IndexDocBuilder.getSummaryFileName(relativeFilePath);
				try {
					const summaryContent = await this.fss.readFile(summaryPath);
					const summary = JSON.parse(summaryContent);
					if (summary.meta?.hash) {
						summaries.push(summary);
					} else {
						logger.warn(`File summary for ${relativeFilePath} at ${summaryPath} is missing a hash. Skipping for parent hash calculation.`);
					}
				} catch (e: any) {
					if (e.code !== 'ENOENT') logger.warn(`Failed to read summary for file ${fileName} at ${summaryPath}: ${errorToString(e)}`);
				}
			}
		}
		return summaries;
	}

	async getSubFolderSummaries(folderPath: string, folderMatchesIndexDocs: (folderPath: string) => boolean): Promise<Summary[]> {
		const subFolderNames = await this.fss.listFolders(folderPath);
		const summaries: Summary[] = [];

		for (const subFolderName of subFolderNames) {
			const absoluteSubFolderPath = join(folderPath, subFolderName);
			const relativeSubFolderPath = path.relative(this.fss.getWorkingDirectory(), absoluteSubFolderPath);

			if (folderMatchesIndexDocs(relativeSubFolderPath)) {
				const summaryPath = join(typedaiDirName, 'docs', relativeSubFolderPath, '_index.json');
				if (await this.fss.fileExists(summaryPath)) {
					try {
						const summaryContent = await this.fss.readFile(summaryPath);
						const summary = JSON.parse(summaryContent);
						if (summary.meta?.hash) {
							summaries.push(summary);
						} else {
							logger.warn(`Folder summary for ${relativeSubFolderPath} at ${summaryPath} is missing a hash. Skipping for parent hash calculation.`);
						}
					} catch (e: any) {
						logger.warn(`Failed to read summary for subfolder ${subFolderName} at ${summaryPath}: ${errorToString(e)}`);
					}
				}
			}
		}
		return summaries;
	}

	async generateTopLevelSummaryInternal(): Promise<string> {
		const cwd = this.fss.getWorkingDirectory();
		const topLevelSummaryPath = join(typedaiDirName, 'docs', '_project_summary.json');

		const allFolderSummaries = await this.getAllFolderSummariesInternal(cwd);

		const folderSummariesForHashMap = allFolderSummaries
			.filter((s) => s.meta?.hash)
			.sort((a, b) => a.path.localeCompare(b.path))
			.map((s) => `${s.path}:${s.meta.hash}`)
			.join(',');
		const currentAllFoldersCombinedHash = hash(folderSummariesForHashMap);

		try {
			const existingSummaryContent = await this.fss.readFile(topLevelSummaryPath);
			const existingSummary: ProjectSummaryDoc = JSON.parse(existingSummaryContent);
			if (existingSummary.meta?.hash === currentAllFoldersCombinedHash) {
				logger.debug(`Top-level project summary at ${topLevelSummaryPath} is up to date (hash match).`);
				return existingSummary.projectOverview;
			}
			logger.info(`Top-level project summary hash mismatch for ${topLevelSummaryPath}. Regenerating.`);
		} catch (e: any) {
			if (e.code === 'ENOENT') {
				logger.debug(`Top-level project summary file ${topLevelSummaryPath} not found. Generating new summary.`);
			} else if (e instanceof SyntaxError) {
				logger.warn(`Error parsing existing top-level project summary file ${topLevelSummaryPath}: ${errorToString(e)}. Regenerating summary.`);
			} else {
				logger.warn(`Error reading top-level project summary file ${topLevelSummaryPath}: ${errorToString(e)}. Proceeding to generate summary.`);
			}
		}

		logger.info('Generating new top-level project summary.');

		const combinedSummaryText = allFolderSummaries.map((summary) => `${summary.path}:\n${summary.long}`).join('\n\n');
		const newProjectOverview = await this.llm.generateText(generateDetailedSummaryPrompt(combinedSummaryText), {
			id: 'Generate top level project summary',
		}); // Use easy LLM

		await this.saveTopLevelSummaryInternal(newProjectOverview, currentAllFoldersCombinedHash);
		return newProjectOverview;
	}

	async getAllFolderSummariesInternal(rootDir: string): Promise<Summary[]> {
		const repoFolder = this.fss.getVcsRoot() ?? this.fss.getWorkingDirectory();
		const docsDir = join(repoFolder, typedaiDirName, 'docs');
		const summaries: Summary[] = [];

		let docsDirExists = false;
		try {
			docsDirExists = await this.fss.directoryExists(docsDir);
		} catch (e: any) {
			if (e.code !== 'ENOENT') logger.warn(`Error checking stats for docs directory ${docsDir}: ${errorToString(e)}`);
		}

		if (!docsDirExists) {
			logger.info(`Docs directory ${docsDir} does not exist. No folder summaries to load.`);
			return summaries;
		}

		try {
			const allFilesInDocs = await this.fss.listFilesRecursively(docsDir, true);
			for (const filePathInDocs of allFilesInDocs) {
				if (basename(filePathInDocs) === '_index.json') {
					try {
						const content = await this.fss.readFile(filePathInDocs);
						const summary: Summary = JSON.parse(content);
						summaries.push(summary);
					} catch (e: any) {
						if (e.code !== 'ENOENT') logger.warn(`Failed to read or parse folder summary file: ${filePathInDocs}. ${errorToString(e)}`);
					}
				}
			}
		} catch (error) {
			logger.error(`Error listing files in ${docsDir} for getAllFolderSummaries: ${errorToString(error)}`);
			throw error;
		}
		return summaries;
	}

	async saveTopLevelSummaryInternal(summaryContent: string, combinedHash: string): Promise<void> {
		const summaryPath = join(typedaiDirName, 'docs', '_project_summary.json');
		const doc: ProjectSummaryDoc = {
			projectOverview: summaryContent,
			meta: { hash: combinedHash },
		};
		// fss.writeFile is expected to handle recursive directory creation.
		await this.fss.writeFile(summaryPath, JSON.stringify(doc, null, 2));
	}

	async getTopLevelSummaryInternal(): Promise<string | null> {
		const summaryPath = join(typedaiDirName, 'docs', '_project_summary.json');
		if (await this.fss.fileExists(summaryPath)) {
			try {
				const fileContent = await this.fss.readFile(summaryPath);
				const doc: ProjectSummaryDoc = JSON.parse(fileContent);
				return doc.projectOverview || '';
			} catch (e: any) {
				logger.debug(`Error reading or parsing top-level project summary ${summaryPath}: ${errorToString(e)}`);
				return null;
			}
		} else {
			logger.debug(`Top-level project summary file ${summaryPath} not found.`);
			return null;
		}
	}

	async getParentSummaries(folderPath: string): Promise<Summary[]> {
		const parentSummaries: Summary[] = [];
		let currentPath = dirname(folderPath);
		const cwd = this.fss.getWorkingDirectory();

		while (currentPath !== '.' && path.relative(cwd, currentPath) !== '') {
			const relativeCurrentPath = path.relative(cwd, currentPath);
			const summaryPath = join(typedaiDirName, 'docs', relativeCurrentPath, '_index.json');
			if (await this.fss.fileExists(summaryPath)) {
				try {
					const summaryContent = await this.fss.readFile(summaryPath);
					parentSummaries.unshift(JSON.parse(summaryContent));
				} catch (e: any) {
					logger.warn(`Failed to read parent summary for ${currentPath} at ${summaryPath}: ${errorToString(e)}`);
					break;
				}
			} else {
				// No parent summary found, stop walking up the directory tree
				break;
			}
			currentPath = dirname(currentPath);
		}
		return parentSummaries;
	}

	async deleteOrphanedSummaries(): Promise<void> {
		logger.info('Deleting orphaned summary files...');
		await withActiveSpan('deleteOrphanedSummaries', async (span: Span) => {
			const cwd = this.fss.getWorkingDirectory();
			const docsDir = join(cwd, typedaiDirName, 'docs');

			const docsDirExists = await this.fss.directoryExists(docsDir);
			if (!docsDirExists) {
				logger.info(`Docs directory ${docsDir} does not exist. No summaries to clean.`);
				return;
			}

			const projectSummaryFileName = '_project_summary.json';
			let deletedCount = 0;

			try {
				const allFilesInDocs = await this.fss.listFilesRecursively(docsDir, true);
				for (const summaryFilePath of allFilesInDocs) {
					if (!summaryFilePath.endsWith('.json') || basename(summaryFilePath) === projectSummaryFileName) {
						continue;
					}

					let summaryData: Summary;
					try {
						const summaryContent = await this.fss.readFile(summaryFilePath);
						summaryData = JSON.parse(summaryContent);
					} catch (e: any) {
						logger.warn(`Failed to read or parse summary file ${summaryFilePath}: ${errorToString(e)}. Skipping orphan check.`);
						continue;
					}

					if (!summaryData.path) {
						logger.warn(`Summary file ${summaryFilePath} is missing the 'path' property. Skipping orphan check.`);
						continue;
					}

					const isFolderSummary = basename(summaryFilePath) === '_index.json';
					const sourcePath = summaryData.path;

					const sourceExists = isFolderSummary ? await this.fss.directoryExists(sourcePath) : await this.fss.fileExists(sourcePath);

					if (!sourceExists) {
						logger.info(`Source path ${sourcePath} for summary file ${summaryFilePath} not found. Deleting summary.`);
						try {
							await this.fss.deleteFile(summaryFilePath);
							deletedCount++;
						} catch (unlinkError: any) {
							logger.error(`Failed to delete orphaned summary file ${summaryFilePath}: ${errorToString(unlinkError)}`);
						}
					}
				}
				if (deletedCount > 0) {
					logger.info(`Orphaned summary cleanup complete. Deleted ${deletedCount} summary file(s).`);
				} else {
					logger.info('Orphaned summary cleanup complete. No orphaned files found.');
				}
			} catch (error) {
				logger.error(`Error during orphaned summary cleanup: ${errorToString(error)}`);
			}
		});
	}

	async loadBuildDocsSummariesInternal(): Promise<Map<string, Summary>> {
		const summaries = new Map<string, Summary>();
		const repoFolder = this.fss.getVcsRoot() ?? this.fss.getWorkingDirectory();
		const docsDir = join(repoFolder, typedaiDirName, 'docs');
		logger.debug(`Load summaries from ${docsDir}`);

		let dirExists = false;
		try {
			dirExists = await this.fss.directoryExists(docsDir);
		} catch (e: any) {
			if (e.code !== 'ENOENT') logger.warn(`Error checking stats for docs directory ${docsDir}: ${errorToString(e)}`);
		}

		if (!dirExists) {
			logger.debug(`The ${docsDir} directory does not exist.`);
			return summaries;
		}

		try {
			const useGitIgnore = false;
			const files = await this.fss.listFilesRecursively(docsDir, useGitIgnore);
			logger.debug(`Found ${files.length} files in ${docsDir}`);

			if (files.length === 0) return summaries;

			for (const file of files) {
				const fileName = basename(file);
				if (file.endsWith('.json') && fileName !== '_project_summary.json') {
					try {
						const content = await this.fss.readFile(file);
						const summary: Summary = JSON.parse(content.toString());
						summaries.set(summary.path, summary);
					} catch (error) {
						logger.warn(`Failed to read or parse summary file: ${file}. ${errorToString(error)}`);
					}
				}
			}
		} catch (error: any) {
			logger.error(`Error listing files in ${docsDir}: ${errorToString(error)}`);
			throw error;
		}

		logger.info(`Loaded ${summaries.size} summaries`);
		return summaries;
	}
}

/**
 * This auto-generates summary documentation for a project/repository, to assist with searching in the repository.
 * This should generally be run in the root folder of a project/repository.
 * The documentation summaries are saved in a parallel directory structure under the .typedai/docs folder
 */
export async function buildIndexDocs(
	llm: LLM,
	fss: IFileSystemService = getFileSystem(),
	fileSummaryFn: typeof generateFileSummary = generateFileSummary,
	folderSummaryFn: typeof generateFolderSummary = generateFolderSummary,
): Promise<void> {
	const builder = new IndexDocBuilder(fss, llm, fileSummaryFn, folderSummaryFn);
	await builder.buildIndexDocsInternal();
}

interface ProjectSummaryDoc {
	projectOverview: string;
	meta: {
		hash: string;
	};
}

export async function getRepositoryOverview(fss: IFileSystemService = getFileSystem()): Promise<string> {
	// getRepositoryOverview doesn't directly use LLM for generation, only for reading existing summary.
	// Passing a dummy or 'easy' LLM if the builder's methods it calls might need one.
	// getTopLevelSummaryInternal does not use LLM.
	const builder = new IndexDocBuilder(fss, {} as LLM);
	const repositoryOverview: string | null = await builder.getTopLevelSummaryInternal();
	return repositoryOverview ? `<repository-overview>\n${repositoryOverview}\n</repository-overview>\n` : '';
}

/**
 * Loads build documentation summaries from the specified directory.
 *
 * @returns {Promise<Map<string, Summary>>} A promise that resolves to a Map of file paths to their corresponding Summary objects.
 * @throws {Error} If there's an error listing files in the docs directory.
 *
 * @description
 * This function performs the following steps:
 * 1. Checks if the docs directory exists.
 * 2. Lists all JSON files in the docs directory recursively.
 * 3. Reads and parses each JSON file, storing the resulting Summary objects in a Map.
 *
 * @example
 * const summaries = await loadBuildDocsSummaries();
 * console.log(`Loaded ${summaries.size} summaries`);
 */
export async function loadBuildDocsSummaries(fss: IFileSystemService = getFileSystem()): Promise<Map<string, Summary>> {
	const builder = new IndexDocBuilder(fss, {} as LLM); // LLM not used when only loading
	return builder.loadBuildDocsSummariesInternal();
}

// ============================================================================
// Cloud SQL Sync Integration
// ============================================================================

export interface BuildIndexDocsOptions {
	/** Whether to sync with Cloud SQL (if configured). Default: true */
	syncToCloud?: boolean;
	/** Whether to pull from Cloud SQL before building. Default: true */
	pullFirst?: boolean;
	/** Whether to push to Cloud SQL after building. Default: true */
	pushAfter?: boolean;
}

/**
 * Builds index documentation with optional Cloud SQL sync.
 *
 * If Cloud SQL is configured in .typedai.json or env vars:
 * 1. Pulls summaries from Cloud SQL to local cache
 * 2. Runs incremental build (existing logic, unchanged)
 * 3. Pushes updated summaries back to Cloud SQL
 *
 * If Cloud SQL is not configured, runs the existing local-only flow.
 */
export async function buildIndexDocsWithSync(llm: LLM, fss: IFileSystemService = getFileSystem(), options: BuildIndexDocsOptions = {}): Promise<void> {
	const { syncToCloud = true, pullFirst = true, pushAfter = true } = options;

	const config = await getSummaryStoreConfig();

	// If no cloud config, run existing local-only flow (unchanged behavior)
	if (!syncToCloud || !isDatabaseEnabled(config)) {
		logger.debug('Database not configured, running local-only build');
		await buildIndexDocs(llm, fss);
		return;
	}

	const repoId = await getRepositoryId();
	const store = await createSummaryStore(config);
	if (!store) {
		logger.warn('Failed to create summary store, running local-only build');
		await buildIndexDocs(llm, fss);
		return;
	}

	try {
		// 1. Pull from Cloud SQL (if enabled)
		if (pullFirst) {
			try {
				logger.info({ repoId }, 'Pulling summaries from Cloud SQL');
				const cloudSummaries = await store.pull(repoId);
				await hydrateLocalSummaries(cloudSummaries, fss);
				await recordSuccessfulPull(repoId, fss);
			} catch (error) {
				logger.warn({ error }, 'Failed to pull from Cloud SQL, using local cache');
				const syncState = await loadSyncState(fss);
				if (syncState?.lastSuccessfulPull) {
					logger.info({ lastPull: syncState.lastSuccessfulPull }, 'Using cached summaries from last successful pull');
				}
			}
		}

		// 2. Run existing incremental build (unchanged)
		await buildIndexDocs(llm, fss);

		// 3. Push to Cloud SQL (if enabled)
		if (pushAfter) {
			try {
				logger.info({ repoId }, 'Pushing summaries to Cloud SQL');
				const localSummaries = await readLocalSummaries(fss);
				await store.push(repoId, localSummaries);
				await recordSuccessfulPush(repoId, fss);
			} catch (error) {
				logger.error({ error }, 'Failed to push to Cloud SQL');
				// Record pending paths for later retry
				const localSummaries = await readLocalSummaries(fss);
				await recordPendingPush(repoId, Array.from(localSummaries.keys()), fss);
			}
		}
	} finally {
		await store.close();
	}
}

/**
 * Pulls summaries from Cloud SQL to local cache without rebuilding.
 * Useful for quickly getting the latest team summaries.
 */
export async function pullSummariesFromCloud(fss: IFileSystemService = getFileSystem()): Promise<void> {
	const config = await getSummaryStoreConfig();

	if (!isDatabaseEnabled(config)) {
		throw new Error('Summary store database not configured');
	}

	const repoId = await getRepositoryId();
	const store = await createSummaryStore(config);
	if (!store) {
		throw new Error('Failed to create summary store');
	}

	try {
		logger.info({ repoId }, 'Pulling summaries from Cloud SQL');
		const cloudSummaries = await store.pull(repoId);
		await hydrateLocalSummaries(cloudSummaries, fss);
		await recordSuccessfulPull(repoId, fss);
		logger.info({ count: cloudSummaries.size }, 'Successfully pulled summaries from Cloud SQL');
	} finally {
		await store.close();
	}
}

/**
 * Pushes local summaries to Cloud SQL without rebuilding.
 * Useful for syncing after manual edits.
 */
export async function pushSummariesToCloud(fss: IFileSystemService = getFileSystem()): Promise<void> {
	const config = await getSummaryStoreConfig();

	if (!isDatabaseEnabled(config)) {
		throw new Error('Summary store database not configured');
	}

	const repoId = await getRepositoryId();
	const store = await createSummaryStore(config);
	if (!store) {
		throw new Error('Failed to create summary store');
	}

	try {
		logger.info({ repoId }, 'Pushing summaries to Cloud SQL');
		const localSummaries = await readLocalSummaries(fss);
		await store.push(repoId, localSummaries);
		await recordSuccessfulPush(repoId, fss);
		logger.info({ count: localSummaries.size }, 'Successfully pushed summaries to Cloud SQL');
	} finally {
		await store.close();
	}
}

// ============================================================================
// Smart LLM Selection and Batch Mode
// ============================================================================

export type SummaryMode = 'auto' | 'batch' | 'realtime';

export interface SmartBuildOptions extends BuildIndexDocsOptions {
	/**
	 * Summary generation mode:
	 * - 'auto': Use batch API if summary store is empty, otherwise use real-time with optimal LLM
	 * - 'batch': Force batch API (Vertex AI Batch Prediction)
	 * - 'realtime': Force real-time API
	 * Default: 'auto'
	 */
	mode?: SummaryMode;
	/**
	 * Override the LLM to use for real-time processing.
	 * If not provided, uses OpenAI Flex Nano (if configured) or defaultLLMs().easy
	 */
	llm?: LLM;
	/**
	 * Job name for batch processing. Default: 'summary-batch'
	 */
	batchJobName?: string;
}

/**
 * Checks if the local summary store is empty (no summaries exist).
 */
export async function isSummaryStoreEmpty(fss: IFileSystemService = getFileSystem()): Promise<boolean> {
	const repoFolder = fss.getVcsRoot() ?? fss.getWorkingDirectory();
	const docsDir = join(repoFolder, typedaiDirName, 'docs');

	try {
		const exists = await fss.directoryExists(docsDir);
		if (!exists) return true;

		const files = await fss.listFilesRecursively(docsDir, true);
		const summaryFiles = files.filter((f) => f.endsWith('.json') && !f.endsWith('_project_summary.json'));
		return summaryFiles.length === 0;
	} catch (e) {
		return true;
	}
}

/**
 * Gets the optimal LLM for incremental summary updates.
 *
 * Prefers OpenAI Flex Nano (batch pricing with real-time API) if configured,
 * otherwise falls back to defaultLLMs().easy.
 */
export function getIncrementalUpdateLLM(): LLM {
	const flexNano = openAIFlexGPT5Nano();
	if (flexNano.isConfigured()) {
		logger.info('Using OpenAI Flex Nano for incremental summary updates (batch pricing)');
		return flexNano;
	}

	const easy = defaultLLMs().easy;
	logger.info({ llm: easy.getId() }, 'Using default easy LLM for incremental summary updates');
	return easy;
}

/**
 * Collects all file paths that should be indexed based on indexDocs patterns.
 */
async function collectIndexableFilePaths(fss: IFileSystemService): Promise<string[]> {
	const workingDir = fss.getWorkingDirectory();
	const projectInfoPath = path.join(workingDir, AI_INFO_FILENAME);

	let projectInfoData: string;
	try {
		projectInfoData = await fss.readFile(projectInfoPath);
	} catch (e: any) {
		if (e.code === 'ENOENT') {
			logger.warn(`${AI_INFO_FILENAME} not found. Cannot determine indexDocs patterns.`);
			return [];
		}
		throw e;
	}

	const projectInfos = JSON.parse(projectInfoData);
	const projectInfo = projectInfos[0];
	const indexDocsPatterns: string[] = projectInfo.indexDocs || [];

	if (indexDocsPatterns.length === 0) {
		return [];
	}

	// List all files and filter by patterns
	const allFiles = await fss.listFilesRecursively(workingDir, true);
	const matchedFiles: string[] = [];

	for (const file of allFiles) {
		const relativePath = path.relative(workingDir, file);
		const normalizedPath = relativePath.split(path.sep).join('/');
		if (micromatch.isMatch(normalizedPath, indexDocsPatterns, { dot: true })) {
			matchedFiles.push(file);
		}
	}

	return matchedFiles;
}

/**
 * Builds summaries using Vertex AI Batch Prediction API.
 *
 * This is optimal for initial indexing of a repository, offering 50% cost savings.
 * The batch job may take up to 24 hours to complete.
 *
 * If a pending batch job exists, it will be resumed instead of starting a new one.
 * If no pending job exists, a new batch job will be submitted and the function
 * will return immediately (the job runs asynchronously in Vertex AI).
 *
 * Use `pnpm summaries resume` to check status and retrieve results.
 */
export async function buildIndexDocsWithBatch(fss: IFileSystemService = getFileSystem(), jobName = 'summary-batch'): Promise<BatchSummaryResult> {
	return withActiveSpan('buildIndexDocsWithBatch', async (span) => {
		// Check if there's a pending batch job to resume
		if (await hasPendingBatchJob(fss)) {
			logger.info('Found pending batch job, attempting to resume');
			const resumeResult = await resumeBatchJob(fss);

			if (resumeResult.status === 'succeeded' && resumeResult.result) {
				span.setAttributes({
					resumed: true,
					successCount: resumeResult.result.successCount,
					failureCount: resumeResult.result.failureCount,
				});

				// Generate folder summaries after file summaries are complete
				if (resumeResult.result.successCount > 0) {
					logger.info('Generating folder summaries using real-time LLM');
					const llm = getIncrementalUpdateLLM();
					const builder = new IndexDocBuilder(fss, llm);
					await builder.buildIndexDocsInternal();
				}

				return resumeResult.result;
			}

			if (resumeResult.status === 'pending' || resumeResult.status === 'running') {
				// Job still in progress
				console.log(`\nBatch job is still ${resumeResult.status} (${resumeResult.elapsedTime}).`);
				console.log(`Run 'pnpm summaries resume' later to check status.\n`);
				return {
					totalFiles: 0,
					successCount: 0,
					failureCount: 0,
					skippedCount: 0,
					jobId: resumeResult.jobId,
					summaries: new Map(),
				};
			}

			// Job failed, cancelled, or expired - continue to submit new job
			logger.info({ status: resumeResult.status }, 'Previous batch job did not complete, starting new job');
		}

		logger.info('Building summaries using Vertex AI Batch Prediction');

		// Collect all files to index
		const filePaths = await collectIndexableFilePaths(fss);
		span.setAttribute('totalFiles', filePaths.length);

		if (filePaths.length === 0) {
			logger.warn('No files to index');
			return {
				totalFiles: 0,
				successCount: 0,
				failureCount: 0,
				skippedCount: 0,
				summaries: new Map(),
			};
		}

		// Collect files needing summaries
		const batchGenerator = createBatchSummaryGenerator(fss);
		const fileRequests = await batchGenerator.collectFilesNeedingSummaries(filePaths);
		const skippedCount = filePaths.length - fileRequests.length;

		if (fileRequests.length === 0) {
			logger.info('All summaries up to date, nothing to process');
			return {
				totalFiles: filePaths.length,
				successCount: 0,
				failureCount: 0,
				skippedCount,
				summaries: new Map(),
			};
		}

		// Submit batch job with persistence (returns immediately, job runs async)
		const { jobId, requestCount } = await submitBatchJobWithPersistence(fss, fileRequests, jobName);

		span.setAttributes({
			jobId,
			requestCount,
			skippedCount,
		});

		// Return immediately - job runs asynchronously in Vertex AI
		// User should run `pnpm summaries resume` to check status and get results
		return {
			totalFiles: filePaths.length,
			successCount: 0,
			failureCount: 0,
			skippedCount,
			jobId,
			summaries: new Map(),
		};
	});
}

/**
 * Builds index documentation with smart LLM selection.
 *
 * Behavior:
 * - If summary store is empty (new project): Uses Vertex AI Batch Prediction for 50% cost savings
 * - For incremental updates: Uses OpenAI Flex Nano (batch pricing) if available, otherwise defaultLLMs().easy
 * - mode='realtime' forces real-time processing
 * - mode='batch' forces batch processing
 */
export async function buildIndexDocsWithSmartLlm(fss: IFileSystemService = getFileSystem(), options: SmartBuildOptions = {}): Promise<void> {
	const { mode = 'auto', llm, batchJobName = 'summary-batch', ...syncOptions } = options;

	return withActiveSpan('buildIndexDocsWithSmartLlm', async (span) => {
		span.setAttribute('mode', mode);

		// Determine if we should use batch mode
		let useBatch = mode === 'batch';

		if (mode === 'auto') {
			const isEmpty = await isSummaryStoreEmpty(fss);
			span.setAttribute('summaryStoreEmpty', isEmpty);

			if (isEmpty) {
				logger.info('Summary store is empty, using batch mode for initial indexing');
				useBatch = true;
			}
		}

		if (useBatch) {
			// Use Vertex AI Batch Prediction
			const result = await buildIndexDocsWithBatch(fss, batchJobName);
			span.setAttributes({
				batchSuccessCount: result.successCount,
				batchFailureCount: result.failureCount,
			});

			// Sync to cloud if configured
			const config = await getSummaryStoreConfig();
			if (syncOptions.syncToCloud !== false && isDatabaseEnabled(config)) {
				await pushSummariesToCloud(fss);
			}
		} else {
			// Use real-time processing with optimal LLM selection
			const selectedLlm = llm ?? getIncrementalUpdateLLM();
			span.setAttribute('llm', selectedLlm.getId());

			logger.info({ llm: selectedLlm.getId() }, 'Using real-time processing for summary generation');
			await buildIndexDocsWithSync(selectedLlm, fss, syncOptions);
		}
	});
}
