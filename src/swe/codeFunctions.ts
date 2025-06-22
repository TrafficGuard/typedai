import { getFileSystem } from '#agent/agentContextLocalStorage';
import { func, funcClass } from '#functionSchema/functionDecorators';
import { queryWorkflowWithSearch, selectFilesAgent } from '#swe/discovery/selectFilesAgentWithSearch';
import { type SelectFilesResponse, selectFilesToEdit } from '#swe/discovery/selectFilesToEdit';
import { AI_INFO_FILENAME, getProjectInfo } from '#swe/projectDetection';
import { reviewChanges } from '#swe/reviewChanges';
import { execCommand, failOnError } from '#utils/exec';

@funcClass(__filename)
export class CodeFunctions {
	/**
	 * Runs the initialise command from the project configuration file
	 */
	@func()
	async initialiseProject(): Promise<string> {
		const projectInfo = await getProjectInfo();
		if (!projectInfo) throw new Error(`No ${AI_INFO_FILENAME} available`);
		if (!projectInfo.initialise || projectInfo.initialise.length === 0) return 'No initialise command defined';
		for (const cmd of projectInfo.initialise) {
			const result = await execCommand(cmd);
			failOnError(`Failed to initialise the project (command: ${cmd})`, result);
		}
		return `Project successfully intialised calling "${projectInfo.initialise.join(' && ')}"`;
	}

	/**
	 * Compiles the project using the compile command from the project config file
	 */
	@func()
	async compile(): Promise<string> {
		const projectInfo = await getProjectInfo();
		if (!projectInfo) throw new Error(`No ${AI_INFO_FILENAME} available`);
		if (!projectInfo.compile || projectInfo.compile.length === 0) return 'No compile command defined';
		for (const cmd of projectInfo.compile) {
			const result = await execCommand(cmd);
			failOnError(`Failed to compile the project (command: ${cmd})`, result);
		}
		return `Project successfully compiled calling "${projectInfo.compile.join(' && ')}"`;
	}

	/**
	 * Test the project using the test command from the project config file
	 */
	@func()
	async test(): Promise<string> {
		const projectInfo = await getProjectInfo();
		if (!projectInfo) throw new Error(`No ${AI_INFO_FILENAME} available`);
		if (!projectInfo.test || projectInfo.test.length === 0) return 'No test command defined';
		// This is specific to running the agents on the TypedAI project
		const fss = getFileSystem();
		let envVars = {};
		if (await fss.fileExists('./variables/test.env')) {
			envVars = parseEnvFile(await fss.readFile('./variables/test.env'));
		}
		for (const cmd of projectInfo.test) {
			const result = await execCommand(cmd, { envVars });
			failOnError(`Failure testing the project (command: ${cmd})`, result);
		}
		return `Project successfully tested calling "${projectInfo.test.join(' && ')}"`;
	}

	/**
	 * Searches across files under the current working directory to provide an answer to the query
	 * @param query the detailed natural language query
	 * @returns the response from the query agent
	 */
	@func()
	async queryRepository(query: string): Promise<string> {
		return await queryWorkflowWithSearch(query);
	}

	/**
	 * Selects a set of files relevant to the requirements provided.
	 * @param {string} requirements the detailed requirements to implement, or a detailed natural language query about the repository codebase
	 * @return {Promise<string[]>} A list of the relevant files
	 */
	@func()
	async findRelevantFiles(requirements: string): Promise<string[]> {
		if (!requirements) throw new Error('Requirements must be provided');
		const result = await selectFilesAgent(requirements);
		return result.map((s) => s.filePath);
	}

	/**
	 * Reviews the changes committed to git since a commit or start of a branch
	 * @param requirements
	 * @param sourceBranchOrCommit
	 * @param fileSelection
	 */
	// @func()
	async reviewChanges(requirements: string, sourceBranchOrCommit: string, fileSelection: string[]) {
		return await reviewChanges(requirements, sourceBranchOrCommit, fileSelection);
	}
}

function parseEnvFile(fileContents: string) {
	try {
		const lines = fileContents.split('\n');
		const env = {};

		for (const line of lines) {
			const trimmedLine = line.trim();

			if (trimmedLine && !trimmedLine.startsWith('#')) {
				const [key, value] = trimmedLine.split('=').map((part) => part.trim());
				env[key] = value;
			}
		}
		return env;
	} catch (error) {
		console.error('Error reading or parsing .env file:', error);
		return {};
	}
}
