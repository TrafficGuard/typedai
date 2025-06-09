import { createHash } from 'node:crypto';
import { promises as fs, Stats } from 'node:fs';
import path, { basename, dirname, join } from 'node:path';
import type { Span } from '@opentelemetry/api';
import micromatch from 'micromatch';
import { getFileSystem, llms } from '#agent/agentContextLocalStorage';
import { typedaiDirName } from '#app/appDirs';
import { logger } from '#o11y/logger';
import { withActiveSpan } from '#o11y/trace';
import type { IFileSystemService } from '#shared/files/fileSystemService';
import type { LLM } from '#shared/llm/llm.model';
import { AI_INFO_FILENAME } from '#swe/projectDetection';
import { errorToString } from '#utils/errors';
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
		private fss: IFileSystemService,
		private llm: LLM,
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
		return allSummaries.map((summary) => `${summary.path}\n${summary.long}`).join('\n\n');
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

		try {
			const summaryFileContent = await this.fss.readFile(summaryFilePath);
			const existingSummary: Summary = JSON.parse(summaryFileContent);
			if (existingSummary.meta?.hash === currentContentHash) {
				logger.debug(`Summary for ${relativeFilePath} is up to date (hash match).`);
				return;
			}
			logger.info(`Content hash mismatch for ${relativeFilePath}. Regenerating summary.`);
		} catch (e: any) {
			if (e.code === 'ENOENT') {
				logger.debug(`Summary file ${summaryFilePath} not found. Generating new summary.`);
			} else if (e instanceof SyntaxError) {
				logger.warn(`Error parsing existing summary file ${summaryFilePath}: ${errorToString(e)}. Regenerating summary.`);
			} else {
				logger.warn(`Error reading summary file ${summaryFilePath}: ${errorToString(e)}. Proceeding to generate summary.`);
			}
		}

		const parentSummaries = await this.getParentSummaries(dirname(filePath));
		const doc = await generateFileSummary(fileContents, parentSummaries, this.llm); // Use medium LLM for file summaries
		doc.path = relativeFilePath;
		doc.meta = { hash: currentContentHash };

		// fss.writeFile is expected to handle recursive directory creation.
		await this.fss.writeFile(summaryFilePath, JSON.stringify(doc, null, 2));
		logger.info(`Completed summary for ${relativeFilePath}`);
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
				for (const subFolder of subFolders) {
					const subFolderPath = path.join(folderPath, subFolder);
					const relativeSubFolderPath = path.relative(this.fss.getWorkingDirectory(), subFolderPath);
					if (folderMatchesIndexDocs(relativeSubFolderPath)) {
						await this.processFolderRecursively(subFolderPath, fileMatchesIndexDocs, folderMatchesIndexDocs);
					} else {
						logger.debug(`Skipping folder ${subFolderPath} as it does not match any indexDocs patterns`);
					}
				}
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

		try {
			const existingSummaryContent = await this.fss.readFile(folderSummaryFilePath);
			const existingSummary: Summary = JSON.parse(existingSummaryContent);
			if (existingSummary.meta?.hash === currentChildrensCombinedHash) {
				logger.debug(`Folder summary for ${relativeFolderPath} is up to date (hash match).`);
				return;
			}
			logger.info(`Children hash mismatch for folder ${relativeFolderPath}. Regenerating summary.`);
		} catch (e: any) {
			if (e.code === 'ENOENT') {
				logger.debug(`Folder summary file ${folderSummaryFilePath} not found. Generating new summary.`);
			} else if (e instanceof SyntaxError) {
				logger.warn(`Error parsing existing folder summary file ${folderSummaryFilePath}: ${errorToString(e)}. Regenerating summary.`);
			} else {
				logger.warn(`Error reading folder summary file ${folderSummaryFilePath}: ${errorToString(e)}. Proceeding to generate summary.`);
			}
		}

		try {
			const combinedSummaryText = IndexDocBuilder.combineFileAndSubFoldersSummaries(fileSummaries, subFolderSummaries);
			const parentSummaries = await this.getParentSummaries(folderPath);
			const folderSummary = await generateFolderSummary(this.llm, combinedSummaryText, parentSummaries); // Use easy LLM for folder summaries
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
				try {
					const summaryContent = await this.fss.readFile(summaryPath);
					const summary = JSON.parse(summaryContent);
					if (summary.meta?.hash) {
						summaries.push(summary);
					} else {
						logger.warn(`Folder summary for ${relativeSubFolderPath} at ${summaryPath} is missing a hash. Skipping for parent hash calculation.`);
					}
				} catch (e: any) {
					if (e.code !== 'ENOENT') logger.warn(`Failed to read summary for subfolder ${subFolderName} at ${summaryPath}: ${errorToString(e)}`);
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

	async getTopLevelSummaryInternal(): Promise<string> {
		const summaryPath = join(typedaiDirName, 'docs', '_project_summary.json');
		try {
			const fileContent = await this.fss.readFile(summaryPath);
			const doc: ProjectSummaryDoc = JSON.parse(fileContent);
			return doc.projectOverview || '';
		} catch (e: any) {
			if (e.code === 'ENOENT') {
				logger.debug(`Top-level project summary file ${summaryPath} not found.`);
			} else {
				logger.warn(`Error reading or parsing top-level project summary ${summaryPath}: ${errorToString(e)}`);
			}
			return '';
		}
	}

	async getParentSummaries(folderPath: string): Promise<Summary[]> {
		const parentSummaries: Summary[] = [];
		let currentPath = dirname(folderPath);
		const cwd = this.fss.getWorkingDirectory();

		while (currentPath !== '.' && path.relative(cwd, currentPath) !== '') {
			const relativeCurrentPath = path.relative(cwd, currentPath);
			const summaryPath = join(typedaiDirName, 'docs', relativeCurrentPath, '_index.json');
			try {
				const summaryContent = await this.fss.readFile(summaryPath);
				parentSummaries.unshift(JSON.parse(summaryContent));
			} catch (e: any) {
				if (e.code === 'ENOENT') break;
				logger.warn(`Failed to read parent summary for ${currentPath} at ${summaryPath}: ${errorToString(e)}`);
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

	async loadBuildDocsSummariesInternal(createIfNotExits = false): Promise<Map<string, Summary>> {
		const summaries = new Map<string, Summary>();
		const repoFolder = this.fss.getVcsRoot() ?? this.fss.getWorkingDirectory();
		const docsDir = join(repoFolder, typedaiDirName, 'docs');
		logger.info(`Load summaries from ${docsDir}`);

		let dirExists = false;
		try {
			dirExists = await this.fss.directoryExists(docsDir);
		} catch (e: any) {
			if (e.code !== 'ENOENT') logger.warn(`Error checking stats for docs directory ${docsDir}: ${errorToString(e)}`);
		}

		try {
			if (!dirExists && !createIfNotExits) {
				logger.warn(`The ${docsDir} directory does not exist.`);
				return summaries;
			}
			if (!dirExists && createIfNotExits) {
				logger.info(`Docs directory ${docsDir} does not exist. Building index docs.`);
				await this.buildIndexDocsInternal(); // Call the internal method
				try {
					dirExists = await this.fss.directoryExists(docsDir);
				} catch (e: any) {
					if (e.code !== 'ENOENT') logger.error(`Error re-checking stats for docs directory ${docsDir} after build: ${errorToString(e)}`);
					dirExists = false;
				}
				if (!dirExists) {
					logger.error(`Docs directory ${docsDir} still does not exist after attempting to build index docs.`);
					return summaries;
				}
			} else if (!dirExists) {
				return summaries;
			}

			const files = await this.fss.listFilesRecursively(docsDir, true);
			logger.info(`Found ${files.length} files in ${docsDir}`);

			if (files.length === 0) {
				logger.warn(`No files found in ${docsDir}. Directory might be empty.`);
				return summaries;
			}

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
export async function buildIndexDocs(): Promise<void> {
	const fss = getFileSystem();
	const builder = new IndexDocBuilder(fss, llms().easy);
	await builder.buildIndexDocsInternal();
}

interface ProjectSummaryDoc {
	projectOverview: string;
	meta: {
		hash: string;
	};
}

export async function getRepositoryOverview(): Promise<string> {
	const fss = getFileSystem();
	// getRepositoryOverview doesn't directly use LLM for generation, only for reading existing summary.
	// Passing a dummy or 'easy' LLM if the builder's methods it calls might need one.
	// getTopLevelSummaryInternal does not use LLM.
	const builder = new IndexDocBuilder(fss, llms().easy);
	const repositoryOverview: string = await builder.getTopLevelSummaryInternal();
	return repositoryOverview ? `<repository-overview>\n${repositoryOverview}\n</repository-overview>\n` : '';
}

/**
 * Loads build documentation summaries from the specified directory.
 *
 * @param {boolean} [createIfNotExits=false] - If true, creates the documentation directory if it doesn't exist and attempts to build docs.
 * @returns {Promise<Map<string, Summary>>} A promise that resolves to a Map of file paths to their corresponding Summary objects.
 * @throws {Error} If there's an error listing files in the docs directory.
 *
 * @description
 * This function performs the following steps:
 * 1. Checks if the docs directory exists, creating it and building docs if necessary and requested.
 * 2. Lists all JSON files in the docs directory recursively.
 * 3. Reads and parses each JSON file, storing the resulting Summary objects in a Map.
 *
 * @example
 * const summaries = await loadBuildDocsSummaries();
 * console.log(`Loaded ${summaries.size} summaries`);
 */
export async function loadBuildDocsSummaries(createIfNotExits = false): Promise<Map<string, Summary>> {
	const fss = getFileSystem();
	const builder = new IndexDocBuilder(fss, llms().easy);
	return builder.loadBuildDocsSummariesInternal(createIfNotExits);
}
