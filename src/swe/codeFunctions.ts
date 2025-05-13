import { func, funcClass } from '#functionSchema/functionDecorators';
import { queryWorkflow, selectFilesAgent } from '#swe/discovery/selectFilesAgent';
import { type SelectFilesResponse, selectFilesToEdit } from '#swe/discovery/selectFilesToEdit';
import { getProjectInfo } from '#swe/projectDetection';
import { reviewChanges } from '#swe/reviewChanges';

@funcClass(__filename)
export class CodeFunctions {
	/**
	 * Searches across files under the current working directory to provide an answer to the query
	 * @param query the query
	 * @returns the response from the query agent
	 */
	@func()
	async queryRepository(query: string): Promise<string> {
		return await queryWorkflow(query);
	}

	/**
	 * Selects a set of files relevant to the requirements provided.
	 * @param {string} requirements the requirements to implement, or a query about the repository codebase
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
	@func()
	async reviewChanges(requirements: string, sourceBranchOrCommit: string, fileSelection: string[]) {
		return await reviewChanges(requirements, sourceBranchOrCommit, fileSelection);
	}
}
