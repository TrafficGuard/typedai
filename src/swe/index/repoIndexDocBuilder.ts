import { promises as fs } from 'node:fs';
import path, { basename, dirname, join } from 'node:path';
import type { Span } from '@opentelemetry/api';
import micromatch from 'micromatch';
import { getFileSystem, llms } from '#agent/agentContextLocalStorage';
import { logger } from '#o11y/logger';
import { withActiveSpan } from '#o11y/trace';
import { errorToString } from '#utils/errors';
import { typedaiDirName } from '../../appVars';

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

/** Summary documentation for a file/folder */
export interface Summary {
	/** Path to the file/folder */
	path: string;
	/** A short of the file/folder */
	short: string;
	/** A longer summary of the file/folder */
	long: string;
}

// Configuration constants
const BATCH_SIZE = 10;

/**
 * This auto-generates summary documentation for a project/repository, to assist with searching in the repository.
 * This should generally be run in the root folder of a project/repository.
 * The documentation summaries are saved in a parallel directory structure under the .typedai/docs folder
 */
export async function buildIndexDocs(): Promise<void> {
	logger.info('Building index docs');

	await withActiveSpan('Build index docs', async (span: Span) => {
		try {
			// Load and parse projectInfo.json
			const projectInfoPath = path.join(process.cwd(), 'projectInfo.json');
			const projectInfoData = await fs.readFile(projectInfoPath, 'utf-8');
			const projectInfos = JSON.parse(projectInfoData);

			// Assuming you have only one project in the array
			const projectInfo = projectInfos[0];

			// Extract indexDocs patterns
			const indexDocsPatterns: string[] = projectInfo.indexDocs || [];

			const fss = getFileSystem();
			// Define fileMatchesIndexDocs function inside buildIndexDocs
			function fileMatchesIndexDocs(filePath: string): boolean {
				const fss = getFileSystem();

				// If filePath is absolute, make it relative to the working directory
				if (path.isAbsolute(filePath)) {
					filePath = path.relative(fss.getWorkingDirectory(), filePath);
				}

				// Normalize file path to use forward slashes
				const normalizedPath = filePath.split(path.sep).join('/');

				logger.info(`Checking indexDocs matching for ${normalizedPath}`);

				return micromatch.isMatch(normalizedPath, indexDocsPatterns);
			}

			// Define folderMatchesIndexDocs function inside buildIndexDocs
			function folderMatchesIndexDocs(folderPath: string): boolean {
				const fss = getFileSystem();

				// Convert absolute folderPath to a relative path
				if (path.isAbsolute(folderPath)) {
					folderPath = path.relative(fss.getWorkingDirectory(), folderPath);
				}

				// Normalize paths to use forward slashes
				const normalizedFolderPath = folderPath.split(path.sep).join('/');

				// Ensure folder path ends with a slash
				const folderPathWithSlash = normalizedFolderPath.endsWith('/') ? normalizedFolderPath : `${normalizedFolderPath}/`;

				// Extract directory portions from the patterns
				const patternDirs = indexDocsPatterns.map((pattern) => {
					const index = pattern.indexOf('**');
					let dir = index !== -1 ? pattern.substring(0, index) : pattern;
					dir = dir.endsWith('/') ? dir : `${dir}/`;
					return dir;
				});

				// Check if the folder path starts with any of the pattern directories
				return patternDirs.some((patternDir) => folderPathWithSlash.startsWith(patternDir));
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
	const fileContents = await fs.readFile(filePath, 'utf-8');
	const parentSummaries = await getParentSummaries(dirname(filePath));
	const doc = await generateFileSummary(fileContents, parentSummaries, easyLlm);
	const relativeFilePath = path.relative(getFileSystem().getWorkingDirectory(), filePath);
	doc.path = relativeFilePath;

	const summaryFilePath = getSummaryFileName(relativeFilePath);
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
	const files = await fileSystem.listFilesInDirectory(folderPath);

	// Use the full relative path for matching
	const filteredFiles = files.filter((file) => {
		const fullRelativePath = path.relative(fileSystem.getWorkingDirectory(), path.join(folderPath, file));
		return fileMatchesIndexDocs(fullRelativePath);
	});

	if (filteredFiles.length === 0) {
		logger.info(`No files to process in folder ${folderPath}`);
		return;
	}

	logger.info(`Processing ${filteredFiles.length} files in folder ${folderPath}`);
	const easyLlm = llms().easy;
	const errors: Array<{ file: string; error: Error }> = [];

	await withActiveSpan('processFilesInBatches', async (span: Span) => {
		// Process files in batches within the folder
		for (let i = 0; i < filteredFiles.length; i += BATCH_SIZE) {
			const batch = filteredFiles.slice(i, i + BATCH_SIZE);
			await Promise.all(
				batch.map(async (file) => {
					const filePath = join(folderPath, file);
					try {
						await processFile(filePath, easyLlm);
					} catch (e) {
						logger.error(e, `Failed to process file ${filePath}`);
						errors.push({ file: filePath, error: e });
					}
				}),
			);
			logger.info(`Completed batch ${Math.floor(i / BATCH_SIZE) + 1} of ${Math.ceil(filteredFiles.length / BATCH_SIZE)}`);
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
					logger.info(`Skipping folder ${subFolderPath} as it does not match any indexDocs patterns`);
				}
			}

			// Process files in the current folder
			await processFilesInFolder(folderPath, fileMatchesIndexDocs);

			// Build folder summary if any files were processed
			const hasProcessedFiles = await checkIfFolderHasProcessedFiles(folderPath, fileMatchesIndexDocs);
			if (hasProcessedFiles) {
				await buildFolderSummary(folderPath);
			}
		} catch (error) {
			logger.error(`Error processing folder ${folderPath}: ${errorToString(error)}`);
			throw error;
		}
	});
}

async function checkIfFolderHasProcessedFiles(folderPath: string, fileMatchesIndexDocs: (filePath: string) => boolean): Promise<boolean> {
	const fileSystem = getFileSystem();
	const files = await fileSystem.listFilesInDirectory(folderPath);
	const processedFiles = files.filter((file) => {
		const fullRelativePath = path.relative(fileSystem.getWorkingDirectory(), path.join(folderPath, file));
		return fileMatchesIndexDocs(fullRelativePath);
	});
	return processedFiles.length > 0;
}

/**
 * Generate a summary for a single file
 */
async function generateFileSummary(fileContents: string, parentSummaries: Summary[], llm: any): Promise<Summary> {
	let parentSummary = '';
	if (parentSummaries.length) {
		parentSummary = '<parent-summaries>\n';
		for (const summary of parentSummaries) {
			parentSummary += `<parent-summary path="${summary.path}">\n${summary.long}\n</parent-summary>\n`;
		}
		parentSummary += '</parent-summaries>\n\n';
	}

	const prompt = `
Analyze this source code file and generate a summary that captures its purpose and functionality:

${parentSummary}
<source-code>
${fileContents}
</source-code>

Generate two summaries in JSON format:
1. A one-sentence overview of the file's purpose
2. A detailed paragraph describing:
   - The file's main functionality and features
   - Key classes/functions/components
   - Its role in the larger codebase
   - Important dependencies or relationships
   - Notable patterns or implementation details

Focus on unique aspects not covered in parent summaries.

Respond only with JSON in this format:
<json>
{
  "short": "One-sentence file summary",
  "long": "Detailed paragraph describing the file"
}
</json>`;

	return await llm.generateJson(prompt, { id: 'Generate file summary' });
}

// Utils -----------------------------------------------------------

/**
 * Returns the summary file path for a given source file path
 * @param filePath source file path
 * @returns summary file path
 */
function getSummaryFileName(filePath: string): string {
	const relativeFilePath = path.relative(getFileSystem().getWorkingDirectory(), filePath);
	const fileName = basename(relativeFilePath);
	const dirPath = dirname(relativeFilePath);
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
async function buildFolderSummary(folderPath: string): Promise<void> {
	const fileSummaries = await getFileSummaries(folderPath);
	const subFolderSummaries = await getSubFolderSummaries(folderPath);

	if (!fileSummaries.length && !subFolderSummaries.length) {
		logger.info(`No summaries to build for folder ${folderPath}`);
		return;
	}

	try {
		const combinedSummary = combineFileAndSubFoldersSummaries(fileSummaries, subFolderSummaries);
		const parentSummaries = await getParentSummaries(folderPath);
		const folderSummary = await generateFolderSummary(llms().easy, combinedSummary, parentSummaries);
		const relativeFolderPath = path.relative(getFileSystem().getWorkingDirectory(), folderPath);
		folderSummary.path = relativeFolderPath;

		const folderName = basename(folderPath);
		const summaryPath = join(typedaiDirName, 'docs', relativeFolderPath, `_${folderName}.json`);
		await fs.mkdir(dirname(summaryPath), { recursive: true });
		await fs.writeFile(summaryPath, JSON.stringify(folderSummary, null, 2));
		logger.info(`Generated summary for folder ${relativeFolderPath}`);
	} catch (error) {
		logger.error(`Failed to generate summary for folder ${folderPath}: ${errorToString(error)}`);
		throw error;
	}
}

/**
 * Sort by depth for bottom-up building of the docs
 * @param folders
 */
function sortFoldersByDepth(folders: string[]): string[] {
	return folders.sort((a, b) => b.split('/').length - a.split('/').length);
}

async function getFileSummaries(folderPath: string): Promise<Summary[]> {
	const fileSystem = getFileSystem();
	const fileNames = await fileSystem.listFilesInDirectory(folderPath);
	const summaries: Summary[] = [];

	for (const fileName of fileNames) {
		const summaryPath = getSummaryFileName(join(folderPath, fileName));
		logger.info(`File summary path ${summaryPath}`);
		try {
			const summaryContent = await fs.readFile(summaryPath, 'utf-8');
			summaries.push(JSON.parse(summaryContent));
		} catch (e) {
			logger.warn(`Failed to read summary for file ${fileName}`);
		}
	}

	return summaries;
}

async function getSubFolderSummaries(folder: string): Promise<Summary[]> {
	const fileSystem = getFileSystem();
	const subFolders = await fileSystem.listFolders(folder);
	const summaries: Summary[] = [];

	for (const subFolder of subFolders) {
		const folderName = subFolder.split('/').pop();
		const relativeSubFolder = path.relative(fileSystem.getWorkingDirectory(), path.join(folder, subFolder));
		const summaryPath = join('.typedai', 'docs', relativeSubFolder, `_${folderName}.json`);
		logger.info(`Folder summary path ${summaryPath}`);
		try {
			const summaryContent = await fs.readFile(summaryPath, 'utf-8');
			summaries.push(JSON.parse(summaryContent));
		} catch (e) {
			// logger.warn(`Failed to read summary for subfolder ${subFolder}`);
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
	const allSummaries = [...subFolderSummaries, ...fileSummaries];
	return allSummaries.map((summary) => `${summary.path}\n${summary.long}`).join('\n\n');
}

async function generateFolderSummary(llm: any, combinedSummary: string, parentSummaries: Summary[] = []): Promise<Summary> {
	let parentSummary = '';
	if (parentSummaries.length) {
		parentSummary = '<parent-summaries>\n';
		for (const summary of parentSummaries) {
			parentSummary += `<parent-summary path="${summary.path}">\n${summary.long}\n</parent-summary>\n`;
		}
		parentSummary += '</parent-summaries>\n\n';
	}

	const prompt = `
Analyze the following summaries of files and subfolders within this directory:

${parentSummary}
<summaries>
${combinedSummary}
</summaries>

Task: Generate a cohesive summary for this folder that captures its role in the larger project.

1. Key Topics:
   List 3-5 main topics or functionalities this folder addresses.

2. Folder Summary:
   Provide two summaries in JSON format:
   a) A one-sentence overview of the folder's purpose and contents.
   b) A paragraph-length description highlighting:
      - The folder's role in the project architecture
      - Main components or modules contained
      - Key functionalities implemented in this folder
      - Relationships with other parts of the codebase
      - Any patterns or principles evident in the folder's organization

Note: Focus on the folder's unique contributions. Avoid repeating information from parent summaries.

Respond only with JSON in this format:
<json>
{
  "short": "Concise one-sentence folder summary",
  "long": "Detailed paragraph summarizing the folder's contents and significance"
}
</json>
`;

	return await llm.generateJson(prompt, { id: 'Generate folder summary' });
}

// -----------------------------------------------------------------------------
//   Top-level summary
// -----------------------------------------------------------------------------

export async function generateTopLevelSummary(): Promise<string> {
	const fileSystem = getFileSystem();
	const cwd = fileSystem.getWorkingDirectory();

	// Get all folder-level summaries
	const folderSummaries = await getAllFolderSummaries(cwd);

	// Combine all folder summaries
	const combinedSummary = folderSummaries.map((summary) => `${summary.path}:\n${summary.long}`).join('\n\n');

	// Generate the top-level summary using LLM
	const topLevelSummary = await llms().easy.generateText(generateDetailedSummaryPrompt(combinedSummary), { id: 'Generate top level summary' });

	// Save the top-level summary
	await saveTopLevelSummary(cwd, topLevelSummary);

	return topLevelSummary;
}

async function getAllFolderSummaries(rootDir: string): Promise<Summary[]> {
	const fileSystem = getFileSystem();
	const folders = await fileSystem.getAllFoldersRecursively();
	const summaries: Summary[] = [];

	for (const folder of folders) {
		const folderName = folder.split('/').pop();
		const summaryPath = join(rootDir, '.typedai', 'docs', folder, `_${folderName}.json`);
		try {
			const summaryContent = await fs.readFile(summaryPath, 'utf-8');
			summaries.push(JSON.parse(summaryContent));
		} catch (e) {
			// logger.warn(`Failed to read summary for folder ${folder}`);
		}
	}

	return summaries;
}

function generateDetailedSummaryPrompt(combinedSummary: string): string {
	return `Based on the following folder summaries, create a comprehensive overview of the entire project:

${combinedSummary}

Generate a detailed Markdown summary that includes:

1. Project Overview:
   - The project's primary purpose and goals

2. Architecture and Structure:
   - High-level architecture of the project
   - Key directories and their roles
   - Main modules or components and their interactions

3. Core Functionalities:
   - List and briefly describe the main features with their location in the project

4. Technologies and Patterns:
   - Primary programming languages used
   - Key frameworks, libraries, or tools
   - Notable design patterns or architectural decisions

Ensure the summary is well-structured, using appropriate Markdown formatting for readability.
Include folder path names and file paths where applicable to help readers navigate through the project.
`;
}

async function saveTopLevelSummary(rootDir: string, summary: string): Promise<void> {
	const summaryPath = join(typedaiDirName, 'docs', '_summary');
	await fs.writeFile(summaryPath, JSON.stringify(summary, null, 2));
}

export async function getTopLevelSummary(): Promise<string> {
	try {
		return (await fs.readFile(join(typedaiDirName, 'docs', '_summary'))).toString();
	} catch (e) {
		return '';
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

	while (currentPath !== '.') {
		const folderName = basename(currentPath);
		const summaryPath = join(typedaiDirName, 'docs', currentPath, `_${folderName}.json`);
		try {
			const summaryContent = await fs.readFile(summaryPath, 'utf-8');
			parentSummaries.unshift(JSON.parse(summaryContent));
		} catch (e) {
			// If we can't read a summary, we've reached the top of the summarized hierarchy
			break;
		}
		currentPath = dirname(currentPath);
	}

	return parentSummaries;
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
	const repoFolder = (await fss.getVcsRoot()) ?? fss.getWorkingDirectory();

	const docsDir = join(repoFolder, typedaiDirName, 'docs');
	logger.info(`Load summaries from ${docsDir}`);

	try {
		const dirExists = await fss.fileExists(docsDir);
		if (!dirExists && !createIfNotExits) {
			logger.warn(`The ${docsDir} directory does not exist.`);
			return summaries;
		}
		if (!dirExists) {
			await buildIndexDocs();
		}

		const files = await fss.listFilesRecursively(docsDir, false);
		logger.info(`Found ${files.length} files in ${docsDir}`);

		if (files.length === 0) {
			logger.warn(`No files found in ${docsDir}. Directory might be empty.`);
			return summaries;
		}

		for (const file of files) {
			if (file.endsWith('.json')) {
				try {
					if (await fss.fileExists(file)) {
						const content = await fss.readFile(file);
						const summary: Summary = JSON.parse(content);
						summaries.set(summary.path, summary);
					}
				} catch (error) {
					logger.warn(`Failed to read or parse summary file: ${file}. ${errorToString(error)}`);
				}
			}
		}
	} catch (error) {
		logger.error(`Error listing files in ${docsDir}: ${error.message}`);
		throw error;
	}

	logger.info(`Loaded ${summaries.size} summaries`);
	return summaries;
}
