import { agentContext, getFileSystem, llms } from '#agent/agentContextLocalStorage';
import { forceStopErrorCheck } from '#agent/forceStopAgent';
import { appContext } from '#app/applicationContext';
import { cacheRetry } from '#cache/cacheRetry';
import { func, funcClass } from '#functionSchema/functionDecorators';
import { Perplexity } from '#functions/web/perplexity';
import { countTokens } from '#llm/tokens';
import { logger } from '#o11y/logger';
import { span } from '#o11y/trace';
import type { IFileSystemService } from '#shared/files/fileSystemService';
import type { SelectedFile } from '#shared/files/files.model';
import { type CompileErrorAnalysis, type CompileErrorAnalysisDetails, analyzeCompileErrors } from '#swe/analyzeCompileErrors';
import { SearchReplaceCoder } from '#swe/coder/searchReplaceCoder';
import { selectFilesAgent } from '#swe/discovery/selectFilesAgentWithSearch';
import { includeAlternativeAiToolFiles } from '#swe/includeAlternativeAiToolFiles';
import { getRepositoryOverview } from '#swe/index/repoIndexDocBuilder';
import { onlineResearch } from '#swe/onlineResearch';
import { reviewChanges } from '#swe/reviewChanges';
import { supportingInformation } from '#swe/supportingInformation';
import { execCommand } from '#utils/exec';
import { AiderCodeEditor } from './aiderCodeEditor';
import { type SelectFilesResponse, selectFilesToEdit } from './discovery/selectFilesToEdit';
import { type ProjectInfo, getProjectInfo } from './projectDetection';
import { basePrompt } from './prompt';
import { summariseRequirements } from './summariseRequirements';
import { CoderExhaustedAttemptsError, CompilationError } from './sweErrors';
import { tidyDiff } from './tidyDiff';

export function buildPrompt(args: {
	information: string;
	requirements: string;
	action: string;
}): string {
	return `${basePrompt}\n${args.information}\n\nThe requirements of the task are as follows:\n<requirements>\n${args.requirements}\n</requirements>\n\nThe action to be performed is as follows:\n<action>\n${args.action}\n</action>\n`;
}

const useAider = false;

@funcClass(__filename)
export class CodeEditingAgent {
	/**
	 * Runs a workflow which 1) Finds the relevant files and generates and implementation plan. 2) Edits the files to implement the plan and commits changes to version control.
	 * It also compiles, formats, lints, and runs tests where applicable.
	 * @param requirements The requirements of the task to make the code changes for.
	 */
	// @func()
	async implementUserRequirements(
		requirements: string,
		altOptions?: { projectInfo?: ProjectInfo; workingDirectory?: string }, // altOptions are for programmatic use and not exposed to the autonomous agents.
	): Promise<void> {
		if (!requirements) throw new Error('The argument "requirements" must be provided');

		let projectInfo: ProjectInfo = altOptions?.projectInfo;
		projectInfo ??= await getProjectInfo();

		const fss: IFileSystemService = getFileSystem();
		if (altOptions?.workingDirectory) fss.setWorkingDirectory(altOptions.workingDirectory);
		fss.setWorkingDirectory(projectInfo.baseDir);

		const selectFiles = await this.selectFiles(requirements, projectInfo);
		const fileSelection = selectFiles.map((sf) => sf.filePath);
		const fileContents = await fss.readFilesAsXml(fileSelection);
		logger.info(fileSelection, `Initial selected file count: ${fileSelection.length}. Tokens: ${await countTokens(fileContents)}`);

		const repositoryOverview: string = await getRepositoryOverview();
		const installedPackages: string = await projectInfo.languageTools.getInstalledPackages();

		const implementationDetailsPrompt = `${repositoryOverview}\n${installedPackages}\n${fileContents}
		<requirements>${requirements}</requirements>
		You are a senior software engineer. Your task is to review the provided user requirements against the code provided and produce a detailed, comprehensive implementation design specification to give to a developer to implement the changes in the provided files.
		Do not provide any details of verification commands etc as the CI/CD build will run integration tests. Only detail the changes required to the files for the pull request.
		Check if any of the requirements have already been correctly implemented in the code as to not duplicate work.
		Look at the existing style of the code when producing the requirements.
		Only make changes directly related to the requirements. Any other changes will be deleted.
		`;
		const implementationPlan = await llms().hard.generateText(implementationDetailsPrompt, { id: 'CodeEditingAgent Implementation Plan' });

		await this.implementDetailedDesignPlan(implementationPlan, fileSelection, requirements, altOptions);
	}

	/**
	 * Edits the files to implement the plan and commits changes to version control
	 * It also compiles, formats, lints, and runs tests where applicable.
	 * @param implementationPlan The detailed implementation plan to make the changes for. Include any git branch and commit naming conventions to follow
	 * @param fileSelection {string[]} An array of files which the code editing agent will have access to.
	 */
	@func()
	async implementDetailedDesignPlan(
		implementationPlan: string,
		fileSelection: string[],
		requirements?: string | null, // The original requirements for when called from runCodeEditWorkflow
		altOptions?: { projectInfo?: ProjectInfo; workingDirectory?: string }, // altOptions are for programmatic use and not exposed to the autonomous agents.
	): Promise<void> {
		if (!implementationPlan) throw new Error('The argument "implementationPlan" must be provided');
		if (fileSelection && !Array.isArray(fileSelection)) {
			logger.error(`File selection was type ${typeof fileSelection}. Value: ${JSON.stringify(fileSelection)}`);
			throw new Error(`If fileSelection is provided it must be an array. Was type ${typeof fileSelection}`);
		}
		let projectInfo: ProjectInfo = altOptions?.projectInfo;
		projectInfo ??= await getProjectInfo();

		const fss: IFileSystemService = getFileSystem();
		if (altOptions?.workingDirectory) fss.setWorkingDirectory(altOptions.workingDirectory);
		fss.setWorkingDirectory(projectInfo.baseDir);

		// Run in parallel to the requirements generation
		// NODE_ENV=development is needed to install devDependencies for Node.js projects.
		// Set this in case the current process has NODE_ENV set to 'production'
		let installPromise: Promise<any>;
		if (projectInfo.initialise && projectInfo.initialise.length > 0) {
			logger.info(`Executing project initialise scripts: "${projectInfo.initialise.join('; ')}"`);
			installPromise = (async () => {
				for (const cmd of projectInfo.initialise) {
					const result = await execCommand(cmd, { envVars: { NODE_ENV: 'development' } });
					if (result.exitCode !== 0) {
						throw new Error(`Initialise command "${cmd}" failed with exit code ${result.exitCode}. Stdout: ${result.stdout}\nStderr: ${result.stderr}`);
					}
				}
			})();
		} else {
			logger.info('No project initialise script. Skipping.');
			installPromise = Promise.resolve();
		}

		const headCommit = await fss.getVcs().getHeadSha();
		const currentBranch = await fss.getVcs().getBranchName();
		const gitBase = headCommit; // !projectInfo.devBranch || projectInfo.devBranch === currentBranch ? headCommit : projectInfo.devBranch;
		logger.info(`git base ${gitBase}`);

		const fileContents = await fss.readFilesAsXml(fileSelection);
		logger.info(fileSelection, `Initial selected file count: ${fileSelection.length}. Tokens: ${await countTokens(fileContents)}`);

		const repositoryOverview: string = await getRepositoryOverview();
		const installedPackages: string = await projectInfo.languageTools.getInstalledPackages();

		const onlineResearch = await this.onlineResearch(repositoryOverview, installedPackages, implementationPlan);
		if (onlineResearch) implementationPlan += onlineResearch;

		// implementationPlan +=
		// 	'\n\nOnly make changes directly related to these requirements. Any other changes will be deleted.\n' +
		// 	'Do not add spurious comments like "// Adding here". Only add high level comments when there is significant complexity\n' +
		// 	'Follow existing code styles.';
		console.log(`Implementation Plan:\n${implementationPlan}`);

		await installPromise; // Complete parallel project setup

		// Edit/compile loop ----------------------------------------
		const compileErrorAnalysis: CompileErrorAnalysis | null = await this.editCompileLoop(projectInfo, fileSelection, implementationPlan);
		this.failOnCompileError(compileErrorAnalysis);

		// Store in memory for now while we see how the prompt performs
		const branchName = await getFileSystem().getVcs().getBranchName();

		// If called from runCodeEditWorkflow() then review from the original requirements
		// const reviewItems: string[] = await this.reviewChanges(requirements || implementationPlan, gitBase, fileSelection);
		// if (reviewItems.length) {
		// 	logger.info(reviewItems, 'Code review results');
		// 	agentContext().memory[`${branchName}--review`] = JSON.stringify(reviewItems);
		//
		// 	let reviewRequirements = `${implementationPlan}\n\n# Code Review Results:\n\nThe initial completed implementation changes have been reviewed. Only the following code review items remain to finalize the requirements:`;
		// 	for (const reviewItem of reviewItems) {
		// 		reviewRequirements += `\n- ${reviewItem}`;
		// 	}
		// 	compileErrorAnalysis = await this.editCompileLoop(projectInfo, fileSelection, reviewRequirements);
		// 	this.failOnCompileError(compileErrorAnalysis);
		// }

		// await this.tidyDiff(gitBase, projectInfo, fileSelection);

		// The prompts need some work
		// await this.testLoop(requirements, projectInfo, initialSelectedFiles);

		// return await fss.getVcs().getDiff(gitBase);
		// return execCommand(`git diff --stat HEAD ${gitBase}`)
	} // end of runCodeEditWorkflow method

	private failOnCompileError(compileErrorAnalysis: CompileErrorAnalysis) {
		if (compileErrorAnalysis) {
			let message = `Failed to compile the project. ${compileErrorAnalysis.compileIssuesSummary}\n${compileErrorAnalysis.compilerOutput}`;
			if (compileErrorAnalysis.fatalError) message += `\nFatal Error: ${compileErrorAnalysis.fatalError}\n`;
			throw new Error(message);
		}
	}

	private async editCompileLoop(
		projectInfo: ProjectInfo,
		initialSelectedFiles: string[],
		implementationPlan: string,
	): Promise<CompileErrorAnalysisDetails | null> {
		let compileErrorAnalysis: CompileErrorAnalysisDetails | null = null;
		let compileErrorSearchResults: string[] = [];
		let compileErrorSummaries: string[] = [];
		/* The git commit sha of the last commit which compiled successfully. We store this so when there are one or more commits
		   which don't compile, we can provide the diff since the last good commit to help identify causes of compile issues. */
		let compiledCommitSha: string | null = agentContext().memory.compiledCommitSha;

		const fs: IFileSystemService = getFileSystem();
		const git = fs.getVcs();

		const MAX_ATTEMPTS = 10;
		for (let i = 0; i < MAX_ATTEMPTS; i++) {
			try {
				// Make sure the project initially compiles
				if (i === 0) {
					await this.compile(projectInfo);
					const headSha = await git.getHeadSha();
					if (compiledCommitSha !== headSha) {
						const agent = agentContext();
						agent.memory.compiledCommitSha = headSha;
						await appContext().agentStateService.save(agent);
					}
				}

				const codeEditorFiles: string[] = [...initialSelectedFiles];
				// Start with the installed packages list and project conventions
				let codeEditorRequirements = await supportingInformation(projectInfo, codeEditorFiles);

				codeEditorRequirements += '\nEnsure when making edits that any existing code comments are retained.\n';

				// If the project doesn't compile or previous edit caused compile errors then we will create a requirements specifically for fixing any compile errors first before making more functionality changes
				if (compileErrorAnalysis) {
					const installPackages = compileErrorAnalysis.installPackages ?? [];
					if (installPackages.length) {
						if (!projectInfo.languageTools) throw new Error('Fatal Error: No language tools available to install packages.');
						for (const packageName of installPackages) await projectInfo.languageTools?.installPackage(packageName);
					}

					let compileFixRequirements = '';
					if (compileErrorAnalysis.researchQuery) {
						try {
							const searchResult = await new Perplexity().research(compileErrorAnalysis.researchQuery, false);
							compileErrorSearchResults.push(searchResult);
						} catch (e) {
							logger.error(e, 'Error searching with Perplexity. Ensure you have configured a valid token');
						}
					}

					if (compileErrorSummaries.length) {
						compileFixRequirements += '<compile-error-history>\n';
						for (const summary of compileErrorSummaries) compileFixRequirements += `<compile-error-summary>${summary}</compile-error-summary>\n`;
						compileFixRequirements += '</compile-error-history>\n';
					}
					compileFixRequirements += compileErrorSearchResults.map((result) => `<research>${result}</research>\n`).join();
					compileFixRequirements += `<compiler-errors>${compileErrorAnalysis.compilerOutput}</compiler-errors>\n\n`;
					if (compiledCommitSha) {
						compileFixRequirements += `<diff>\n${await git.getDiff(compiledCommitSha)}</diff>\n`;
						compileFixRequirements +=
							'The above diff has introduced compile errors. With the analysis of the compiler errors, first focus on analysing the diff for any obvious syntax and type errors and then analyse the files you are allowed to edit.\n';
					} else {
						compileFixRequirements +=
							'The project is not currently compiling. Analyse the compiler errors to identify the fixes required in the source code.\n';
					}
					if (compileErrorSummaries.length > 1) {
						compileFixRequirements +=
							'Your previous attempts have not fixed the compiler errors. A summary of the errors after previous attempts to fix have been provided.\n' +
							'If you are getting the same errors then try a different approach or provide a researchQuery to find the correct API usage.\n';
					}

					if (installPackages.length)
						compileFixRequirements += `The following packages have now been installed: ${installPackages.join(
							', ',
						)} which will fix any errors relating to these packages not being found.\n`;
					codeEditorRequirements = compileFixRequirements;

					codeEditorFiles.push(...(compileErrorAnalysis.additionalFiles ?? []));
				} else {
					// project is compiling, lets implement the requirements
					codeEditorRequirements += implementationPlan;
					codeEditorRequirements += '\nOnly make changes directly related to these requirements.';
				}

				const ruleFiles: Set<string> = await includeAlternativeAiToolFiles(codeEditorFiles);
				// Remove any duplicates fron ruleFiles found in codeEditorFiles
				for (const editingFile of codeEditorFiles) if (ruleFiles.has(editingFile)) ruleFiles.delete(editingFile);

				if (useAider) {
					await new AiderCodeEditor().editFilesToMeetRequirements(codeEditorRequirements, [...codeEditorFiles, ...Array.from(ruleFiles)]);
				} else {
					const coder = new SearchReplaceCoder(llms(), getFileSystem());
					await coder.editFilesToMeetRequirements(codeEditorRequirements, codeEditorFiles, Array.from(ruleFiles), true, true);
				}
				// https://docs.morphllm.com/api-reference/introduction
				// https://news.ycombinator.com/item?id=44490863

				// The code editor may add new files, so we want to add them to the initial file set
				const addedFiles: string[] = await git.getAddedFiles(compiledCommitSha);
				initialSelectedFiles.push(...addedFiles);

				// Check the changes compile
				await this.compile(projectInfo);

				// Update the compiled commit state
				compiledCommitSha = await git.getHeadSha();
				const agent = agentContext();
				agent.memory.compiledCommitSha = compiledCommitSha;
				await appContext().agentStateService.save(agent);
				compileErrorAnalysis = null;
				compileErrorSearchResults = [];
				compileErrorSummaries = [];

				break;
			} catch (e) {
				if (e instanceof CoderExhaustedAttemptsError) {
					// Propagate coder failures – these are not compile errors
					throw e;
				}
				if (e instanceof CompilationError) {
					const compileErrorOutput = e.compileOutput;
					logger.error(`Compile Error Output: ${compileErrorOutput}`);
					compileErrorAnalysis = await analyzeCompileErrors(compileErrorOutput, initialSelectedFiles, compileErrorSummaries);
				} else {
					// Unknown error – rethrow after safety checks
					forceStopErrorCheck(e);
					throw e;
				}
				compileErrorSummaries.push(compileErrorAnalysis.compileIssuesSummary);
				if (compileErrorAnalysis.fatalError) return compileErrorAnalysis;
			}
		}

		if (!compileErrorAnalysis && projectInfo.staticAnalysis) {
			const STATIC_ANALYSIS_MAX_ATTEMPTS = 2;
			for (let i = 0; i < STATIC_ANALYSIS_MAX_ATTEMPTS; i++) {
				// Run it twice so the first time can apply any auto-fixes, then the second time has only the non-auto fixable issues
				try {
					await this.runStaticAnalysis(projectInfo);
					try {
						// Merge into the last commit if possible
						await fs.getVcs().mergeChangesIntoLatestCommit(initialSelectedFiles);
					} catch (e) {}

					break;
				} catch (e) {
					let staticAnalysisErrorOutput = e.message;

					try {
						// Merge any successful auto-fixes to the latest commit if possible
						await fs.getVcs().mergeChangesIntoLatestCommit(initialSelectedFiles);
					} catch (e) {}
					if (i === STATIC_ANALYSIS_MAX_ATTEMPTS - 1) {
						logger.warn(`Unable to fix static analysis errors: ${staticAnalysisErrorOutput}`);
					} else {
						staticAnalysisErrorOutput = e.message;
						logger.info(`Static analysis error output: ${staticAnalysisErrorOutput}`);
						const staticErrorFiles: string[] = await this.extractFilenames(`${staticAnalysisErrorOutput}\n\nExtract the filenames from the compile errors.`);

						if (useAider) {
							await new AiderCodeEditor().editFilesToMeetRequirements(
								`Static analysis command: ${projectInfo.staticAnalysis}\n${staticAnalysisErrorOutput}\nFix these static analysis errors`,
								[...initialSelectedFiles, ...staticErrorFiles],
							);
						} else {
							await new SearchReplaceCoder(llms(), getFileSystem()).editFilesToMeetRequirements(
								`Static analysis command: ${projectInfo.staticAnalysis}\n${staticAnalysisErrorOutput}\nFix these static analysis errors`,
								[...initialSelectedFiles, ...staticErrorFiles],
								[],
								true,
								true,
							);
						}
						// TODO need to compile again
					}
				}
			}
		}
		return compileErrorAnalysis;
	}

	async compile(projectInfo: ProjectInfo): Promise<void> {
		if (!projectInfo.compile || projectInfo.compile.length === 0) {
			logger.info('No compile commands defined.');
			return;
		}
		for (const cmd of projectInfo.compile) {
			const { exitCode, stdout, stderr } = await execCommand(cmd);
			const result = `<compile_output>
	<command>${cmd}</command>
	<exit-code>${exitCode}</exit-code>
	<stdout>
	${stdout}
	</stdout>
	<stderr>
	${stderr}
	</stderr>
</compile_output>`;
			if (exitCode > 0) {
				logger.info(stdout);
				logger.error(stderr);
				throw new CompilationError(result, cmd, stdout, stderr, exitCode);
			}
		}
	}

	@cacheRetry()
	async selectFilesToEdit(requirements: string, projectInfo: ProjectInfo): Promise<SelectFilesResponse> {
		return await selectFilesToEdit(requirements, projectInfo);
	}

	@cacheRetry()
	async selectFiles(requirements: string, projectInfo: ProjectInfo): Promise<SelectedFile[]> {
		return await selectFilesAgent(requirements, { projectInfo });
	}

	async runStaticAnalysis(projectInfo: ProjectInfo): Promise<void> {
		if (!projectInfo.staticAnalysis || projectInfo.staticAnalysis.length === 0) {
			logger.info('No static analysis commands defined.');
			return;
		}
		for (const cmd of projectInfo.staticAnalysis) {
			const { exitCode, stdout, stderr } = await execCommand(cmd);
			// Note: original code used projectInfo.compile in the result string, changed to cmd
			const result = `<static_analysis_output><command>${cmd}</command><stdout>${stdout}</stdout><stderr>${stderr}</stderr></static_analysis_output>`;
			if (exitCode > 0) {
				throw new Error(result);
			}
		}
	}

	async runTests(projectInfo: ProjectInfo): Promise<void> {
		if (!projectInfo.test || projectInfo.test.length === 0) {
			logger.info('No test commands defined.');
			return;
		}
		for (const cmd of projectInfo.test) {
			const { exitCode, stdout, stderr } = await execCommand(cmd);
			const result = `<test_output><command>${cmd}</command><stdout>${stdout}</stdout><stderr>${stderr}</stderr></test_output>`;
			if (exitCode > 0) {
				throw new Error(result);
			}
		}
	}

	//
	async testLoop(requirements: string, projectInfo: ProjectInfo, initialSelectedFiles: string[]): Promise<CompileErrorAnalysis | null> {
		if (!projectInfo.test || projectInfo.test.length === 0) return null;
		let testErrorOutput = null;
		let errorAnalysis: CompileErrorAnalysis = null;
		const compileErrorHistory = [];
		const MAX_ATTEMPTS = 2;
		for (let i = 0; i < MAX_ATTEMPTS; i++) {
			try {
				let testRequirements = `${requirements}\nSome of the requirements may have already been implemented, so don't duplicate any existing implementation meeting the requirements.\n`;
				testRequirements += 'Write any additional tests that would be of value.';
				await new SearchReplaceCoder(llms(), getFileSystem()).editFilesToMeetRequirements(testRequirements, initialSelectedFiles, [], true, true);
				await this.compile(projectInfo);
				await this.runTests(projectInfo);
				errorAnalysis = null;
				break;
			} catch (e) {
				testErrorOutput = e.message;
				logger.info(`Test error output: ${testErrorOutput}`);
				errorAnalysis = await analyzeCompileErrors(testErrorOutput, initialSelectedFiles, compileErrorHistory);
			}
		}
		return errorAnalysis;
	}

	@cacheRetry({ scope: 'agent' })
	@span()
	async summariseRequirements(requirements: string): Promise<string> {
		return await summariseRequirements(requirements);
	}

	@span()
	async reviewChanges(requirements: string, sourceBranchOrCommit: string, fileSelection: string[]): Promise<string[]> {
		return await reviewChanges(requirements, sourceBranchOrCommit, fileSelection);
	}

	@span()
	async onlineResearch(repositoryOverview: string, installedPackages: string, implementationPlan: string): Promise<string> {
		return await onlineResearch(repositoryOverview, installedPackages, implementationPlan);
	}

	@span()
	async tidyDiff(gitBase: string, projectInfo: ProjectInfo, initialSelectedFiles: string[]): Promise<void> {
		// Tidy up minor issues in the final diff before finishing
		try {
			await tidyDiff(gitBase);
			await this.runStaticAnalysis(projectInfo);
			await this.compile(projectInfo);
			// Maybe a more robust way to do this
			await getFileSystem().getVcs().mergeChangesIntoLatestCommit(initialSelectedFiles);
		} catch (compileAfterTidyError) {
			logger.error(`Compilation failed after tidying diff: ${compileAfterTidyError.message}.`);
			// TODO revert the changes if they cause a compile error after tidying or do the full edit/compile cycle again?
		}
	}

	@cacheRetry()
	async extractFilenames(summary: string): Promise<string[]> {
		const filenames = await getFileSystem().getFileSystemTree();
		const prompt = buildPrompt({
			information: `<project_files>\n${filenames}\n</project_files>`,
			requirements: summary,
			action:
				'From the requirements consider which the files may be required to complete the task. Output your answer as JSON in the format of this example:\n' +
				'<example>\n<json>\n{\n files: ["file1", "file2", "file3"]\n}\n</json>\n</example>',
		});
		const response = await llms().medium.generateTextWithJson(prompt, { id: 'Extract Filenames' });
		if (!Array.isArray((response.object as any).files)) {
			logger.info(response.message, 'Extract Filenames response is not an array');
			return [];
		}
		return (response.object as any).files;
	}
}
