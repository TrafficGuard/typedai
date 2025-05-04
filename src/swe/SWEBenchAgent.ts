import { getFileSystem } from '#agent/agentContextLocalStorage';
import { runAgentWorkflow } from '#agent/workflow/workflowAgentRunner';
import { GitHub } from '#functions/scm/github';
import { ClaudeVertexLLMs } from '#llm/services/anthropic-vertex';
import { defaultLLMs } from '#llm/services/defaultLlms';
import { countTokens } from '#llm/tokens';
import { logger } from '#o11y/logger';
import { CodeEditingAgent } from '#swe/codeEditingAgent';
import { selectFilesToEdit } from '#swe/discovery/selectFilesToEdit';
import { PythonTools } from '#swe/lang/python/pythonTools';
import type { ProjectInfo } from '#swe/projectDetection';
import { MAP_REPO_TO_TEST_FRAMEWORK, MAP_VERSION_TO_INSTALL, type VersionInstallation } from '#swe/sweBenchConstant';
import { execCommand } from '#utils/exec';

export interface SWEInstance {
	instance_id: string;
	// text: string;
	repo: string;
	base_commit: string;
	problem_statement: string;
	hints_text: string;
	created_at: string;
	patch: string;
	test_patch: string;
	version: string;
	FAIL_TO_PASS: string;
	PASS_TO_PASS: string;
	environment_setup_commit: string;
}

interface EditRequirements {
	problemStatement: string;
	readmeContents: string;
	relevantFileContents: string;
}

interface TestResult {
	passed: boolean;
	output: string;
}

/**
 * Workflow for completing requirements. This will look up the appropriate project in source control, clone, make the changes and create a pull/merge request.
 * Assumes the SCM is set on the workflow context
 */
// @funcClass(__filename)
export class SWEBenchAgent {
	private readonly MAX_CONTEXT_LENGTH = 16000;
	private readonly PROMPT_STYLE = 'style-3';
	private readonly MAX_ATTEMPTS = 1; // 6
	// private readonly MODELS = ['gpt-4o', 'openrouter/anthropic/claude-3-opus'];

	// @func()
	async runInference(task: SWEInstance): Promise<string> {
		let bestResult: any = null;

		for (let attempt = 0; attempt < this.MAX_ATTEMPTS; attempt++) {
			const result = await this.attemptSolution(task);

			if (result.isPlausible) {
				return JSON.stringify(result);
			}

			if (!bestResult || this.isBetterResult(result, bestResult)) {
				bestResult = result;
			}
		}

		return JSON.stringify(bestResult);
	}

	private async attemptSolution(task: SWEInstance): Promise<any> {
		return await runAgentWorkflow(
			{
				agentName: `swe-bench ${task.instance_id}`,
				subtype: 'swe-bench',
				llms: defaultLLMs(),
				humanInLoop: {
					budget: 2,
				},
				initialPrompt: '',
			},
			async (agent) => {
				// Setup
				const repo = task.repo;
				logger.info(`Cloning ${repo}`);
				const path = await new GitHub().cloneProject(repo, task.base_commit);
				getFileSystem().setWorkingDirectory(path);

				// Environment setup
				logger.info('Environment setup');
				await this.setupEnvironment(task);

				// Get README files
				logger.info('Get README files');
				const readmeFiles = await this.getReadmeFiles();

				// Get relevant file contents
				const relevantFiles = await this.getRelevantFiles(task.problem_statement, task.repo);

				// Prepare edit requirements
				const editRequirements = await this.prepareEditRequirements(task, readmeFiles, relevantFiles);

				const codeEditingAgent = new CodeEditingAgent();

				let success = false;
				try {
					await codeEditingAgent.implementUserRequirements(editRequirements);
					success = true;
				} catch (e) {
					logger.error(e);
				}

				const modelPatch = await this.generatePatch(task.base_commit);

				// Extract minimal patch
				const minimalPatch = this.extractMinimalPatch(modelPatch);

				// Run tests
				const testResults = await this.runTests(task);

				// Prepare output
				const output = {
					instance_id: task.instance_id,
					response: modelPatch,
					problem_statement: task.problem_statement,
					text_inputs: editRequirements,
					model_patch: modelPatch,
					minimal_patch: minimalPatch,
					test_results: testResults,
					model: 'Claude',

					isPlausible: success && testResults.passed,
					editOutcome: success,
					testOutcome: testResults.passed,
				};

				return output;
			},
		);
	}

	private isBetterResult(result: any, bestResult: any): boolean {
		const score = (r: any) => (r.editOutcome ? 1 : 0) + (r.lintOutcome ? 1 : 0) + (r.testOutcome ? 1 : 0);
		return score(result) > score(bestResult);
	}

	private async setupEnvironment(task: SWEInstance): Promise<void> {
		const installInstructions: VersionInstallation = this.getInstallInstructions(task.repo, task.version);
		const envName = task.repo.split('/')[1];

		logger.info('Install instructions');
		logger.info(installInstructions);

		await execCommand(`echo '${installInstructions.python}' > .python-version`, { throwOnError: true });
		const pv = await execCommand('python --version');
		logger.info(pv.stdout);

		// Run pre-install commands
		if (installInstructions.pre_install) {
			for (const cmd of installInstructions.pre_install) {
				await execCommand(cmd);
			}
		}

		// Install packages
		if (installInstructions.packages) {
			if (installInstructions.packages === 'requirements.txt') {
				const reqContent = await this.getRequirements(task);
				await execCommand(`echo '${reqContent}' > requirements.txt && pip install -r requirements.txt`, { throwOnError: true });
			} else if (installInstructions.packages === 'environment.yml') {
				const envContent = await this.getEnvironmentYml(task);
				await execCommand(`echo '${envContent}' > environment.yml && conda env update -f environment.yml`, { throwOnError: true });
			} else {
				await execCommand(`conda install -y ${installInstructions.packages}`, { throwOnError: true });
			}
		}

		// Install additional pip packages
		const pipPackages = installInstructions.pip_packages?.join(' ') ?? '';
		await execCommand(`pip install aider ${pipPackages}`);

		// Run install command
		await execCommand(installInstructions.install);
	}

	private getInstallInstructions(repo: string, version: string): VersionInstallation {
		if (MAP_VERSION_TO_INSTALL[repo]?.[version]) {
			return MAP_VERSION_TO_INSTALL[repo][version];
		}

		// Default value if not found in the mapping
		return {
			python: '3.9',
			packages: 'requirements.txt',
			install: 'pip install -e .',
		};
	}

	private async getRequirements(task: SWEInstance): Promise<string> {
		const fs = getFileSystem();
		let requirements = '';

		// Check for requirements.txt
		try {
			requirements = await fs.readFile('requirements.txt');
		} catch (error) {
			logger.warn('requirements.txt not found');
		}

		// Check for setup.py
		if (!requirements) {
			try {
				const setupPy = await fs.readFile('setup.py');
				logger.info('setup.py found');
				const installRequiresMatch = setupPy.match(/install_requires\s*=\s*\[([\s\S]*?)\]/);
				if (installRequiresMatch) {
					requirements = installRequiresMatch[1]
						.split(',')
						.map((req) => req.trim().replace(/['"]/g, ''))
						.join('\n');
				}
			} catch (error) {
				logger.warn('setup.py not found or does not contain install_requires');
			}
		}

		// Check for pyproject.toml
		if (!requirements) {
			try {
				const pyprojectToml = await fs.readFile('pyproject.toml');
				logger.info('pyproject.toml found');
				const dependenciesMatch = pyprojectToml.match(/\[tool\.poetry\.dependencies\]([\s\S]*?)(\[|$)/);
				if (dependenciesMatch) {
					requirements = dependenciesMatch[1]
						.split('\n')
						.filter((line) => line.includes('='))
						.map((line) => line.split('=')[0].trim())
						.join('\n');
				}
			} catch (error) {
				logger.warn('pyproject.toml not found or does not contain dependencies');
			}
		}

		return requirements;
	}

	private async getEnvironmentYml(task: SWEInstance): Promise<string> {
		const fs = getFileSystem();
		let envYml = '';

		// Try to read environment.yml
		try {
			envYml = await fs.readFile('environment.yml');
		} catch (error) {
			logger.warn('environment.yml not found');
		}

		// If environment.yml doesn't exist, create one based on the installation instructions
		if (!envYml) {
			const installInstructions = this.getInstallInstructions(task.repo, task.version);
			envYml = 'name: swe-bench\n';
			envYml += 'channels:\n  - defaults\n  - conda-forge\n';
			envYml += `dependencies:\n  - python=${installInstructions.python}\n`;

			if (installInstructions.packages) {
				const packages = installInstructions.packages.split(' ');
				for (const pkg of packages) {
					if (pkg !== 'python') {
						envYml += `  - ${pkg}\n`;
					}
				}
			}

			if (installInstructions.pip_packages) {
				envYml += '  - pip\n  - pip:\n';
				for (const pkg of installInstructions.pip_packages) {
					envYml += `    - ${pkg}\n`;
				}
			}
		}

		return envYml;
	}

	private async getReadmeFiles(): Promise<string[]> {
		const files = await getFileSystem().listFilesRecursively();
		return files.filter((file) => file.toLowerCase().startsWith('readme'));
	}

	private async getRelevantFiles(problemStatement: string, repo: string): Promise<string[]> {
		const pythonProjectInfo: Partial<ProjectInfo> = {
			languageTools: new PythonTools(),
			language: 'python',
		};
		const files = await selectFilesToEdit(problemStatement, pythonProjectInfo as ProjectInfo);
		return [...files.primaryFiles.map((sf) => sf.path), ...files.secondaryFiles.map((sf) => sf.path)];
	}

	private async prepareEditRequirements(task: SWEInstance, readmeFiles: string[], relevantFiles: string[]): Promise<string> {
		let requirements = this.formatPrompt(task.problem_statement, this.PROMPT_STYLE);

		requirements += 'README contents:\n';
		for (const file of readmeFiles) {
			const content = await getFileSystem().readFile(file);
			requirements += `${file}:\n${content}\n\n`;
		}

		requirements += 'Relevant file contents:\n';
		let totalTokens = await countTokens(requirements);
		for (const file of relevantFiles) {
			const content = await getFileSystem().readFile(file);
			const fileContent = `${file}:\n${content}\n\n`;
			const fileTokens = await countTokens(fileContent);
			if (totalTokens + fileTokens <= this.MAX_CONTEXT_LENGTH) {
				requirements += fileContent;
				totalTokens += fileTokens;
			} else {
				break;
			}
		}

		return requirements;
	}

	private formatPrompt(problemStatement: string, style: string): string {
		switch (style) {
			case 'style-1':
				return `Fix this issue:\n\n${problemStatement}\n\nPropose changes.`;
			case 'style-2':
				return `Problem statement: ${problemStatement}\n\nPlease provide a patch to resolve this issue.`;
			default:
				return `Below is a real GitHub issue from a popular GitHub repository.
The issue was filed some time ago.
The repo has been checked out at the commit that existed at the moment the issue was filed.
If you are already familiar with this repo, be cautious!
You are working with an old version of the repo!
Filenames, directory names, file contents, etc may be different than what you're used to.

Propose changes to update the repo to fix the problem below.

${problemStatement}`;
		}
	}

	private extractMinimalPatch(modelPatch: string): string {
		const lines = modelPatch.split('\n');
		const minimalPatchLines: string[] = [];
		let inHunk = false;
		let hunkHeader = '';

		for (const line of lines) {
			if (line.startsWith('diff --git') || line.startsWith('index ') || line.startsWith('---') || line.startsWith('+++')) {
				minimalPatchLines.push(line);
			} else if (line.startsWith('@@')) {
				inHunk = true;
				hunkHeader = line;
				minimalPatchLines.push(line);
			} else if (inHunk) {
				if (line.startsWith('+') || line.startsWith('-')) {
					minimalPatchLines.push(line);
				} else if (line.trim() === '') {
					// Keep empty lines within hunks
					minimalPatchLines.push(line);
				} else {
					// End of the current hunk
					inHunk = false;
					if (minimalPatchLines[minimalPatchLines.length - 1] !== hunkHeader) {
						minimalPatchLines.push(''); // Add an empty line between hunks
					}
				}
			}
		}

		return minimalPatchLines.join('\n');
	}

	private async runTests(task: SWEInstance): Promise<TestResult> {
		const testFramework = this.getTestFramework(task.repo);
		const failToPass = JSON.parse(task.FAIL_TO_PASS);
		const passToPass = JSON.parse(task.PASS_TO_PASS);
		const envName = task.repo.split('/')[1];

		let results = '';
		let allPassed = true;

		for (const test of failToPass) {
			const result = await execCommand(`${testFramework} ${test}`);
			const passed = result.exitCode === 0;
			results += `FAIL_TO_PASS ${test}: ${passed ? 'PASS' : 'FAIL'}\n`;
			allPassed = allPassed && passed;
		}

		for (const test of passToPass) {
			const result = await execCommand(`${testFramework} ${test}`);
			const passed = result.exitCode === 0;
			results += `PASS_TO_PASS ${test}: ${passed ? 'PASS' : 'FAIL'}\n`;
			allPassed = allPassed && passed;
		}

		return { passed: allPassed, output: results };
	}

	private getTestFramework(repo: string): string {
		let testFramework = MAP_REPO_TO_TEST_FRAMEWORK[repo];
		if (!testFramework) {
			logger.warn(`No test framework configured for ${repo}`);
			testFramework = 'pytest --no-header -rA --tb=no -p no:cacheprovider';
		}
		return testFramework;
	}

	private async generatePatch(baseCommit: string): Promise<string> {
		const result = await execCommand(`git diff ${baseCommit} HEAD`);
		return result.stdout;
	}
}
