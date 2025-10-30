import path, { join, dirname, resolve } from 'node:path';
import { agentContext, getFileSystem } from '#agent/agentContextLocalStorage';
import { logger } from '#o11y/logger';
import { IFileSystemService } from '#shared/files/fileSystemService';
import { TypescriptTools } from '#swe/lang/nodejs/typescriptTools';
import { PhpTools } from '#swe/lang/php/phpTools';
import { PythonTools } from '#swe/lang/python/pythonTools';
import { TerraformTools } from '#swe/lang/terraform/terraformTools';
import { projectDetectionAgent as defaultProjectDetectionAgent } from '#swe/projectDetectionAgent';
import type { LanguageTools } from './lang/languageTools';

export type LanguageRuntime = 'nodejs' | 'typescript' | 'php' | 'python' | 'terraform' | 'pulumi' | 'angular';

export type ProjectDetectionAgentFn = typeof defaultProjectDetectionAgent;
let _projectDetectionAgent: ProjectDetectionAgentFn = defaultProjectDetectionAgent;

/** Allows tests (or other callers) to replace the detection agent implementation. */
export function setProjectDetectionAgent(fn: ProjectDetectionAgentFn): void {
	_projectDetectionAgent = fn;
}

export type ScriptCommand = string | string[];

export const AI_INFO_FILENAME = '.typedai.json';
export const MINIMAL_AI_INFO = '[{"baseDir":"./"}]';

/**
 * Interface for the data structure stored in the .typedai.json file.
 * Excludes runtime-derived fields like languageTools and fileSelection.
 */
export interface ProjectInfoFileFormat {
	baseDir: string;
	primary?: boolean;
	language: LanguageRuntime | '';
	devBranch: string;
	indexDocs: string[];
	initialise: ScriptCommand;
	compile: ScriptCommand;
	format: ScriptCommand;
	staticAnalysis: ScriptCommand;
	test: ScriptCommand;
}

export interface ProjectScripts {
	initialise: string[];
	compile: string[];
	format: string[];
	staticAnalysis: string[];
	test: string[];
}

export interface ProjectInfo extends ProjectScripts {
	baseDir: string;
	/** If this is the primary project in the repository */
	primary: boolean; // Changed to non-optional, will be defaulted
	language: LanguageRuntime | '';
	languageTools: LanguageTools | null;
	/** The base development branch to make new branches from */
	devBranch: string;
	/** Note to include in the file selection prompts. e.g. "Do not include the files XYZ unless explicitly instructed" */
	fileSelection: string;
	/** GLob paths of which files should be processed by the buildIndexDocs function in repoIndexDocBuilder.ts */
	indexDocs: string[];
}

// Helper function to convert ProjectInfo to ProjectInfoFileFormat for saving
export function mapProjectInfoToFileFormat(projectInfo: ProjectInfo): ProjectInfoFileFormat {
	// Destructure to explicitly pick fields for ProjectInfoFileFormat
	const { baseDir, primary, language, devBranch, initialise, compile, format, staticAnalysis, test, indexDocs } = projectInfo;
	return {
		baseDir,
		primary,
		language,
		devBranch,
		initialise: normalizeScriptCommandToFileFormat(initialise),
		compile: normalizeScriptCommandToFileFormat(compile),
		format: normalizeScriptCommandToFileFormat(format),
		staticAnalysis: normalizeScriptCommandToFileFormat(staticAnalysis),
		test: normalizeScriptCommandToFileFormat(test),
		indexDocs,
	};
}

export function normalizeScriptCommandToArray(command: ScriptCommand | undefined | null): string[] {
	if (command == null) {
		// Handles undefined and null
		return [];
	}
	if (typeof command === 'string') {
		const trimmedCommand = command.trim();
		return trimmedCommand === '' ? [] : [trimmedCommand];
	}
	// If it's an array
	return command.map((c) => String(c).trim()).filter((c) => c !== '');
}

export function normalizeScriptCommandToFileFormat(commands: string[]): ScriptCommand {
	if (commands.length === 0) return '';
	if (commands.length === 1) return commands[0]!;
	return commands;
}

export function parseProjectInfo(fileContents: string): ProjectInfo[] | null {
	try {
		const projectInfosFromFile = JSON.parse(fileContents) as Partial<ProjectInfoFileFormat>[];
		logger.debug(projectInfosFromFile, `Parsed ${AI_INFO_FILENAME} content`);

		if (!Array.isArray(projectInfosFromFile)) throw new Error(`${AI_INFO_FILENAME} root should be a JSON array`);

		return projectInfosFromFile.map((infoFromFile, index) => {
			if (!infoFromFile.baseDir || typeof infoFromFile.baseDir !== 'string' || infoFromFile.baseDir.trim() === '')
				throw new Error(`Entry ${index} in ${AI_INFO_FILENAME} is missing a valid "baseDir" property.`);

			const scripts: ProjectScripts = {
				initialise: normalizeScriptCommandToArray(infoFromFile.initialise),
				compile: normalizeScriptCommandToArray(infoFromFile.compile),
				format: normalizeScriptCommandToArray(infoFromFile.format),
				staticAnalysis: normalizeScriptCommandToArray(infoFromFile.staticAnalysis),
				test: normalizeScriptCommandToArray(infoFromFile.test),
			};

			const language = (infoFromFile.language as LanguageRuntime) || '';

			return {
				baseDir: infoFromFile.baseDir.trim(),
				primary: typeof infoFromFile.primary === 'boolean' ? infoFromFile.primary : false,
				language,
				languageTools: getLanguageTools(language),
				devBranch: typeof infoFromFile.devBranch === 'string' && infoFromFile.devBranch.trim() !== '' ? infoFromFile.devBranch.trim() : 'main',
				...scripts,
				fileSelection: 'Do not include package manager lock files',
				indexDocs: Array.isArray(infoFromFile.indexDocs) ? infoFromFile.indexDocs : [],
			};
		});
	} catch (e) {
		const errorMessage = e instanceof Error ? e.message : String(e);
		logger.warn({ error: errorMessage, fileContentsPreview: fileContents.substring(0, 200) }, `Error parsing ${AI_INFO_FILENAME}`);
		return null;
	}
}

/**
 * Tries to load and parse the project info file from the given path.
 * Returns ProjectInfo[] if successful (can be an empty array).
 * Returns null if the file does not exist or is invalid (it will be renamed).
 */
async function tryLoadAndParse(filePath: string, fss: IFileSystemService, locationName: string): Promise<ProjectInfo[] | null> {
	if (await fss.fileExists(filePath)) {
		logger.debug(`Attempting to load ${AI_INFO_FILENAME} from ${locationName} at ${filePath}`);
		const fileContents = await fss.readFile(filePath);
		const parsedInfos = parseProjectInfo(fileContents);

		if (parsedInfos === null) {
			// File is invalid
			logger.warn(`${AI_INFO_FILENAME} at ${filePath} is invalid. Renaming it.`);
			try {
				const absPath = path.isAbsolute(filePath) ? filePath : path.resolve(fss.getWorkingDirectory(), filePath);
				const newName = `${absPath}.invalid_${Date.now()}`;
				await fss.rename(absPath, newName);
				logger.info(`Renamed invalid file to ${newName}`);
			} catch (renameError) {
				const errorMessage = renameError instanceof Error ? renameError.message : String(renameError);
				logger.error({ error: errorMessage, filePath }, 'Failed to rename invalid file.');
			}
			return null; // Signifies an invalid file was handled
		}
		logger.debug(`Successfully parsed ${AI_INFO_FILENAME} from ${locationName}. Projects: ${parsedInfos.length}`);
		return parsedInfos; // Valid ProjectInfo[] (could be empty)
	}
	logger.info(`${AI_INFO_FILENAME} not found in ${locationName} at ${filePath}`);
	return null;
}

async function findUpwards(startDir: string, file: string, fss: IFileSystemService): Promise<string | null> {
	let dir = startDir;
	while (true) {
		const candidate = path.join(dir, file);
		if (await fss.fileExists(candidate)) return candidate;

		// Don't search above the VCS root or the file system base directory
		const gitDir = path.join(dir, '.git');
		if (await fss.directoryExists(gitDir)) return null;
		if (fss.getBasePath() === dir) return null;

		const parent = path.dirname(dir);
		if (parent === dir) return null;
		dir = parent;
	}
}

/**
 * Gets the preconfigured language/runtime, base folder and key commands for projects.
 * It prioritizes loading from .typedai.json in CWD, then VCS root.
 * If no valid file is found, it runs detection via projectDetectionAgent and saves the result to CWD.
 * Invalid files are renamed to avoid re-parsing them in a loop.
 */
export async function getProjectInfos(autoDetect = true): Promise<ProjectInfo[] | null> {
	// if (autoDetect) console.log(new Error('getProjectInfos autoDetect'));
	logger.debug('Starting project detection process.');
	const fss = getFileSystem();
	// Always access the file relative to the current working directory
	const cwdInfoPath = AI_INFO_FILENAME;

	let vcsRoot: string | null = null;
	try {
		vcsRoot = fss.getVcsRoot();
	} catch (e) {
		logger.warn(e, 'Failed to get VCS root, proceeding without it.');
	}

	let loadedInfos: ProjectInfo[] | null;

	// 1. Try CWD
	loadedInfos = await tryLoadAndParse(cwdInfoPath, fss, 'CWD');

	if (!agentContext()?.containerId) {
		// 2. If not found in CWD, try VCS root (by temporarily changing WD)
		if (loadedInfos === null && vcsRoot && vcsRoot !== fss.getWorkingDirectory()) {
			const originalWd = fss.getWorkingDirectory();
			fss.setWorkingDirectory(vcsRoot);
			try {
				loadedInfos = await tryLoadAndParse(AI_INFO_FILENAME, fss, 'VCS root');
				if (loadedInfos !== null && Array.isArray(loadedInfos)) {
					// Successfully loaded from VCS root
					logger.info(`Using valid project info from VCS root. Writing to CWD for consistency: ${cwdInfoPath}`);
					const infosToSaveToFileFormat = loadedInfos.map(mapProjectInfoToFileFormat);
					// Switch back to original WD before writing
					fss.setWorkingDirectory(originalWd);
					await fss.writeFile(join(fss.getWorkingDirectory(), cwdInfoPath), JSON.stringify(infosToSaveToFileFormat, null, 2));
				}
			} finally {
				// Ensure working directory is restored
				fss.setWorkingDirectory(originalWd);
			}
		}

		// 3. If still no valid file, search upwards from CWD
		if (loadedInfos === null) {
			const found = await findUpwards(fss.getWorkingDirectory(), AI_INFO_FILENAME, fss);
			if (found) {
				const originalWd = fss.getWorkingDirectory();
				fss.setWorkingDirectory(path.dirname(found));
				try {
					loadedInfos = await tryLoadAndParse(AI_INFO_FILENAME, fss, 'parent directory');
					if (loadedInfos !== null && Array.isArray(loadedInfos)) {
						// Successfully loaded from a parent directory
						logger.info(`Using valid project info from parent directory: ${found}. Writing to CWD for consistency: ${cwdInfoPath}`);
						const infosToSave = loadedInfos.map(mapProjectInfoToFileFormat);
						// Switch back to original WD before writing
						fss.setWorkingDirectory(originalWd);
						await fss.writeFile(join(fss.getWorkingDirectory(), cwdInfoPath), JSON.stringify(infosToSave, null, 2));
					}
				} finally {
					// Ensure working directory is restored
					fss.setWorkingDirectory(originalWd);
				}
			}
		}
	}

	if (loadedInfos) return loadedInfos;

	// 4. If no valid file loaded from CWD, VCS root, or parent directories, run detection agent
	if (autoDetect) {
		const detectedProjectInfos = await _projectDetectionAgent();

		// Save detected info to CWD
		const projectInfosToFileFormat = detectedProjectInfos.map(mapProjectInfoToFileFormat);
		await fss.writeFile(join(fss.getWorkingDirectory(), cwdInfoPath), JSON.stringify(projectInfosToFileFormat, null, 2));
		logger.info(`Agent detection complete. Wrote ${detectedProjectInfos.length} project(s) to ${cwdInfoPath}`);
		return detectedProjectInfos;
	}

	return null;
}

export async function getProjectInfo(autoDetect = false): Promise<ProjectInfo | null> {
	const infos = await getProjectInfos(autoDetect); // This is now the robust version

	if (!infos || infos.length === 0) {
		logger.info('getProjectInfo: No projects detected or loaded.');
		return null;
	}

	if (infos.length === 1) {
		logger.debug(`getProjectInfo: Exactly one project found: ${infos[0]!.baseDir}`);
		return infos[0]!;
	}

	// Multiple projects
	logger.debug(`getProjectInfo: Multiple projects (${infos.length}) found. Looking for a primary project.`);
	const primaryProject = infos.find((project) => project.primary);
	if (primaryProject) {
		logger.debug(`getProjectInfo: Selecting primary project: ${primaryProject.baseDir}`);
		return primaryProject;
	}

	logger.warn('getProjectInfo: Multiple projects detected/loaded, but no primary project is designated. Returning the first project as a fallback.');
	return infos[0]!; // Fallback to the first project if no primary
}

export function getLanguageTools(type: LanguageRuntime | ''): LanguageTools | null {
	logger.debug(`getLanguageTools: ${type}`);
	if (!type) return null;
	switch (type) {
		case 'nodejs':
		case 'typescript':
		case 'pulumi':
		case 'angular': // Added angular
			return new TypescriptTools();
		case 'python':
			return new PythonTools();
		case 'terraform':
			return new TerraformTools();
		case 'php':
			return new PhpTools();
		default: {
			// This ensures all cases in LanguageRuntime are handled.
			// If a new language is added to LanguageRuntime but not here, TypeScript will error.
			const _exhaustiveCheck: never = type;
			logger.warn(`No specific tooling support configured for language tool: ${_exhaustiveCheck}`);
			return null;
		}
	}
}
