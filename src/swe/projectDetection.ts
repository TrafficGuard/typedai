import { existsSync, readFileSync, writeFileSync } from 'fs';
import path, { join } from 'path';
import { getFileSystem, llms } from '#agent/agentContextLocalStorage';
import { logger } from '#o11y/logger';
import { TypescriptTools } from '#swe/lang/nodejs/typescriptTools';
import { PhpTools } from '#swe/lang/php/phpTools';
import { PythonTools } from '#swe/lang/python/pythonTools';
import { TerraformTools } from '#swe/lang/terraform/terraformTools';
import { LanguageTools } from './lang/languageTools';

interface ProjectDetections {
	projects: ProjectDetection[];
}

type LanguageRuntime = 'nodejs' | 'typescript' | 'php' | 'python' | 'terraform' | 'pulumi' | 'angular';

interface ProjectDetection {
	baseDir: string;
	language: LanguageRuntime;
	files: string[];
	/** The base development branch to make new branches from */
	devBranch: string;
}

interface ProjectScripts {
	initialise: string;
	compile: string;
	format: string;
	staticAnalysis: string;
	test: string;
}

export interface ProjectInfo extends ProjectScripts {
	baseDir: string;
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
	const infoPath = path.join(getFileSystem().getWorkingDirectory(), 'projectInfo.json');
	if (existsSync(infoPath)) {
		const infos = parseProjectInfo(readFileSync(infoPath).toString());
		if (infos.length === 1) return infos[0];
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
	const fileSystem = getFileSystem();
	if (await fileSystem.fileExists('projectInfo.json')) {
		const projectInfoJson = await fileSystem.readFile('projectInfo.json');
		logger.info(`loaded projectInfo.json ${projectInfoJson}`);
		logger.info(projectInfoJson);
		// TODO check projectInfo matches the format we expect
		const info = parseProjectInfo(projectInfoJson);
		if (info !== null) return info;
	} else if (await fileSystem.fileExists(join(fileSystem.getVcsRoot(), 'projectInfo.json'))) {
		// logger.info('current dir ' + fileSystem.getWorkingDirectory());
		// logger.info('fileSystem.getVcsRoot() ' + fileSystem.getVcsRoot());
		// process.exit(1);
		// throw new Error(
		// 	'TODO handle if we are in a directory inside a repository. Look for the projectInfo.json in the repo root folder and see if any entry exists for the current folder or above ',
		// );
		logger.info('Found projectInfo.json in repository root folder');
		const projectInfoJson = await fileSystem.readFile(join(fileSystem.getVcsRoot(), 'projectInfo.json'));
		const info = parseProjectInfo(projectInfoJson);
		if (info !== null) return info;
	}

	logger.info('Detecting project info...');
	const tree = await fileSystem.getFileSystemTree();

	const prompt = `<task_requirements>
${requirements ? `<context>\n${requirements}\n</context>\n` : ''}
<task_input>
${tree}
</task_input>
You task it to detect key information (language/runtime and build/test commands) for a software project from the names of the files contained within it${
		requirements ? ' and the <context>' : ''
	}. 

For the "files" return value you will select the file names of only a few key files (documentation, project configuration, and optionally a select few entrypoint files) that will be later read and analysed to determine the commands. Do not include lock files for 3rd party code such as package-lock.json

You must respond only in JSON format matching the ProjectDetection interface in following TypeScript types:

interface ProjectDetections {
  /** The folder which contains all the project configuration files (eg. package.json for node.js, pom.xml for Java). Often the root folder ("./") but not always */
  baseDir: string;
  /** The programming language/runtime of the project */
  language: 'java' | 'nodejs' | 'csharp' | 'ruby' | 'python' | 'terraform';
  /** The files to read to determine the shell commands to compile, run lint/formating and test the code. Do not include lock files for 3rd party code such as package-lock.json */
  files: string[],
}

interface ProjectDetection {
	projects: ProjectDetections[]
}
<example>
For example, if the list of files in the repository was:
<input>
README.md
backend/.python-version
backend/requirements.txt
backend/README.md
backend/bin/compile
backend/bin/test
backend/src/index.py
backend/src/module1/module1.py
backend/src/module2/module2.py
backend/src/module3/module3.py
frontend/package.json
frontend/ts-config.json
frontend/README.md
frontend/src/index.ts
backend/src/module1/module1.ts  
backend/src/module2/module2.ts
backend/src/module3/module3.ts
</input>
Then the output would be:
<output>
{
	"projects": [{
					"baseDir": "backend",
					"language": "python",
					"files": ["README.md", "backend/bin/compile", "backend/bin/test", "backend/README.md"]
				}, {
					"baseDir": "frontend",
					"language": "nodejs",
					"files": ["README.md", "frontend/package.json", "frontend/README.md"]
				}]
}
</output>
</example>
</task_requirements>`;
	const projectDetections: ProjectDetections = await llms().medium.generateJson(prompt, { id: 'projectInfoFileSelection' });
	logger.info(projectDetections, 'Project detections');
	if (!projectDetections.projects.length) throw new Error(`Could not detect a software project within ${fileSystem.getWorkingDirectory()}`);

	// TODO handle more than one project in a repository
	if (projectDetections.projects.length > 1) throw new Error('Support for multiple projects in a repository has not been completed');

	const projectDetection = projectDetections.projects[0];
	const projectDetectionFiles = projectDetection.files.filter((filename) => !filename.includes('package-lock.json') && !filename.includes('yarn.lock'));
	const projectDetectionFileContents = await fileSystem.readFilesAsXml(projectDetectionFiles);

	const projectScripts: ProjectScripts = await llms().medium.generateJson(
		null,
		`${projectDetectionFileContents}.\n 
    Your task is to determine the shell commands to compile, lint/format, and unit test the ${projectDetection.language} project from the files provided.
    There may be multiple shell commands to chain together, eg. To lint and format the project might require "npm run prettier && npm run eslint".
    
    
Explain your reasoning, then output a Markdown JSON block, with the JSON formatted in the following example:
<example>
{
"initialise": "",
"compile": "",
"format": "",
"staticAnalysis": "",
"test": ""
}
</example>
`,
		{ id: 'detectProjectInfo' },
	);
	projectDetection.files = undefined;
	const projectInfo: ProjectInfo = {
		...projectDetection,
		...projectScripts,
		fileSelection: 'Do not include package manager lock files',
		languageTools: getLanguageTools(projectDetection.language),
		indexDocs: [],
	};
	logger.info(projectInfo, 'ProjectInfo detected');
	await getFileSystem().writeFile('projectInfo.json', JSON.stringify([projectInfo], null, 2));
	return [projectInfo];
}

function getLanguageTools(type: LanguageRuntime | ''): LanguageTools | null {
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
