import { agentContext, getFileSystem, llms } from '#agent/agentContextLocalStorage';
import { func, funcClass } from '#functionSchema/functionDecorators';
import { FileSystemService } from '#functions/storage/fileSystemService';
import { Perplexity } from '#functions/web/perplexity';
import { logger } from '#o11y/logger';
import { span } from '#o11y/trace';
import { CompileErrorAnalysis, CompileErrorAnalysisDetails, analyzeCompileErrors } from '#swe/analyzeCompileErrors';
import { SelectedFile, selectFilesAgent } from '#swe/discovery/selectFilesAgent';
import { includeAlternativeAiToolFiles } from '#swe/includeAlternativeAiToolFiles';
import { getRepositoryOverview, getTopLevelSummary } from '#swe/index/repoIndexDocBuilder';
import { reviewChanges } from '#swe/reviewChanges';
import { supportingInformation } from '#swe/supportingInformation';
import { execCommand, runShellCommand } from '#utils/exec';
import { appContext } from '../applicationContext';
import { cacheRetry } from '../cache/cacheRetry';
import { AiderCodeEditor } from './aiderCodeEditor';
import { SelectFilesResponse, selectFilesToEdit } from './discovery/selectFilesToEdit';
import { ProjectInfo, detectProjectInfo } from './projectDetection';
import { basePrompt } from './prompt';
import { summariseRequirements } from './summariseRequirements';

export function buildPrompt(args: {
	information: string;
	requirements: string;
	action: string;
}): string {
	return `${basePrompt}\n${args.information}\n\nThe requirements of the task are as follows:\n<requirements>\n${args.requirements}\n</requirements>\n\nThe action to be performed is as follows:\n<action>\n${args.action}\n</action>\n`;
}

@funcClass(__filename)
export class CodeEditingAgent {
	//* @param projectInfo details of the project, lang/runtime etc

	// async addSourceCodeFile(path: string, contents): Promise<void> {}

	// No @param doc for projectInfo as its only for passing programmatically. We don't want the LLM hallucinating it

	/**
	 * Runs a workflow which finds, edits and creates the required files to implement the requirements, and committing changes to version control.
	 * It also compiles, formats, lints, and runs tests where applicable.
	 * @param requirements
	 * @param fileSelection {string[]} the files which the code editing agent will have access to. Only provide if a comprehensive analysis has been done, otherwise omit or provide null for a sub-agent to perform the file selection.
	 * altOptions are for programmatic use and not exposed to the autonomous agents.
	 */
	@func()
	async runCodeEditWorkflow(
		requirements: string,
		fileSelection?: string[] | null,
		altOptions?: { projectInfo?: ProjectInfo; workingDirectory?: string },
	): Promise<void> {
		let projectInfo: ProjectInfo = altOptions?.projectInfo;
		if (!projectInfo) {
			const detected: ProjectInfo[] = await detectProjectInfo();
			if (detected.length !== 1) throw new Error('projectInfo array must have one item');
			projectInfo = detected[0];
		}
		logger.info(projectInfo);

		const fs: FileSystemService = getFileSystem();

		if (altOptions?.workingDirectory) fs.setWorkingDirectory(altOptions.workingDirectory);

		fs.setWorkingDirectory(projectInfo.baseDir);

		// Run in parallel to the requirements generation
		// NODE_ENV=development is needed to install devDependencies for Node.js projects.
		// Set this in case the current process has NODE_ENV set to 'production'
		const installPromise: Promise<any> = projectInfo.initialise
			? runShellCommand(projectInfo.initialise, { envVars: { NODE_ENV: 'development' } })
			: Promise.resolve();

		const headCommit = await fs.vcs.getHeadSha();
		const currentBranch = await fs.vcs.getBranchName();
		const gitBase = !projectInfo.devBranch || projectInfo.devBranch === currentBranch ? headCommit : projectInfo.devBranch;
		logger.info(`git base ${gitBase}`);

		if (!fileSelection?.length) {
			// Find the initial set of files required for editing
			// const filesResponse: SelectFilesResponse = await this.selectFilesToEdit(requirements, projectInfo);
			// fileSelection = [...filesResponse.primaryFiles.map((selected) => selected.path), ...filesResponse.secondaryFiles.map((selected) => selected.path)];
			const selectFiles = await this.selectFiles(requirements, projectInfo);
			fileSelection = selectFiles.map((sf) => sf.path);
		}

		await includeAlternativeAiToolFiles(fileSelection);

		logger.info(fileSelection, `Initial selected files (${fileSelection.length})`);

		// Perform a first pass on the selected files to generate an implementation specification

		const repositoryOverview: string = await getRepositoryOverview();
		const installedPackages: string = await projectInfo.languageTools.getInstalledPackages();

		// TODO don't need this if we use the architect mode in Aider
		const implementationDetailsPrompt = `${repositoryOverview}${installedPackages}${await fs.readFilesAsXml(fileSelection)}
		<requirements>${requirements}</requirements>
		You are a senior software engineer. Your task is to review the provided user requirements against the code provided and produce a detailed, comprehensive implementation design specification to give to a developer to implement the changes in the provided files.
		Do not provide any details of verification commands etc as the CI/CD build will run integration tests. Only detail the changes required to the files for the pull request.
		Check if any of the requirements have already been correctly implemented in the code as to not duplicate work.
		Look at the existing style of the code when producing the requirements.
		`;
		let implementationRequirements = await llms().hard.generateText(implementationDetailsPrompt, { id: 'implementationSpecification' });
		implementationRequirements += '\nEnsure new code is well commented.';

		const searchPrompt = `${repositoryOverview}${installedPackages}\n<requirement>\n${implementationRequirements}\n</requirement>
Given the requirements, if there are any specific changes which require using open source libraries, and only if it's not clear from existing code or you general knowledge what the API is, then provide search queries to look up the API usage online.

Limit the queries to the minimal amount where you are uncertain of the API. You will have the opportunity to search again if there are compile errors in the code changes.

First discuss what 3rd party API usages would be required in the changes, if any. Then taking into account propose queries for online research, which must contain all the required context (e.g. language, library). For example if the requirements were "Update the Bigtable table results to include the table size" and from the repository information we could determine that it is a node.js project, then a suitable query would be "With the Google Cloud Node.js sdk verion X.Y.Z how can I get the size of a Bigtable table?"
(If there is no 3rd party API usage that is not already done in the provided files then return an empty array for the searchQueries property)

Then respond in following format:
<json>
{
	"searchQueries": ["query 1", "query 2"]
}
</json> 
`;
		try {
			const queries = (await llms().medium.generateJson(searchPrompt, { id: 'online queries from requirements' })) as { searchQueries: string[] };
			if (queries.searchQueries.length > 0) {
				logger.info(`Researching ${queries.searchQueries.join(', ')}`);
				const perplexity = new Perplexity();

				let webResearch = '<online-research>';
				for (const query of queries.searchQueries) {
					const result = await perplexity.research(query, false);
					webResearch += `<research>\n${query}\n\n${result}\n</research>`;
				}
				webResearch += '</online-research>\n';
				implementationRequirements = webResearch + implementationRequirements;
			}
		} catch (e) {
			logger.error(e, 'Error performing online queries from code requirements');
		}

		await installPromise;

		// Edit/compile loop ----------------------------------------
		let compileErrorAnalysis: CompileErrorAnalysis | null = await this.editCompileLoop(projectInfo, fileSelection, implementationRequirements);
		this.failOnCompileError(compileErrorAnalysis);

		// Store in memory for now while we see how the prompt performs
		const branchName = await getFileSystem().vcs.getBranchName();

		const reviewItems: string[] = await this.reviewChanges(requirements, gitBase, fileSelection);
		if (reviewItems.length) {
			logger.info(reviewItems, 'Code review results');
			agentContext().memory[`${branchName}--review`] = JSON.stringify(reviewItems);

			let reviewRequirements = `${implementationRequirements}\n\n# Code Review Results:\n\nThe initial completed implementation changes have been reviewed. Only the following code review items remain to finalize the requirements:`;
			for (const reviewItem of reviewItems) {
				reviewRequirements += `\n- ${reviewItem}`;
			}
			compileErrorAnalysis = await this.editCompileLoop(projectInfo, fileSelection, reviewRequirements);
			this.failOnCompileError(compileErrorAnalysis);
		}

		// The prompts need some work
		// await this.testLoop(requirements, projectInfo, initialSelectedFiles);
	}

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
		implementationRequirements: string,
	): Promise<CompileErrorAnalysisDetails | null> {
		let compileErrorAnalysis: CompileErrorAnalysisDetails | null = null;
		let compileErrorSearchResults: string[] = [];
		let compileErrorSummaries: string[] = [];
		/* The git commit sha of the last commit which compiled successfully. We store this so when there are one or more commits
		   which don't compile, we can provide the diff since the last good commit to help identify causes of compile issues. */
		let compiledCommitSha: string | null = agentContext().memory.compiledCommitSha;

		const fs: FileSystemService = getFileSystem();
		const git = fs.vcs;

		const MAX_ATTEMPTS = 5;
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
				let codeEditorRequirements = await supportingInformation(projectInfo);

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
					codeEditorRequirements += implementationRequirements;
					codeEditorRequirements += '\nOnly make changes directly related to these requirements.';
				}

				await new AiderCodeEditor().editFilesToMeetRequirements(codeEditorRequirements, codeEditorFiles);

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
				logger.info('Compiler error');
				logger.info(e);
				const compileErrorOutput = e.message;
				logger.error(`Compile Error Output: ${compileErrorOutput}`);
				// TODO handle code editor error separately - what failure modes does it have (invalid args, git error etc)?
				compileErrorAnalysis = await analyzeCompileErrors(compileErrorOutput, initialSelectedFiles, compileErrorSummaries);
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
						await fs.vcs.mergeChangesIntoLatestCommit(initialSelectedFiles);
					} catch (e) {}

					break;
				} catch (e) {
					let staticAnalysisErrorOutput = e.message;

					try {
						// Merge any successful auto-fixes to the latest commit if possible
						await fs.vcs.mergeChangesIntoLatestCommit(initialSelectedFiles);
					} catch (e) {}
					if (i === STATIC_ANALYSIS_MAX_ATTEMPTS - 1) {
						logger.warn(`Unable to fix static analysis errors: ${staticAnalysisErrorOutput}`);
					} else {
						staticAnalysisErrorOutput = e.message;
						logger.info(`Static analysis error output: ${staticAnalysisErrorOutput}`);
						const staticErrorFiles = await this.extractFilenames(`${staticAnalysisErrorOutput}\n\nExtract the filenames from the compile errors.`);

						await new AiderCodeEditor().editFilesToMeetRequirements(
							`Static analysis command: ${projectInfo.staticAnalysis}\n${staticAnalysisErrorOutput}\nFix these static analysis errors`,
							staticErrorFiles,
						);
						// TODO need to compile again
					}
				}
			}
		}
		return compileErrorAnalysis;
	}

	async compile(projectInfo: ProjectInfo): Promise<void> {
		const { exitCode, stdout, stderr } = await execCommand(projectInfo.compile);

		const result = `<compile_output>
	<command>${projectInfo.compile}</command>
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
			throw new Error(result);
		}
	}

	@cacheRetry()
	async selectFilesToEdit(requirements: string, projectInfo: ProjectInfo): Promise<SelectFilesResponse> {
		return await selectFilesToEdit(requirements, projectInfo);
	}

	@cacheRetry()
	async selectFiles(requirements: string, projectInfo: ProjectInfo): Promise<SelectedFile[]> {
		return await selectFilesAgent(requirements, projectInfo);
	}

	async runStaticAnalysis(projectInfo: ProjectInfo): Promise<void> {
		if (!projectInfo.staticAnalysis) return;
		const { exitCode, stdout, stderr } = await execCommand(projectInfo.staticAnalysis);
		const result = `<static_analysis_output><command>${projectInfo.compile}</command><stdout>${stdout}</stdout><stderr>${stderr}</stderr></static_analysis_output>`;
		if (exitCode > 0) {
			throw new Error(result);
		}
	}

	async runTests(projectInfo: ProjectInfo): Promise<void> {
		if (!projectInfo.test) return;
		const { exitCode, stdout, stderr } = await execCommand(projectInfo.test);
		const result = `<test_output><command>${projectInfo.test}</command><stdout>${stdout}</stdout><stderr>${stderr}</stderr></test_output>`;
		if (exitCode > 0) {
			throw new Error(result);
		}
	}

	//
	async testLoop(requirements: string, projectInfo: ProjectInfo, initialSelectedFiles: string[]): Promise<CompileErrorAnalysis | null> {
		if (!projectInfo.test) return null;
		let testErrorOutput = null;
		let errorAnalysis: CompileErrorAnalysis = null;
		const compileErrorHistory = [];
		const MAX_ATTEMPTS = 2;
		for (let i = 0; i < MAX_ATTEMPTS; i++) {
			try {
				let testRequirements = `${requirements}\nSome of the requirements may have already been implemented, so don't duplicate any existing implementation meeting the requirements.\n`;
				testRequirements += 'Write any additional tests that would be of value.';
				await new AiderCodeEditor().editFilesToMeetRequirements(testRequirements, initialSelectedFiles);
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
		return summariseRequirements(requirements);
	}

	@span()
	async reviewChanges(requirements: string, sourceBranchOrCommit: string, fileSelection: string[]): Promise<string[]> {
		return reviewChanges(requirements, sourceBranchOrCommit, fileSelection);
	}

	@cacheRetry()
	async extractFilenames(summary: string): Promise<string[]> {
		const filenames = await getFileSystem().getFileSystemTree();
		const prompt = buildPrompt({
			information: `<project_files>\n${filenames}\n</project_files>`,
			requirements: summary,
			action:
				'You will respond ONLY in JSON. From the requirements quietly consider which the files may be required to complete the task. You MUST output your answer ONLY as JSON in the format of this example:\n<example>\n{\n files: ["file1", "file2", "file3"]\n}\n</example>',
		});
		const response: any = await llms().medium.generateJson(prompt, { id: 'Extract Filenames' });
		return response.files;
	}
}
