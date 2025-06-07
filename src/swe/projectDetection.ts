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

const PROJECT_FILENAME = 'ai.json';

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
	const infoPath = path.join(getFileSystem().getWorkingDirectory(), PROJECT_FILENAME);
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
		let projectInfos = JSON.parse(fileContents) as ProjectInfo[];
		logger.info(projectInfos);
		if (!Array.isArray(projectInfos)) throw new Error('projectInfo.json should be a JSON array');
		projectInfos = projectInfos.map((info) => {
			const path = join(getFileSystem().getWorkingDirectory(), info.baseDir);
			if (!info.baseDir) {
				throw new Error(`All entries in ${path} must have the basePath property`);
			}
			info.languageTools = getLanguageTools(info.language as LanguageRuntime);
			return info;
		});
		return projectInfos;
	} catch (e) {
		logger.warn(e, 'Error loading projectInfo.json');
		return null;
	}
}

/**
 * Determines the language/runtime, base folder and key commands for a project on the filesystem.
 * Loads from the file projectInfo.json if it exists
 */
export async function detectProjectInfo(requirements?: string): Promise<ProjectInfo[]> {
	logger.info('detectProjectInfo');
	const fss = getFileSystem();
	if (await fss.fileExists(PROJECT_FILENAME)) {
		const projectInfoJson = await fss.readFile(PROJECT_FILENAME);
		logger.info(`loaded projectInfo.json ${projectInfoJson}`);
		logger.info(projectInfoJson);
		// TODO check projectInfo matches the format we expect
		const info = parseProjectInfo(projectInfoJson);
		if (info !== null) return info;
	} else if (await fss.fileExists(join(fss.getVcsRoot(), PROJECT_FILENAME))) {
		// logger.info('current dir ' + fileSystem.getWorkingDirectory());
		// logger.info('fileSystem.getVcsRoot() ' + fileSystem.getVcsRoot());
		// throw new Error(
		// 	'TODO handle if we are in a directory inside a repository. Look for the projectInfo.json in the repo root folder and see if any entry exists for the current folder or above ',
		// );
		logger.info('Found projectInfo.json in repository root folder');
		const projectInfoJson = await fss.readFile(join(fss.getVcsRoot(), PROJECT_FILENAME));
		const info = parseProjectInfo(projectInfoJson);
		if (info !== null) return info;
	}

	logger.info('Detecting project info...');
	const projectInfo = await projectDetectionAgent(requirements);
	logger.info(projectInfo, 'ProjectInfo detected');
	await getFileSystem().writeFile(PROJECT_FILENAME, JSON.stringify([projectInfo], null, 2));
	return projectInfo;
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
