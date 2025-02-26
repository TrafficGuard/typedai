import { getFileSystem, llms } from '#agent/agentContextLocalStorage';
import { logger } from '#o11y/logger';
import { buildPrompt } from '#swe/softwareDeveloperAgent';

/**
 * @param requirements
 * @param sourceBranchOrCommit the source branch or commit to review from
 * @param fileSelection the original set of files passed to the coding agent
 */
export async function reviewChanges(requirements: string, sourceBranchOrCommit: string, fileSelection: string[]): Promise<string[]> {
	const sourceFiles = await getFileSystem().readFilesAsXml(fileSelection);
	// git show <commit_hash>:<file_path>

	// Get the source files before the changes were made so the AI reviewer can see what the code standards were like.
	// let files = ``
	// for(const file of fileSelection) {
	// `exec(git show ${sourceBranchOrCommit}:<file_path>)`
	// }
	// if (sourceFiles) sourceFiles = `<original-files>\n${sourceFiles}\n</original-files>`;

	// TODO we'll need to be smarter about what the source branch/commit is to review from
	// as there might not a source branch to compare against, so we need the base commit.
	// Otherwise just review the current files.
	const diff = await getFileSystem().vcs.getBranchDiff(sourceBranchOrCommit);
	const prompt = buildPrompt({
		information: `${sourceFiles}\n\nThe following is the git diff of the changes made so far to meet the requirements:\n<diff>\n${diff}\n</diff>`,
		requirements,
		// action: 'Do the changes in the diff satisfy the requirements, and why or why not? Do the changes follow the same style as the rest of the code? Are any of the changes redundant?' +
		// 'If so explain why and finish with the output <complete/>. If not, detail what changes you would still like to make. Output your answer in the JSON matching this TypeScript interface:\n' +
		// '{\n requirementsMet: boolean\n requirementsMetReasoning: string\n sameStyle: boolean\n sameStyleReasoning: string\n redundant: boolean\n redundantReasoning: string\n}'
		action:
			'For each diff review the code according to each of these points, providing a detailed explanation:\n' +
			'- Do the changes in the diff satisfy the requirements, and explain why?\n' +
			'- Are there any redundant changes in the diff?\n' +
			'- Was any code removed in the changes which should not have been?\n' +
			'- Is the solution sufficiently generic?\n' +
			'- Is the code following the existing conventions of configuration, variable/function use and descriptive naming?' +
			'- Does new code have comments? The exception is to skip comments when the only valid comment is trivial/tautological' +
			'- Review the style of the code changes in the diff carefully against the original code.  Do the changes follow all the style conventions of the original code? Explain why.\n' +
			'- Are there any changes unrelated to the requirements which should be reverted? \n' +
			'' +
			'After provding your reviews points then finally respond with a JSON array in the following format with the surrounding json tags:' +
			'<json>' +
			'[' +
			'	"description of change 1 on a single line",' +
			'	"description of another change required on a single line",' +
			']</json>\n' +
			'\n' +
			'If you are satified then return an empty array. If there are changes to be made then provided detailed focused instruction on what to change in each array item',
	});

	logger.info(`Reviewing diff from ${sourceBranchOrCommit}`);

	const reviewItems = (await llms().hard.generateJson(prompt, { id: 'Review code changes' })) as string[];
	logger.info(reviewItems);
	return reviewItems;
}
