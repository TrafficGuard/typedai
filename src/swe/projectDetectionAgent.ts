import { llms } from '#agent/agentContextLocalStorage';
import { logger } from '#o11y/logger';
import { queryWorkflowWithSearch } from '#swe/discovery/selectFilesAgentWithSearch';
import { type LanguageRuntime, type ProjectInfo, type ProjectScripts, getLanguageTools } from '#swe/projectDetection';
import { type ExecResult, execCommand } from '#utils/exec';

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

interface DetectedProjectRaw {
	baseDir: string;
	language: LanguageRuntime | string; // Allow string initially, then validate/cast
	primary: boolean;
	devBranch: string;
	scripts: ProjectScripts;
}

export async function projectDetectionAgent(): Promise<ProjectInfo[]> {
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

async function testScripts(projectInfos: ProjectInfo[]): Promise<void> {
	for (const projectInfo of projectInfos) {
		if (projectInfo.test && projectInfo.test.trim() !== '') {
			logger.info({ projectPath: projectInfo.baseDir, command: projectInfo.test }, 'Attempting to validate test script');
			try {
				const execResult: ExecResult = await execCommand(projectInfo.test, { workingDirectory: projectInfo.baseDir });
				logger.info(
					{ projectPath: projectInfo.baseDir, command: projectInfo.test, exitCode: execResult.exitCode },
					'Test script execution completed for validation.',
				);

				if (execResult.exitCode !== 0) {
					logger.warn(
						{
							projectPath: projectInfo.baseDir,
							command: projectInfo.test,
							exitCode: execResult.exitCode,
							stdout: execResult.stdout,
							stderr: execResult.stderr,
						},
						'Test script failed during validation.',
					);

					const analysisPrompt = `
                   A test script execution failed for a project located at '${projectInfo.baseDir}'.
                   The command executed was: '${projectInfo.test}'
                   Exit Code: ${execResult.exitCode}
                   Stdout:
                   ---
                   ${execResult.stdout.substring(0, 1000)}
                   ---
                   Stderr:
                   ---
                   ${execResult.stderr.substring(0, 1000)}
                   ---
                   Analyze the command, exit code, stdout, and stderr to determine the primary reason for failure.
                   Possible reasons:
                   1. 'bad_command': The command itself is incorrect (e.g., typo, wrong tool, invalid arguments).
                   2. 'test_failure': The command is correct for running tests, but the project's tests are genuinely failing.
                   3. 'environment_issue': A problem with the environment (e.g., missing dependencies not installed by 'initialise' script, incorrect versions).
                   4. 'unknown': The cause is unclear from the provided information.

                   Respond ONLY with a JSON object with the following structure:
                   {
                     "failure_type": "bad_command" | "test_failure" | "environment_issue" | "unknown",
                     "reasoning": "A brief explanation for your conclusion.",
                     "suggested_command_fix": "string (Provide a corrected command if failure_type is 'bad_command' and a fix is obvious. Otherwise, an empty string.)"
                   }
                   Focus on the most likely cause. Keep reasoning concise.
                   `;

					interface TestFailureAnalysis {
						failure_type: 'bad_command' | 'test_failure' | 'environment_issue' | 'unknown';
						reasoning: string;
						suggested_command_fix?: string;
					}

					try {
						const llmAnalysis = await llms().easy.generateJson<TestFailureAnalysis>(analysisPrompt, { id: 'analyzeTestScriptFailure' });
						logger.info(
							{ projectPath: projectInfo.baseDir, command: projectInfo.test, analysis: llmAnalysis },
							'LLM analysis of test script failure complete.',
						);
						// Further actions based on llmAnalysis (e.g., logging specific insights) can be added here.
						// For now, the analysis itself is logged.
					} catch (llmError) {
						logger.error(
							{ projectPath: projectInfo.baseDir, command: projectInfo.test, error: (llmError as Error).message },
							'LLM analysis of test script failure encountered an error.',
						);
					}
				} else {
					logger.info({ projectPath: projectInfo.baseDir, command: projectInfo.test }, 'Test script executed successfully during validation (exit code 0).');
				}
			} catch (executionError) {
				logger.error(
					{ projectPath: projectInfo.baseDir, command: projectInfo.test, error: (executionError as Error).message },
					'Failed to execute test script command itself during validation.',
				);
			}
		} else {
			logger.info({ projectPath: projectInfo.baseDir }, 'No test script defined for project, skipping validation.');
		}
	}
}
