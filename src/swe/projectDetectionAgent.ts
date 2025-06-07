import {getFileSystem, llms} from "#agent/agentContextLocalStorage";
import {logger} from "#o11y/logger";
import {getLanguageTools, LanguageRuntime, ProjectInfo, ProjectScripts} from "#swe/projectDetection";
import { queryWorkflowWithSearch } from '../discovery/selectFilesAgentWithSearch';

interface ProjectDetection {
    baseDir: string;
    language: LanguageRuntime;
    primary: boolean;
    files: string[];
    /** The base development branch to make new branches from */
    devBranch: string;
}

interface ProjectDetections {
    projects: ProjectDetection[];
}

export async function projectDetectionAgent(requirements?: string) {
    const fss = getFileSystem();
    const tree = await fss.getFileSystemTree();

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
  language: 'java' | 'nodejs' | 'csharp' | 'ruby' | 'python' | 'terraform'; // etc
  /** If this project is the primary project in the repository */
  primary: boolean;
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

<example>
For example, if the list of files in the repository was:
<input>
README.md
setup.py
requirements.txt
pytest.ini
Dockerfile
CONTRIBUTING.md
benchmark/README.md
benchmark/Dockerfile
benchmark/docker.sh
benchmark/test_benchmark.py
benchmark/test_utils.py
src/main.py
src/commands.py
src/utils.py
src/models.py
</input>
Then the output would be:
<output>
{
	"projects": [{
		"baseDir": "./",
		"language": "python",
		"primary": true,
		"files": ["README.md", "setup.py", "pytest.ini", "sec/main.py"]
	}, {
		"baseDir": "./benchmark",
		"language": "python",
		"files": ["benchmark/README.md", "benchmark/docker.sh", "benchmark/Dockerfile"]
	}]
}
</output>
</example>

</task_requirements>`;
    const projectDetections: ProjectDetections = await llms().medium.generateJson(prompt, {id: 'projectInfoFileSelection'});
    logger.info(projectDetections, 'Project detections');
    if (!projectDetections.projects.length) throw new Error(`Could not detect a software project within ${fss.getWorkingDirectory()}`);

    // TODO handle more than one project in a repository
    if (projectDetections.projects.length > 1 && !projectDetections.projects.some((project) => project.primary))
        throw new Error('Support for multiple projects without a primary project in a repository has not been completed');

    const projectDetection = projectDetections.projects[0];
    const projectDetectionFiles = projectDetection.files.filter((filename) => !filename.includes('package-lock.json') && !filename.includes('yarn.lock'));
    const projectDetectionFileContents = await fss.readFilesAsXml(projectDetectionFiles);

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
        {id: 'detectProjectInfo'},
    );
    projectDetection.files = undefined;
    const projectInfo: ProjectInfo = {
        ...projectDetection,
        ...projectScripts,
        fileSelection: 'Do not include package manager lock files',
        languageTools: getLanguageTools(projectDetection.language),
        indexDocs: [],
    };
    return projectInfo;
}

interface DetectedProjectRaw {
	baseDir: string;
	language: LanguageRuntime | string; // Allow string initially, then validate/cast
	primary: boolean;
	devBranch: string;
	scripts: ProjectScripts;
}

export async function projectDetectionAgentWithSearch(requirements?: string): Promise<ProjectInfo[]> {
	const projectDetectionQuery = `
Analyze the repository to identify all software projects. For each project, provide the following details:
1.  baseDir: The root directory of the project (e.g., "./", "backend/", "services/api/"). This should be relative to the repository root.
2.  language: The primary programming language or runtime. Choose from: 'nodejs', 'typescript', 'php', 'python', 'terraform', 'pulumi', 'angular', 'java', 'csharp', 'ruby', or other common ones if necessary.
3.  primary: A boolean (true/false) indicating if this is the main project in the repository. If only one project is found, it should be marked as primary.
4.  devBranch: The typical base branch for development (e.g., "main", "develop", "master").
5.  scripts: An object containing shell commands for the project:
    *   initialise: Command to set up the project or install dependencies (e.g., "npm install", "pip install -r requirements.txt").
    *   compile: Command to build or compile the project (e.g., "npm run build", "mvn compile"). Empty string if not applicable.
    *   format: Command to auto-format the code (e.g., "npm run format", "black .").
    *   staticAnalysis: Command for linting or static code analysis (e.g., "npm run lint", "flake8 .").
    *   test: Command to run unit tests (e.g., "npm test", "pytest").

${requirements ? `Consider the following context or task requirements when identifying projects and their details:\n${requirements}\n` : ''}

Respond with ONLY a JSON array of objects, where each object represents a detected project. Example:
[
  {
    "baseDir": "backend",
    "language": "python",
    "primary": true,
    "devBranch": "main",
    "scripts": {
      "initialise": "pip install -r requirements.txt",
      "compile": "",
      "format": "black .",
      "staticAnalysis": "flake8 .",
      "test": "pytest"
    }
  },
  {
    "baseDir": "frontend",
    "language": "typescript",
    "primary": false,
    "devBranch": "develop",
    "scripts": {
      "initialise": "npm install",
      "compile": "npm run build",
      "format": "npm run format",
      "staticAnalysis": "npm run lint",
      "test": "npm test"
    }
  }
]
If no specific command is found for a script category, provide an empty string for that script.
Ensure the 'language' field uses one of the suggested values or a common programming language identifier.
`;

	const textualProjectInfos = await queryWorkflowWithSearch(projectDetectionQuery);
	logger.info({ textualProjectInfos }, 'Raw project info string from queryWorkflowWithSearch');

	let detectedProjectsRaw: DetectedProjectRaw[];

	try {
		// queryWorkflowWithSearch should return the content of the <result> tag,
		// which our prompt has asked to be a JSON array.
		detectedProjectsRaw = JSON.parse(textualProjectInfos);
	} catch (error) {
		logger.warn(
			{ error, textualProjectInfos },
			'Failed to directly parse project info JSON from queryWorkflowWithSearch. Attempting fallback extraction with llms().easy.',
		);
		const fallbackPrompt = `The following text is supposed to be a JSON array describing software projects.
It might be malformed or contain surrounding text. Extract the valid JSON array.
If it's already valid JSON, just return it.
Respond ONLY with the JSON array.

Text:
${textualProjectInfos}`;
		try {
			// Allow for the LLM to sometimes wrap the array in a root object like {"projects": []}
			const result = await llms().easy.generateJson<DetectedProjectRaw[] | { projects: DetectedProjectRaw[] }>(fallbackPrompt, {
				id: 'extractProjectInfoWithSearchFallback',
			});
			if (Array.isArray(result)) {
				detectedProjectsRaw = result;
			} else if (result && Array.isArray(result.projects)) {
				detectedProjectsRaw = result.projects;
				logger.info('Fallback LLM extracted projects from a root object.');
			} else {
				throw new Error('Fallback LLM extraction did not yield a valid project array or expected object structure.');
			}
		} catch (fallbackError) {
			logger.error({ fallbackError, originalError: (error as Error).message }, 'Fallback LLM extraction also failed.');
			throw new Error(
				`Failed to obtain valid project information. Original parsing error: ${(error as Error).message}. Fallback error: ${(fallbackError as Error).message}`,
			);
		}
	}

	if (!detectedProjectsRaw || !Array.isArray(detectedProjectsRaw) || detectedProjectsRaw.length === 0) {
		logger.warn({ detectedProjectsRaw }, 'No software projects detected or extracted by the search-based agent.');
		// Depending on desired behavior, could throw an error or return empty array.
		// Let's align with existing agent and throw if nothing found.
		throw new Error('Could not detect any software projects using search-based agent.');
	}

	const projectInfos: ProjectInfo[] = detectedProjectsRaw.map((raw) => {
		const language = raw.language as LanguageRuntime; // Cast, assuming LLM provided a compatible or known string
		return {
			baseDir: raw.baseDir,
			language: language, // This might be a string not strictly in LanguageRuntime, getLanguageTools handles null
			primary: raw.primary,
			devBranch: raw.devBranch,
			...raw.scripts, // Spreads initialise, compile, format, staticAnalysis, test
			languageTools: getLanguageTools(language),
			fileSelection: 'Do not include package manager lock files', // Default value
			indexDocs: [], // Default value
		};
	});

	logger.info({ projectInfos }, 'Detected project infos using projectDetectionAgentWithSearch');
	return projectInfos;
}
