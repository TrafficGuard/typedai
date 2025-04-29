import { func, funcClass } from '#functionSchema/functionDecorators';
import { queryWorkflow } from '#swe/discovery/selectFilesAgent';
import { type SelectFilesResponse, selectFilesToEdit } from '#swe/discovery/selectFilesToEdit';
import { getProjectInfo } from '#swe/projectDetection';
import { reviewChanges } from '#swe/reviewChanges';

@funcClass(__filename)
export class CodeFunctions {
	/**
	 * Searches across files under the current working directory to provide an answer to the query
	 * @param query
	 */
	@func()
	async queryRepository(query: string): Promise<string> {
		return await queryWorkflow(query);
	}

	/**
	 * Selects a minimal set of files to read and edit based on the requirements provided.
	 * @param requirements
	 */
	@func()
	async selectFilesToEdit(requirements: string): Promise<SelectFilesResponse> {
		return await selectFilesToEdit(requirements, await getProjectInfo());
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
