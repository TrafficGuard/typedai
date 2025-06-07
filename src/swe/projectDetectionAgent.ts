import {getFileSystem, llms} from "#agent/agentContextLocalStorage";
import {logger} from "#o11y/logger";
import {getLanguageTools, LanguageRuntime, ProjectInfo, ProjectScripts} from "#swe/projectDetection";

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