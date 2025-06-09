import { existsSync, readFileSync } from 'node:fs';
import path, { join } from 'node:path';
import { getFileSystem } from '#agent/agentContextLocalStorage';
import { logger } from '#o11y/logger';
import { TypescriptTools } from '#swe/lang/nodejs/typescriptTools';
import { PhpTools } from '#swe/lang/php/phpTools';
import { PythonTools } from '#swe/lang/python/pythonTools';
import { TerraformTools } from '#swe/lang/terraform/terraformTools';
import { projectDetectionAgent } from '#swe/projectDetectionAgent';
import type { LanguageTools } from './lang/languageTools';

export type LanguageRuntime = 'nodejs' | 'typescript' | 'php' | 'python' | 'terraform' | 'pulumi' | 'angular';

export const AI_INFO_FILENAME = '.typedai.json';

/**
 * Interface for the data structure stored in the .typedai.json file.
 * Excludes runtime-derived fields like languageTools and fileSelection.
 */
export interface ProjectInfoFileFormat extends ProjectScripts {
	baseDir: string;
	primary?: boolean;
	language: LanguageRuntime | '';
	devBranch: string;
	indexDocs: string[];
}

export interface ProjectScripts {
	initialise: string;
	compile: string;
	format: string;
	staticAnalysis: string;
	test: string;
}

export interface ProjectInfo extends ProjectScripts {
	baseDir: string;
	/** If this is the primary project in the repository */
	primary?: boolean;
	language: LanguageRuntime | '';
	languageTools: LanguageTools | null;
	/** The base development branch to make new branches from */
	devBranch: string;
	/** Note to include in the file selection prompts. e.g. "Do not include the files XYZ unless explicitly instructed" */
	fileSelection: string;
	/** GLob paths of which files should be processed by the buildIndexDocs function in repoIndexDocBuilder.ts */
	indexDocs: string[];
}

export async function getProjectInfo(): Promise<ProjectInfo | null> {
	const infoPath = path.join(getFileSystem().getWorkingDirectory(), AI_INFO_FILENAME);
	if (existsSync(infoPath)) {
		const infos = parseProjectInfo(readFileSync(infoPath).toString());
		if (infos.length === 1) return infos[0];
		// if (infos.length > 1) return infos.find(project => project.)
	} else {
		const infos = await detectProjectInfo();
		if (infos.length === 1) return infos[0];
	}
	return null;
}

function parseProjectInfo(fileContents: string): ProjectInfo[] | null {
	try {
		// Parse as the file format
		const projectInfosFromFile = JSON.parse(fileContents) as ProjectInfoFileFormat[];
		logger.info(projectInfosFromFile, `Parsed ${AI_INFO_FILENAME}`);

		if (!Array.isArray(projectInfosFromFile)) throw new Error(`${AI_INFO_FILENAME} should be a JSON array`);

		// Map to the full ProjectInfo structure, adding derived fields
		const projectInfosFull: ProjectInfo[] = projectInfosFromFile.map((infoFromFile) => {
			const path = join(getFileSystem().getWorkingDirectory(), infoFromFile.baseDir);
			if (!infoFromFile.baseDir) {
				throw new Error(`All entries in ${path} must have the basePath property`);
			}
			return {
				...infoFromFile, // Spread properties from the file format
				languageTools: getLanguageTools(infoFromFile.language as LanguageRuntime), // Add languageTools
				fileSelection: 'Do not include package manager lock files', // Add default fileSelection
			};
		});

		return projectInfosFull;
	} catch (e) {
		logger.warn(e, `Error loading and parsing ${AI_INFO_FILENAME}`);
		return null;
	}
}

/**
 * Determines the language/runtime, base folder and key commands for a project on the filesystem.
 * Loads from the file defined by AI_INFO_FILENAME if it exists
 */
export async function detectProjectInfo(): Promise<ProjectInfo[]> {
	logger.info('detectProjectInfo');
	const fss = getFileSystem();
	if (await fss.fileExists(AI_INFO_FILENAME)) {
		const projectInfoJson = await fss.readFile(AI_INFO_FILENAME);
		logger.info(projectInfoJson, `Loaded ${AI_INFO_FILENAME}`);
		// TODO check projectInfo matches the format we expect
		const info = parseProjectInfo(projectInfoJson);
		if (info !== null) return info;
	} else if (await fss.fileExists(join(fss.getVcsRoot(), AI_INFO_FILENAME))) {
		// logger.info('current dir ' + fileSystem.getWorkingDirectory());
		// logger.info('fileSystem.getVcsRoot() ' + fileSystem.getVcsRoot());
		// throw new Error(
		// 	'TODO handle if we are in a directory inside a repository. Look for the ${AI_INFO_FILENAME} in the repo root folder and see if any entry exists for the current folder or above ',
		// );
		logger.info(`Found ${AI_INFO_FILENAME} in repository root folder`);
		const projectInfoJson = await fss.readFile(join(fss.getVcsRoot(), AI_INFO_FILENAME));
		const info = parseProjectInfo(projectInfoJson);
		if (info !== null) return info;
	}

	logger.info('Detecting project info...');
	const projectInfosFull = await projectDetectionAgent(); // This returns ProjectInfo[]
	logger.info(projectInfosFull, 'ProjectInfo detected');

	// Filter out fields that should not be persisted in the file
	const projectInfosToFile: ProjectInfoFileFormat[] = projectInfosFull.map((info) => ({
		baseDir: info.baseDir,
		primary: info.primary,
		language: info.language,
		devBranch: info.devBranch,
		initialise: info.initialise,
		compile: info.compile,
		format: info.format,
		staticAnalysis: info.staticAnalysis,
		test: info.test,
		indexDocs: info.indexDocs,
		// Exclude languageTools and fileSelection
	}));

	await getFileSystem().writeFile(AI_INFO_FILENAME, JSON.stringify(projectInfosToFile, null, 2));
	return projectInfosFull; // Return the full objects with languageTools and fileSelection
}

export function getLanguageTools(type: LanguageRuntime | ''): LanguageTools | null {
	logger.info(`getLanguageTools: ${type}`);
	if (!type) return null;
	switch (type) {
		case 'nodejs':
		case 'typescript':
		case 'pulumi':
			return new TypescriptTools();
		case 'python':
			return new PythonTools();
		case 'terraform':
			return new TerraformTools();
		case 'php':
			return new PhpTools();
		default:
			logger.warn(`No tooling support for language tool ${type}`);
			return null;
	}
}
