import { Dirent, readdir as nodeReaddir /* Import async readdir */ } from 'node:fs'; // Remove readdirSync
import { promisify } from 'node:util';
import * as path from 'path';
import { getFileSystem } from '#agent/agentContextLocalStorage';
import { FileSystemService } from '#functions/storage/fileSystemService';
import { countTokens } from '#llm/tokens';
import { logger } from '#o11y/logger';
import { ProjectInfo } from '#swe/projectDetection';
import { Summary, getTopLevelSummary, loadBuildDocsSummaries } from './repoIndexDocBuilder';

const fs = {
	readdir: promisify(nodeReaddir),
};

interface RepositoryMap {
	/** Text representation of the repository */
	text: string;
	/** token count of the text */
	tokens?: number;
}

export interface RepositoryMaps {
	repositorySummary: string;
	fileSystemTree: RepositoryMap;
	folderSystemTreeWithSummaries: RepositoryMap;
	fileSystemTreeWithFolderSummaries: RepositoryMap;
	fileSystemTreeWithFileSummaries: RepositoryMap;
	languageProjectMap: RepositoryMap;
}

export class Folder {
	subFolders: Folder[] = [];
	/** Files in this folder */
	files: File[] = [];
	/** Number of tokens from all the files in this folder */
	tokens = 0;
	/** Total tokens from all the files in this folder and subfolders */
	totalTokens = 0;
	/** Total number of files in the folder and subfolders */
	totalFiles = 0;

	constructor(public name: string) {}
}

export class File {
	constructor(
		public name: string,
		public tokens: number,
	) {}
}

/**
 *
 */
export async function generateRepositoryMaps(projectInfos: ProjectInfo[]): Promise<RepositoryMaps> {
	const summaries: Map<string, Summary> = await loadBuildDocsSummaries();

	let languageProjectMap = '';
	if (projectInfos.length > 0) {
		const projectInfo = projectInfos[0];
		if (projectInfo.languageTools) {
			languageProjectMap = await projectInfo.languageTools.generateProjectMap();
			logger.info(`languageProjectMap ${await countTokens(languageProjectMap)}`);
		}
		if (projectInfos.length > 1) {
			logger.info('TODO handle multiple projectInfos');
		}
	}

	const fss = getFileSystem();
	const fileSystemTree = await fss.getFileSystemTree();

	const folderStructure = await buildFolderStructure(fss.getWorkingDirectory(), fss);

	const folderSystemTreeWithSummaries = await generateFolderTreeWithSummaries(summaries);
	const fileSystemTreeWithFolderSummaries = await generateFileSystemTreeWithSummaries(summaries, false);
	const fileSystemTreeWithFileSummaries = await generateFileSystemTreeWithSummaries(summaries, true);

	return {
		fileSystemTree: { text: fileSystemTree, tokens: await countTokens(fileSystemTree) },
		folderSystemTreeWithSummaries: { text: folderSystemTreeWithSummaries, tokens: await countTokens(folderSystemTreeWithSummaries) },
		fileSystemTreeWithFolderSummaries: { text: fileSystemTreeWithFolderSummaries, tokens: await countTokens(fileSystemTreeWithFolderSummaries) },
		fileSystemTreeWithFileSummaries: { text: fileSystemTreeWithFileSummaries, tokens: await countTokens(fileSystemTreeWithFileSummaries) },
		repositorySummary: await getTopLevelSummary(),
		languageProjectMap: { text: languageProjectMap, tokens: await countTokens(languageProjectMap) },
	};
}

async function generateFolderTreeWithSummaries(summaries: Map<string, Summary>): Promise<string> {
	const fileSystem = getFileSystem();
	const treeStructure = await fileSystem.getFileSystemTreeStructure();
	let documentation = '';

	for (const [folderPath, files] of Object.entries(treeStructure)) {
		const folderSummary = summaries.get(folderPath);
		documentation += `${folderPath}/ (${files.length} files)  ${folderSummary ? `  ${folderSummary.short}` : ''}\n`;
		documentation += '\n';
	}
	return documentation;
}

/**
 * Generates a project file system tree with the folder long summaries and file short summaries
 * @param summaries
 * @param includeFileSummaries
 */
async function generateFileSystemTreeWithSummaries(summaries: Map<string, Summary>, includeFileSummaries: boolean): Promise<string> {
	const fileSystem = getFileSystem();
	const treeStructure = await fileSystem.getFileSystemTreeStructure();
	let documentation = '';

	for (const [folderPath, files] of Object.entries(treeStructure)) {
		const folderSummary = summaries.get(folderPath);

		documentation += `${folderPath}/  ${folderSummary ? `  ${folderSummary.short}` : ''}\n`;

		for (const file of files) {
			const filePath = `${folderPath}/${file}`;
			const fileSummary = summaries.get(filePath);
			if (fileSummary && includeFileSummaries) {
				documentation += `  ${file}  ${fileSummary.short}\n`;
			} else {
				documentation += `  ${file}\n`;
			}
		}
		documentation += '\n';
	}
	return documentation;
}

/**
 * Recursively processes a directory structure, calculating token counts for files.
 *
 * @param dirPath The path to the directory to process (relative to FileSystemService's working directory).
 * @param fileSystemService An instance of FileSystemService to use for file operations.
 * @returns A Promise resolving to a Folder object representing the directory structure and token counts.
 */
export async function buildFolderStructure(dirPath: string, fileSystemService: FileSystemService): Promise<Folder> {
	const folderName = path.basename(dirPath) || '.';
	const currentFolder = new Folder(folderName);
	// Resolve path relative to the FileSystemService's *current* working directory
	const absoluteDirPath = path.resolve(fileSystemService.getWorkingDirectory(), dirPath);
	logger.debug(`Processing directory: ${absoluteDirPath}`);
	// console.log(dirPath)
	let dirents: Dirent[];
	try {
		dirents = await fs.readdir(absoluteDirPath, { withFileTypes: true });
	} catch (error) {
		logger.error(`Error reading directory ${absoluteDirPath}:`, error);
		// Return an empty folder or throw, depending on desired error handling
		return currentFolder; // Return current (likely empty) folder on error
	}

	// Load gitignore rules for the current directory
	const gitRoot = fileSystemService.getVcsRoot();
	const ig = await fileSystemService.loadGitignoreRules(absoluteDirPath, gitRoot);

	const fileProcessingPromises: Promise<{ name: string; tokens: number } | null>[] = [];
	const subDirProcessingPromises: Promise<Folder>[] = [];

	for (const dirent of dirents) {
		const itemName = dirent.name;

		// Explicitly skip the .gitignore file itself from processing/counting
		if (itemName === '.gitignore') continue;

		// Calculate relative path based on the *service's* working directory for consistency
		const itemFullPath = path.join(absoluteDirPath, itemName);
		const itemRelativePath = path.relative(fileSystemService.getWorkingDirectory(), itemFullPath);

		const isDirectory = dirent.isDirectory();
		// For ignore checks, directories often need a trailing slash depending on the rule
		// Let's check both the path and the path with a trailing slash if it's a directory
		const checkPath = itemRelativePath; // Base path for check
		const checkPathDir = isDirectory ? `${itemRelativePath}/` : itemRelativePath; // Path with trailing slash if dir
		const isIgnored = ig.ignores(checkPath) || (isDirectory && ig.ignores(checkPathDir));

		// Check if the item is ignored by .gitignore
		// Use the pre-calculated isIgnored result
		if (isIgnored) {
			// logger.trace(`Ignoring ${itemRelativePath}`);
			continue;
		}

		if (dirent.isFile()) {
			const filePromise = (async () => {
				try {
					// Use the relative path for readFile as expected by FileSystemService
					const fileContent = await fileSystemService.readFile(itemRelativePath);
					const fileTokens = await countTokens(fileContent);
					return { name: itemName, tokens: fileTokens };
				} catch (readError) {
					logger.error(`Error reading or counting tokens for file ${itemRelativePath}:`, readError);
					return null; // Return null on error to avoid breaking Promise.all
				}
			})();
			fileProcessingPromises.push(filePromise);
		} else if (dirent.isDirectory()) {
			// Recursively process the subdirectory using the relative path
			const subDirPromise = buildFolderStructure(itemRelativePath, fileSystemService);
			subDirProcessingPromises.push(subDirPromise);
		}
	}

	const processedFiles = await Promise.all(fileProcessingPromises);
	const processedSubFolders = await Promise.all(subDirProcessingPromises);

	for (const fileResult of processedFiles) {
		if (fileResult) {
			const file = new File(fileResult.name, fileResult.tokens);
			currentFolder.files.push(file);
			currentFolder.tokens += fileResult.tokens;
			currentFolder.totalFiles++;
		}
	}

	currentFolder.subFolders = processedSubFolders;

	// Calculate total tokens and total files for the current folder
	currentFolder.totalTokens = currentFolder.tokens;
	// currentFolder.totalFiles already counts files directly in this folder
	for (const sub of currentFolder.subFolders) {
		currentFolder.totalTokens += sub.totalTokens;
		currentFolder.totalFiles += sub.totalFiles; // Add file counts from subfolders
	}

	return currentFolder;
}
