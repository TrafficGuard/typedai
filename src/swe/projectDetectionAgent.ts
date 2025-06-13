import { llms } from '#agent/agentContextLocalStorage';
import { logger } from '#o11y/logger';
import { queryWorkflowWithSearch } from '#swe/discovery/selectFilesAgentWithSearch';
import { type ExecResult, execCommand } from '#utils/exec';
import { type LanguageRuntime, type ProjectInfo, type ProjectScripts, getLanguageTools } from './projectDetection';

// Structure expected from LLM. Fields are optional as LLM might not provide all.
interface DetectedProjectRaw {
	baseDir: string; // Expected to be non-empty by prompt, validated later
	language?: string;
	primary?: boolean;
	devBranch?: string;
	scripts?: Partial<ProjectScripts>;
}

// Keep a set of known LanguageRuntime values for efficient validation
const KNOWN_LANGUAGES_SET: ReadonlySet<LanguageRuntime> = new Set(['nodejs', 'typescript', 'php', 'python', 'terraform', 'pulumi', 'angular']);

function normalizeAndValidateLanguage(langStr?: string): LanguageRuntime | '' {
	if (!langStr || typeof langStr !== 'string') return '';
	const lowerLang = langStr.toLowerCase().trim();

	if (KNOWN_LANGUAGES_SET.has(lowerLang as LanguageRuntime)) {
		return lowerLang as LanguageRuntime;
	}
	// Add common aliases
	if (lowerLang === 'node' || lowerLang === 'javascript' || lowerLang === 'js') return 'nodejs';
	if (lowerLang === 'ts') return 'typescript';
	// Add other aliases if needed

	logger.warn(`Detected language "${langStr}" is not a recognized LanguageRuntime or known alias. Treating as unspecified.`);
	return '';
}

export async function projectDetectionAgent(maxRetries = 2): Promise<ProjectInfo[]> {
	// Total attempts = maxRetries + 1
	const projectDetectionQuery = `
Analyze the repository to identify all software projects. For each project, provide the following details:
1.  baseDir: The root directory of the project (e.g., "./", "backend/", "services/api/"). This should be relative to the repository root. Must be a non-empty string.
2.  language: The primary programming language or runtime. Choose from: 'nodejs', 'typescript', 'php', 'python', 'terraform', 'pulumi', 'angular', 'java', 'csharp', 'ruby', or other common ones if necessary.
3.  primary: A boolean (true/false) indicating if this is the main project in the repository. If only one project is found, it should be marked as primary.
4.  devBranch: The typical base branch for development (e.g., "main", "develop", "master"). Default to "main" if unsure.
5.  scripts: An object containing shell commands for the project:
    *   initialise: Command to set up the project or install dependencies (e.g., "npm install", "pip install -r requirements.txt").
    *   compile: Command to build or compile the project (e.g., "npm run build", "mvn compile"). Empty string if not applicable.
    *   format: Command to auto-format the code (e.g., "npm run format", "black .").
    *   staticAnalysis: Command for linting or static code analysis (e.g., "npm run lint", "flake8 .").
    *   test: Command to run unit tests (e.g., "npm test", "pytest").

Respond with ONLY a JSON array of objects, where each object represents a detected project. Example:
[
  {
    "baseDir": "backend/",
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
  }
]
If no specific command is found for a script category, provide an empty string for that script.
Ensure the 'language' field uses one of the suggested values or a common programming language identifier.
Ensure 'baseDir' is always present and a non-empty string.
If no projects are found, respond with an empty JSON array [].
`;

	let textualProjectInfos: string;
	let detectedProjectsRawList: DetectedProjectRaw[] = [];
	let attempts = 0;
	let lastError: Error | undefined;

	while (attempts <= maxRetries) {
		logger.info(`Project detection agent: Attempt ${attempts + 1} of ${maxRetries + 1}`);
		try {
			textualProjectInfos = await queryWorkflowWithSearch(projectDetectionQuery);
			logger.info({ textualProjectInfosLength: textualProjectInfos.length }, 'Raw project info string from queryWorkflowWithSearch');

			try {
				const parsedJson = JSON.parse(textualProjectInfos);
				if (Array.isArray(parsedJson)) {
					detectedProjectsRawList = parsedJson;
				} else if (parsedJson && typeof parsedJson === 'object' && Array.isArray(parsedJson.projects)) {
					detectedProjectsRawList = parsedJson.projects;
					logger.info('Parsed projects from a root object {projects: []}.');
				} else {
					throw new Error('Parsed JSON is not an array and not the expected {projects: []} structure.');
				}
				logger.info('Successfully parsed project info from direct JSON.');
				lastError = undefined;
				break;
			} catch (parseError) {
				const pErrorMsg = parseError instanceof Error ? parseError.message : String(parseError);
				logger.warn(
					{ error: pErrorMsg, textualProjectInfosPreview: textualProjectInfos.substring(0, 200) },
					'Failed to directly parse project info JSON. Attempting fallback extraction with llms().easy.',
				);
				const fallbackPrompt = `The following text is supposed to be a JSON array describing software projects.
It might be malformed or contain surrounding text. Extract the valid JSON array.
If it's already valid JSON, just return it.
If the text indicates no projects were found or is an empty array, return [].
Respond ONLY with the JSON array.

Text:
${textualProjectInfos}`;
				const result = await llms().easy.generateJson<DetectedProjectRaw[] | { projects: DetectedProjectRaw[] }>(fallbackPrompt, {
					id: 'extractProjectInfoWithSearchFallback',
				});
				if (Array.isArray(result)) {
					detectedProjectsRawList = result;
				} else if (result && typeof result === 'object' && Array.isArray((result as { projects: DetectedProjectRaw[] }).projects)) {
					detectedProjectsRawList = (result as { projects: DetectedProjectRaw[] }).projects;
					logger.info('Fallback LLM extracted projects from a root object.');
				} else {
					throw new Error('Fallback LLM extraction did not yield a valid project array or expected object structure.');
				}
				lastError = undefined;
				break;
			}
		} catch (error) {
			lastError = error as Error;
			logger.warn(`Attempt ${attempts + 1} for projectDetectionAgent failed: ${lastError.message}`);
			attempts++;
			if (attempts > maxRetries) {
				logger.error({ error: lastError.message, attempts }, 'Max retries reached for projectDetectionAgent. Failing.');
				throw new Error(`Project detection agent failed after ${maxRetries + 1} attempts: ${lastError.message}`);
			}
			// Optional: await new Promise(resolve => setTimeout(resolve, 500 * attempts));
		}
	}

	if (!Array.isArray(detectedProjectsRawList)) {
		logger.error(
			{ detectedProjectsRawList, lastError: lastError?.message },
			'Detected projects data is not an array after all attempts. Returning empty array.',
		);
		return [];
	}

	if (detectedProjectsRawList.length === 0) {
		logger.info('No software projects detected by the agent or extracted list was empty.');
		return [];
	}

	const projectInfos: ProjectInfo[] = detectedProjectsRawList
		.map((raw, index): ProjectInfo | null => {
			if (!raw || typeof raw !== 'object') {
				logger.warn({ projectIndex: index, projectRaw: raw }, 'Detected project entry is not a valid object. Skipping.');
				return null;
			}
			if (!raw.baseDir || typeof raw.baseDir !== 'string' || raw.baseDir.trim() === '') {
				logger.warn({ projectIndex: index, projectRaw: raw }, 'Detected project is missing a valid "baseDir" property. Skipping.');
				return null;
			}

			const language = normalizeAndValidateLanguage(raw.language);
			const scripts = raw.scripts || {};

			return {
				baseDir: raw.baseDir.trim(),
				language: language,
				primary: typeof raw.primary === 'boolean' ? raw.primary : false,
				devBranch: typeof raw.devBranch === 'string' && raw.devBranch.trim() !== '' ? raw.devBranch.trim() : 'main',
				initialise: typeof scripts.initialise === 'string' ? scripts.initialise : '',
				compile: typeof scripts.compile === 'string' ? scripts.compile : '',
				format: typeof scripts.format === 'string' ? scripts.format : '',
				staticAnalysis: typeof scripts.staticAnalysis === 'string' ? scripts.staticAnalysis : '',
				test: typeof scripts.test === 'string' ? scripts.test : '',
				languageTools: getLanguageTools(language),
				fileSelection: 'Do not include package manager lock files',
				indexDocs: [], // Default, can be populated by other means if necessary
			};
		})
		.filter((p): p is ProjectInfo => p !== null);

	if (projectInfos.length === 0 && detectedProjectsRawList.length > 0) {
		logger.warn(
			{ detectedProjectsRawListCount: detectedProjectsRawList.length },
			'No valid projects remained after filtering raw detected projects. All raw entries might have had issues.',
		);
	}

	logger.info({ projectInfosCount: projectInfos.length }, 'Detected and processed project infos using projectDetectionAgent.');
	return projectInfos;
}

// verifyProjectScripts function remains unchanged from your original code
interface ScriptVerificationResult {
	projectPath: string;
	command: string;
	executed: boolean;
	exitCode?: number;
	success?: boolean;
	stdout?: string;
	stderr?: string;
	llmAnalysis?: TestFailureAnalysis;
	executionError?: string;
}

interface TestFailureAnalysis {
	failure_type: 'bad_command' | 'test_failure' | 'environment_issue' | 'unknown';
	reasoning: string;
	suggested_command_fix?: string;
}

async function verifyProjectScripts(projectInfos: ProjectInfo[]): Promise<ScriptVerificationResult[]> {
	const verificationResults: ScriptVerificationResult[] = [];
	for (const projectInfo of projectInfos) {
		const baseResult: ScriptVerificationResult = {
			projectPath: projectInfo.baseDir,
			command: projectInfo.test || '',
			executed: false,
		};

		if (!projectInfo.test || projectInfo.test.trim() === '') {
			logger.info({ projectPath: projectInfo.baseDir }, 'No test script defined for project, skipping validation.');
			verificationResults.push(baseResult);
			continue;
		}

		logger.info({ projectPath: projectInfo.baseDir, command: projectInfo.test }, 'Attempting to validate test script');
		baseResult.executed = true;
		baseResult.command = projectInfo.test;

		try {
			const execResult: ExecResult = await execCommand(projectInfo.test, { workingDirectory: projectInfo.baseDir });
			baseResult.exitCode = execResult.exitCode;
			baseResult.success = execResult.exitCode === 0;
			baseResult.stdout = execResult.stdout;
			baseResult.stderr = execResult.stderr;

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
						stdout: execResult.stdout.substring(0, 500), // Limit log size
						stderr: execResult.stderr.substring(0, 500), // Limit log size
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

				try {
					const llmAnalysis = await llms().easy.generateJson<TestFailureAnalysis>(analysisPrompt, { id: 'analyzeTestScriptFailure' });
					baseResult.llmAnalysis = llmAnalysis;
					logger.info({ projectPath: projectInfo.baseDir, command: projectInfo.test, analysis: llmAnalysis }, 'LLM analysis of test script failure complete.');
				} catch (llmError) {
					const llmErrorMsg = llmError instanceof Error ? llmError.message : String(llmError);
					logger.error(
						{ projectPath: projectInfo.baseDir, command: projectInfo.test, error: llmErrorMsg },
						'LLM analysis of test script failure encountered an error.',
					);
				}
			} else {
				logger.info({ projectPath: projectInfo.baseDir, command: projectInfo.test }, 'Test script executed successfully during validation (exit code 0).');
			}
			verificationResults.push(baseResult);
		} catch (executionError) {
			const execErrorMsg = executionError instanceof Error ? executionError.message : String(executionError);
			logger.error(
				{ projectPath: projectInfo.baseDir, command: projectInfo.test, error: execErrorMsg },
				'Failed to execute test script command itself during validation.',
			);
			baseResult.success = false;
			baseResult.executionError = execErrorMsg;
			verificationResults.push(baseResult);
		}
	}
	return verificationResults;
}
