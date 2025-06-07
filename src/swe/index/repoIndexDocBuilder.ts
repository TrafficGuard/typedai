import { createHash } from 'node:crypto';
import { promises as fs, Stats } from 'node:fs';
import path, { basename, dirname, join } from 'node:path';
import type { Span } from '@opentelemetry/api';
import micromatch from 'micromatch';
import { getFileSystem, llms } from '#agent/agentContextLocalStorage';
import { typedaiDirName } from '#app/appDirs';
import { logger } from '#o11y/logger';
import { withActiveSpan } from '#o11y/trace';
import { errorToString } from '#utils/errors';
import {
	generateDetailedSummaryPrompt,
	generateFileSummary,
	generateFolderSummary,
	type Summary,
} from './llmSummaries';
import { AI_INFO_FILENAME } from '#swe/projectDetection';

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

/**
 * This auto-generates summary documentation for a project/repository, to assist with searching in the repository.
 * This should generally be run in the root folder of a project/repository.
 * The documentation summaries are saved in a parallel directory structure under the .typedai/docs folder
 */
export async function buildIndexDocs(): Promise<void> {
	logger.info('Building index docs');
	await withActiveSpan('Build index docs', async (span: Span) => {
		try {
			deleteOrphanedSummaries().catch(error => logger.warn(error));

			// Load and parse AI_INFO_FILENAME
			const projectInfoPath = path.join(process.cwd(), AI_INFO_FILENAME);
			let projectInfoData: string;
			try {
				projectInfoData = await fs.readFile(projectInfoPath, 'utf-8');
			} catch (e: any) {
				if (e.code === 'ENOENT') {
					logger.warn(`${AI_INFO_FILENAME} not found at ${projectInfoPath}. Cannot determine indexDocs patterns.`);
					// Proceed without patterns, potentially indexing everything or nothing depending on default behavior
					// For now, let's throw as patterns are likely required.
					throw new Error(`${AI_INFO_FILENAME} not found at ${projectInfoPath}`);
				}
				throw e; // Re-throw other errors
			}

			const projectInfos = JSON.parse(projectInfoData);

			// Assuming you have only one project in the array
			const projectInfo = projectInfos[0];

			// Extract indexDocs patterns
			const indexDocsPatterns: string[] = projectInfo.indexDocs || [];
			if (indexDocsPatterns.length === 0) {
				logger.warn('No indexDocs patterns found in AI_INFO_FILENAME. No files/folders will be indexed.');
			}

			const fss = getFileSystem();
			// Define fileMatchesIndexDocs function inside buildIndexDocs
			function fileMatchesIndexDocs(filePath: string): boolean {
				// If filePath is absolute, make it relative to the working directory
				if (path.isAbsolute(filePath)) {
					filePath = path.relative(fss.getWorkingDirectory(), filePath);
				}
				// Normalize file path to use forward slashes
				const normalizedPath = filePath.split(path.sep).join('/');
				// logger.info(`Checking indexDocs matching for ${normalizedPath}`); // Too noisy
				return micromatch.isMatch(normalizedPath, indexDocsPatterns);
			}

			// Define folderMatchesIndexDocs function inside buildIndexDocs
			function folderMatchesIndexDocs(folderPath: string): boolean {
				// Convert absolute folderPath to a relative path
				if (path.isAbsolute(folderPath)) {
					folderPath = path.relative(fss.getWorkingDirectory(), folderPath);
				}

				// Normalize paths to use forward slashes
				const normalizedFolderPath = folderPath.split(path.sep).join('/');

				// Ensure folder path ends with a slash for consistent matching
				const folderPathWithSlash = normalizedFolderPath.endsWith('/') ? normalizedFolderPath : `${normalizedFolderPath}/`;

				// Extract directory portions from the patterns
				const patternDirs = indexDocsPatterns.map((pattern) => {
					const index = pattern.indexOf('**');
					let dir = index !== -1 ? pattern.substring(0, index) : pattern;
					dir = dir.endsWith('/') ? dir : `${dir}/`;
					return dir;
				});

				// Check if the folder path starts with any of the pattern directories
				// Also check if the folder path *is* one of the pattern directories
				return patternDirs.some((patternDir) => folderPathWithSlash.startsWith(patternDir) || normalizedFolderPath === patternDir.slice(0, -1));
			}

			const startFolder = getFileSystem().getWorkingDirectory();
			await processFolderRecursively(startFolder, fileMatchesIndexDocs, folderMatchesIndexDocs);
			await withActiveSpan('generateTopLevelSummary', async (span: Span) => {
				// Generate a project-level summary from the folder summaries
				await generateTopLevelSummary();
			});
		} catch (error) {
			logger.error(`Failed to build summary docs: ${errorToString(error)}`);
			throw error;
		}
	});
}

/**
 * Process a single file to generate its documentation summary
 */
async function processFile(filePath: string, easyLlm: any): Promise<void> {
	const relativeFilePath = path.relative(getFileSystem().getWorkingDirectory(), filePath);
	const summaryFilePath = getSummaryFileName(relativeFilePath);

	let fileContents: string;
	let sourceFileStats: Stats;
	try {
		sourceFileStats = await fs.stat(filePath);
		if (!sourceFileStats.isFile()) {
			logger.info(`Path ${relativeFilePath} is a directory, not a file. Skipping file processing.`);
			return;
		}
		fileContents = await fs.readFile(filePath, 'utf-8');
	} catch (e: any) {
		logger.error(`Error reading or stat-ing source file ${filePath}: ${errorToString(e)}. Skipping this file.`);
		return;
	}

	const currentContentHash = hash(fileContents);

	try {
		const summaryFileContent = await fs.readFile(summaryFilePath, 'utf-8');
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

	const parentSummaries = await getParentSummaries(dirname(filePath));
	const doc = await generateFileSummary(fileContents, parentSummaries, easyLlm);
	doc.path = relativeFilePath;
	doc.meta = { hash: currentContentHash };

	await fs.mkdir(dirname(summaryFilePath), { recursive: true });
	await fs.writeFile(summaryFilePath, JSON.stringify(doc, null, 2));
	logger.info(`Completed summary for ${relativeFilePath}`);
}

/**
 * Process all matching files within a single folder.
 * Files are processed in batches to manage memory and API usage.
 */
async function processFilesInFolder(folderPath: string, fileMatchesIndexDocs: (filePath: string) => boolean): Promise<void> {
	const fileSystem = getFileSystem();
	// Lists the file and folder names in a single directory. Folder names will end with a /
	const filesAndFolders = await fileSystem.listFilesInDirectory(folderPath);

	// Filter out directory entries (ending with /) and then match against indexDocsPatterns
	const filteredFiles = filesAndFolders
		.filter((name) => !name.endsWith('/'))
		.filter((file) => {
			const fullRelativePath = path.relative(fileSystem.getWorkingDirectory(), path.join(folderPath, file));
			return fileMatchesIndexDocs(fullRelativePath);
		});

	if (filteredFiles.length === 0) {
		// logger.info(`No files to process in folder ${folderPath}`); // Too noisy
		return;
	}

	logger.debug(`Processing ${filteredFiles.length} files in folder ${folderPath}`);
	const llm = llms().medium;
	const errors: Array<{ file: string; error: Error }> = [];

	await withActiveSpan('processFilesInBatches', async (span: Span) => {
		// Process files in batches within the folder
		for (let i = 0; i < filteredFiles.length; i += BATCH_SIZE) {
			const batch = filteredFiles.slice(i, i + BATCH_SIZE);
			await Promise.all(
				batch.map(async (file) => {
					const filePath = join(folderPath, file);
					try {
						await processFile(filePath, llm);
					} catch (e) {
						logger.error(e, `Failed to process file ${filePath}`);
						errors.push({ file: filePath, error: e });
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

/**
 * Process a folder and its contents recursively in depth-first order.
 * First processes all subfolders, then files in the current folder,
 * and finally builds the folder summary.
 */
async function processFolderRecursively(
	folderPath: string,
	fileMatchesIndexDocs: (filePath: string) => boolean,
	folderMatchesIndexDocs: (folderPath: string) => boolean,
): Promise<void> {
	logger.info(`Processing folder: ${folderPath}`);
	await withActiveSpan('processFolderRecursively', async (span: Span) => {
		try {
			// Get subfolder names (already updated to return names only)
			const subFolders = await getFileSystem().listFolders(folderPath);

			// Process subfolders
			for (const subFolder of subFolders) {
				const subFolderPath = path.join(folderPath, subFolder);

				// Ensure relative path is correctly calculated
				const relativeSubFolderPath = path.relative(getFileSystem().getWorkingDirectory(), subFolderPath);

				if (folderMatchesIndexDocs(relativeSubFolderPath)) {
					await processFolderRecursively(subFolderPath, fileMatchesIndexDocs, folderMatchesIndexDocs);
				} else {
					logger.debug(`Skipping folder ${subFolderPath} as it does not match any indexDocs patterns`);
				}
			}

			// Process files in the current folder
			await processFilesInFolder(folderPath, fileMatchesIndexDocs);

			// Build folder summary if this folder itself is supposed to be indexed.
			// buildFolderSummary will perform its own staleness checks and determine if
			// it has content (child file/folder summaries) to summarize.
			await buildFolderSummary(folderPath, fileMatchesIndexDocs, folderMatchesIndexDocs);
		} catch (error) {
			logger.error(`Error processing folder ${folderPath}: ${errorToString(error)}`);
			throw error;
		}
	});
}

// Utils -----------------------------------------------------------

/**
 * Returns the summary file path for a given source file path
 * @param filePath source file path (relative to CWD)
 * @returns summary file path (relative to CWD)
 */
function getSummaryFileName(filePath: string): string {
	// filePath is already relative to CWD from processFile/buildFolderSummary
	const fileName = basename(filePath);
	const dirPath = dirname(filePath);
	return join(typedaiDirName, 'docs', dirPath, `${fileName}.json`);
}

// -----------------------------------------------------------------------------
//   File-level summaries
// -----------------------------------------------------------------------------

// -----------------------------------------------------------------------------
//   Folder-level summaries
// -----------------------------------------------------------------------------

/**
 * Builds a summary for the current folder using its files and subfolders
 */
async function buildFolderSummary(
	folderPath: string,
	fileMatchesIndexDocs: (filePath: string) => boolean,
	folderMatchesIndexDocs: (folderPath: string) => boolean,
): Promise<void> {
	const relativeFolderPath = path.relative(getFileSystem().getWorkingDirectory(), folderPath);
	const folderName = basename(folderPath);
	const folderSummaryFilePath = join(typedaiDirName, 'docs', relativeFolderPath, `_${folderName}.json`);

	const fileSummaries = await getFileSummaries(folderPath, fileMatchesIndexDocs);
	const subFolderSummaries = await getSubFolderSummaries(folderPath, folderMatchesIndexDocs);

	if (!fileSummaries.length && !subFolderSummaries.length) {
		logger.debug(`No child summaries to build folder summary for ${relativeFolderPath}. Skipping.`);
		// Optionally, delete existing folder summary if it exists and has no children now
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
		const existingSummaryContent = await fs.readFile(folderSummaryFilePath, 'utf-8');
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
		const combinedSummaryText = combineFileAndSubFoldersSummaries(fileSummaries, subFolderSummaries);
		const parentSummaries = await getParentSummaries(folderPath); // folderPath here is absolute
		const folderSummary = await generateFolderSummary(llms().easy, combinedSummaryText, parentSummaries);
		folderSummary.path = relativeFolderPath;
		folderSummary.meta = { hash: currentChildrensCombinedHash };

		await fs.mkdir(dirname(folderSummaryFilePath), { recursive: true });
		await fs.writeFile(folderSummaryFilePath, JSON.stringify(folderSummary, null, 2));
		logger.info(`Generated summary for folder ${relativeFolderPath}`);
	} catch (error) {
		logger.error(`Failed to generate summary for folder ${folderPath}: ${errorToString(error)}`);
		throw error;
	}
}

async function getFileSummaries(folderPath: string, fileMatchesIndexDocs: (filePath: string) => boolean): Promise<Summary[]> {
	const fileSystem = getFileSystem();
	const fileNames = (await fileSystem.listFilesInDirectory(folderPath)).filter(name => !name.endsWith('/'));
	const summaries: Summary[] = [];

	for (const fileName of fileNames) {
		const absoluteFilePath = join(folderPath, fileName);
		const relativeFilePath = path.relative(fileSystem.getWorkingDirectory(), absoluteFilePath);

		if (fileMatchesIndexDocs(relativeFilePath)) {
			const summaryPath = getSummaryFileName(relativeFilePath);
			try {
				const summaryContent = await fs.readFile(summaryPath, 'utf-8');
				const summary = JSON.parse(summaryContent);
				if (summary.meta?.hash) { // Only include summaries that have a hash
					summaries.push(summary);
				} else {
					logger.warn(`File summary for ${relativeFilePath} at ${summaryPath} is missing a hash. Skipping for parent hash calculation.`);
				}
			} catch (e: any) {
				if (e.code !== 'ENOENT') logger.warn(`Failed to read summary for file ${fileName} at ${summaryPath}: ${errorToString(e)}`);
				// If ENOENT or missing hash, it won't be included in parent hash calculation.
			}
		}
	}
	return summaries;
}

async function getSubFolderSummaries(folderPath: string, folderMatchesIndexDocs: (folderPath: string) => boolean): Promise<Summary[]> {
	const fileSystem = getFileSystem();
	const subFolderNames = await fileSystem.listFolders(folderPath);
	const summaries: Summary[] = [];

	for (const subFolderName of subFolderNames) {
		const absoluteSubFolderPath = join(folderPath, subFolderName);
		const relativeSubFolderPath = path.relative(fileSystem.getWorkingDirectory(), absoluteSubFolderPath);

		if (folderMatchesIndexDocs(relativeSubFolderPath)) {
			const childFolderSummaryName = basename(relativeSubFolderPath);
			const summaryPath = join(typedaiDirName, 'docs', relativeSubFolderPath, `_${childFolderSummaryName}.json`);
			try {
				const summaryContent = await fs.readFile(summaryPath, 'utf-8');
				const summary = JSON.parse(summaryContent);
				if (summary.meta?.hash) { // Only include summaries that have a hash
					summaries.push(summary);
				} else {
					logger.warn(`Folder summary for ${relativeSubFolderPath} at ${summaryPath} is missing a hash. Skipping for parent hash calculation.`);
				}
			} catch (e: any) {
				if (e.code !== 'ENOENT') logger.warn(`Failed to read summary for subfolder ${subFolderName} at ${summaryPath}: ${errorToString(e)}`);
				// If ENOENT or missing hash, it won't be included in parent hash calculation.
			}
		}
	}
	return summaries;
}

/**
 * Formats the summaries of the files and folders into the following format:
 *
 * dir/dir2
 * paragraph summary
 *
 * dir/file1
 * paragraph summary
 *
 * @param fileSummaries
 * @param subFolderSummaries
 */
function combineFileAndSubFoldersSummaries(fileSummaries: Summary[], subFolderSummaries: Summary[]): string {
	// Sort subfolders before files for consistency
	const sortedSubFolderSummaries = subFolderSummaries.sort((a, b) => a.path.localeCompare(b.path));
	const sortedFileSummaries = fileSummaries.sort((a, b) => a.path.localeCompare(b.path));

	const allSummaries = [...sortedSubFolderSummaries, ...sortedFileSummaries];
	return allSummaries.map((summary) => `${summary.path}\n${summary.long}`).join('\n\n');
}

// -----------------------------------------------------------------------------
//   Top-level summary
// -----------------------------------------------------------------------------

interface ProjectSummaryDoc {
	projectOverview: string;
	meta: {
		hash: string;
	};
}

export async function generateTopLevelSummary(): Promise<string> {
	const fileSystem = getFileSystem();
	const cwd = fileSystem.getWorkingDirectory();
	const topLevelSummaryPath = join(typedaiDirName, 'docs', '_project_summary.json');

	const allFolderSummaries = await getAllFolderSummaries(cwd);

	const folderSummariesForHashMap = allFolderSummaries
		.filter(s => s.meta?.hash) // Ensure summaries have hashes
		.sort((a, b) => a.path.localeCompare(b.path))
		.map(s => `${s.path}:${s.meta.hash}`)
		.join(',');
	const currentAllFoldersCombinedHash = hash(folderSummariesForHashMap);

	try {
		const existingSummaryContent = await fs.readFile(topLevelSummaryPath, 'utf-8');
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

	if (allFolderSummaries.length === 0) {
		logger.info('No folder summaries found to generate a new top-level project summary.');
		const placeholderSummary = 'Project summary generation pending: No folder-level summaries available.';
		await saveTopLevelSummary(cwd, placeholderSummary, currentAllFoldersCombinedHash); // Save with current (empty) hash
		return placeholderSummary;
	}

	const combinedSummaryText = allFolderSummaries.map((summary) => `${summary.path}:\n${summary.long}`).join('\n\n');
	const newProjectOverview = await llms().easy.generateText(generateDetailedSummaryPrompt(combinedSummaryText), { id: 'Generate top level project summary' });

	await saveTopLevelSummary(cwd, newProjectOverview, currentAllFoldersCombinedHash);
	return newProjectOverview;
}

async function getAllFolderSummaries(rootDir: string): Promise<Summary[]> {
	const fileSystem = getFileSystem();
	// List all files recursively within the docs directory
	const docsDir = join(rootDir, typedaiDirName, 'docs');
	const summaries: Summary[] = [];

	let docsDirExists = false;
	try {
		const stats = await fs.stat(docsDir);
		docsDirExists = stats.isDirectory();
	} catch (e: any) {
		if (e.code !== 'ENOENT') logger.warn(`Error checking stats for docs directory ${docsDir}: ${errorToString(e)}`);
		// If ENOENT, docsDirExists remains false, which is correct.
	}

	if (!docsDirExists) {
		logger.info(`Docs directory ${docsDir} does not exist. No folder summaries to load.`);
		return summaries;
	}

	try {
		const allFilesInDocs = await fileSystem.listFilesRecursively(docsDir, true);

		for (const filePathInDocs of allFilesInDocs) {
			// Only process folder summary files (_*.json)
			if (basename(filePathInDocs).startsWith('_') && filePathInDocs.endsWith('.json')) {
				try {
					const summaryContent = await fs.readFile(filePathInDocs, 'utf-8');
					const summary: Summary = JSON.parse(summaryContent);
					// The path stored in the summary JSON should already be relative to CWD
					summaries.push(summary);
				} catch (e: any) {
					if (e.code !== 'ENOENT') logger.warn(`Failed to read or parse folder summary file: ${filePathInDocs}. ${errorToString(e)}`);
					// If ENOENT, file was deleted between listing and reading, just skip.
				}
			}
		}
	} catch (error) {
		logger.error(`Error listing files in ${docsDir} for getAllFolderSummaries: ${errorToString(error)}`);
		// Depending on desired behavior, could re-throw or return empty array
		throw error; // Re-throw for now
	}

	return summaries;
}

async function saveTopLevelSummary(rootDir: string, summaryContent: string, combinedHash: string): Promise<void> {
	const summaryPath = join(typedaiDirName, 'docs', '_project_summary.json'); // Relative to CWD
	await fs.mkdir(dirname(summaryPath), { recursive: true }); // Ensure directory exists
	const doc: ProjectSummaryDoc = {
		projectOverview: summaryContent,
		meta: { hash: combinedHash },
	};
	await fs.writeFile(summaryPath, JSON.stringify(doc, null, 2), 'utf-8');
}

export async function getTopLevelSummary(): Promise<string> {
	const summaryPath = join(typedaiDirName, 'docs', '_project_summary.json');
	try {
		const fileContent = await fs.readFile(summaryPath, 'utf-8');
		const doc: ProjectSummaryDoc = JSON.parse(fileContent);
		return doc.projectOverview || '';
	} catch (e: any) {
		if (e.code === 'ENOENT') {
			logger.debug(`Top-level project summary file ${summaryPath} not found.`);
			return ''; // File not found, return empty string
		}
		logger.warn(`Error reading or parsing top-level project summary ${summaryPath}: ${errorToString(e)}`);
		return ''; // Return empty on other errors like parse errors
	}
}

export async function getRepositoryOverview(): Promise<string> {
	const repositoryOverview: string = await getTopLevelSummary();
	return repositoryOverview ? `<repository-overview>\n${repositoryOverview}\n</repository-overview>\n` : '';
}

async function getParentSummaries(folderPath: string): Promise<Summary[]> {
	// TODO should walk up to the git root folder
	const parentSummaries: Summary[] = [];
	let currentPath = dirname(folderPath);
	const cwd = getFileSystem().getWorkingDirectory();

	// Stop when we reach the working directory or the root
	while (currentPath !== '.' && path.relative(cwd, currentPath) !== '') {
		const relativeCurrentPath = path.relative(cwd, currentPath);
		const folderName = basename(currentPath);
		const summaryPath = join(typedaiDirName, 'docs', relativeCurrentPath, `_${folderName}.json`);
		try {
			const summaryContent = await fs.readFile(summaryPath, 'utf-8');
			parentSummaries.unshift(JSON.parse(summaryContent));
		} catch (e: any) {
			if (e.code === 'ENOENT') {
				// If a parent summary is missing, we stop walking up this branch
				break;
			}
			logger.warn(`Failed to read parent summary for ${currentPath} at ${summaryPath}: ${errorToString(e)}`);
			// Depending on error, might want to break or continue
			break; // Break on other errors too for safety
		}
		currentPath = dirname(currentPath);
	}

	return parentSummaries;
}

async function deleteOrphanedSummaries(): Promise<void> {
	logger.info('Deleting orphaned summary files...');
	await withActiveSpan('deleteOrphanedSummaries', async (span: Span) => {
		const fss = getFileSystem();
		const cwd = fss.getWorkingDirectory();
		const docsDir = join(cwd, typedaiDirName, 'docs');

		try {
			await fs.access(docsDir); // Check if docsDir exists and is accessible
		} catch (e: any) {
			if (e.code === 'ENOENT') {
				logger.info(`Docs directory ${docsDir} does not exist. No summaries to clean.`);
				return;
			}
			logger.warn(`Error accessing docs directory ${docsDir}: ${errorToString(e)}. Skipping cleanup.`);
			return;
		}

		const projectSummaryFileName = '_project_summary.json';
		let deletedCount = 0;

		try {
			const allFilesInDocs = await fss.listFilesRecursively(docsDir, true); // true for useGitIgnore

			for (const summaryFilePath of allFilesInDocs) {
				if (!summaryFilePath.endsWith('.json')) {
					continue; // Skip non-JSON files
				}

				if (basename(summaryFilePath) === projectSummaryFileName) {
					logger.debug(`Skipping project summary file: ${summaryFilePath}`);
					continue;
				}

				let summaryData: Summary;
				try {
					// Use fs.readFile for direct file system access, assuming summaryFilePath is absolute or resolvable
					const summaryContent = await fs.readFile(summaryFilePath, 'utf-8');
					summaryData = JSON.parse(summaryContent);
				} catch (e: any) {
					logger.warn(`Failed to read or parse summary file ${summaryFilePath}: ${errorToString(e)}. Skipping orphan check for this file.`);
					continue;
				}

				if (!summaryData.path) {
					logger.warn(`Summary file ${summaryFilePath} is missing the 'path' property. Skipping orphan check.`);
					continue;
				}

				// summaryData.path is relative to CWD as stored by processFile/buildFolderSummary
				const sourcePath = join(cwd, summaryData.path);

				try {
					await fs.stat(sourcePath); // Check if source exists
					// If fs.stat succeeds, source exists, do nothing.
				} catch (e: any) {
					if (e.code === 'ENOENT') {
						// Source file/folder does not exist, so summary is orphaned
						logger.info(`Source path ${sourcePath} (from summary ${summaryData.path}) for summary file ${summaryFilePath} not found. Deleting summary.`);
						try {
							await fs.unlink(summaryFilePath);
							deletedCount++;
						} catch (unlinkError: any) {
							logger.error(`Failed to delete orphaned summary file ${summaryFilePath}: ${errorToString(unlinkError)}`);
						}
					} else {
						// Other error stat-ing the file, log it but don't delete summary
						logger.warn(`Error checking status of source path ${sourcePath} for summary ${summaryFilePath}: ${errorToString(e)}. Skipping orphan check.`);
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
			// This error won't stop the buildIndexDocs process unless re-thrown
		}
	});
}

/**
 * Loads build documentation summaries from the specified directory.
 *
 * @param {boolean} [createIfNotExits=true] - If true, creates the documentation directory if it doesn't exist.
 * @returns {Promise<Map<string, Summary>>} A promise that resolves to a Map of file paths to their corresponding Summary objects.
 * @throws {Error} If there's an error listing files in the docs directory.
 *
 * @description
 * This function performs the following steps:
 * 1. Checks if the docs directory exists, creating it if necessary.
 * 2. Lists all JSON files in the docs directory recursively.
 * 3. Reads and parses each JSON file, storing the resulting Summary objects in a Map.
 *
 * @example
 * const summaries = await loadBuildDocsSummaries();
 * console.log(`Loaded ${summaries.size} summaries`);
 */
export async function loadBuildDocsSummaries(createIfNotExits = false): Promise<Map<string, Summary>> {
	const summaries = new Map<string, Summary>();

	const fss = getFileSystem();
	// If in a git repo use the repo root to store the summary index files
	const repoFolder = fss.getVcsRoot() ?? fss.getWorkingDirectory();

	const docsDir = join(repoFolder, typedaiDirName, 'docs');
	logger.info(`Load summaries from ${docsDir}`);

	let dirExists = false;
	try {
		const stats = await fs.stat(docsDir);
		dirExists = stats.isDirectory();
	} catch (e: any) {
		if (e.code !== 'ENOENT') {
			logger.warn(`Error checking stats for docs directory ${docsDir}: ${errorToString(e)}`);
		}
		// If ENOENT, dirExists remains false, which is correct.
	}

	try {
		if (!dirExists && !createIfNotExits) {
			logger.warn(`The ${docsDir} directory does not exist.`);
			return summaries;
		}
		if (!dirExists && createIfNotExits) {
			// If createIfNotExits is true and dir doesn't exist, build docs first
			logger.info(`Docs directory ${docsDir} does not exist. Building index docs.`);
			await buildIndexDocs();
			// After building, the directory should exist, proceed to load
			// Re-check if directory exists after buildIndexDocs
			try {
				const stats = await fs.stat(docsDir);
				dirExists = stats.isDirectory();
			} catch (e: any) {
				if (e.code !== 'ENOENT') {
					logger.error(`Error re-checking stats for docs directory ${docsDir} after build: ${errorToString(e)}`);
				}
				dirExists = false; // Ensure dirExists is false if stat fails
			}

			if (!dirExists) {
				logger.error(`Docs directory ${docsDir} still does not exist after attempting to build index docs.`);
				return summaries; // Cannot load if directory doesn't exist
			}
		} else if (!dirExists) {
			// This case is already handled by the first check, but kept for clarity
			return summaries;
		}

		const files = await fss.listFilesRecursively(docsDir, true); // List all files recursively
		logger.info(`Found ${files.length} files in ${docsDir}`);

		if (files.length === 0) {
			logger.warn(`No files found in ${docsDir}. Directory might be empty.`);
			return summaries;
		}

		for (const file of files) {
			// Load both file summaries (*.json) and folder summaries (_*.json)
			if (file.endsWith('.json')) {
				try {
					// file path is absolute here from listFilesRecursively
					const content = await fss.readFile(file);
					const summary: Summary = JSON.parse(content);
					// The path stored in the summary JSON should be relative to CWD
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
