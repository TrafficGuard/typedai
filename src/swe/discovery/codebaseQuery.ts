import { getFileSystem, llms } from '#agent/agentContextLocalStorage';
import { logger } from '#o11y/logger';
import { getTopLevelSummary } from '#swe/index/repoIndexDocBuilder';
import { type RepositoryMaps, generateRepositoryMaps } from '#swe/index/repositoryMap';
import { type ProjectInfo, getProjectInfo } from '#swe/projectDetection';

interface FileSelection {
	files: string[];
}

/**
 * Old ad-hoc query with fixed two passes over the filesystem tree/files
 * @deprecated use queryWorkflow instead
 * @param query
 */
export async function codebaseQuery(query: string): Promise<string> {
	const initialFileSelection = await firstPass(query);
	const refinedFileSelection = await secondPass(query, initialFileSelection);
	return synthesiseResult(query, refinedFileSelection);
}

async function firstPass(query: string): Promise<string[]> {
	const projectInfo: ProjectInfo = await getProjectInfo();
	const projectMaps: RepositoryMaps = await generateRepositoryMaps(projectInfo ? [projectInfo] : []);

	const prompt = `${await getTopLevelSummary()}
<project-outline>
${projectMaps.fileSystemTreeWithFileSummaries.text}
<project-outline>


Your task is to search through the relevant files in the project to generate a report for the query
<query>${query}</query>

Your first task is from the project outlines to select the minimal list of files which will contain the information required to formulate an answer.

1. Make observations about the project releated to the query. Focus on functionality, not opinions.

2. Explaing your thoughts and reasoning of what the minimal files (not folders) would be relevant to answer the query.

3. Output an initial list of files with reasoning for each file. (Do not include folders)

4. Reflect on your initial list and review the selections, whether any files could be removed, or if any particular files need to be added, and why.

5. Finally, taking your reflection into account, respond with the final full file path selections as a JSON object in the format:
<json>
{ "files": ["config.json", "dir1/dir2/file1.txt", "dir1/dir2/dir3/source.ts"] } 
</json>
`;

	const fileSelection = (await llms().medium.generateJson(prompt)) as FileSelection;
	console.log(`${fileSelection.files.join('\n')}\n\n`);
	return fileSelection.files;
}

async function secondPass(query: string, filePaths: string[]): Promise<string[]> {
	const projectInfo: ProjectInfo = await getProjectInfo();
	const projectMaps: RepositoryMaps = await generateRepositoryMaps(projectInfo ? [projectInfo] : []);
	const fileContents = await getFileSystem().readFilesAsXml(filePaths);
	const prompt = `${await getTopLevelSummary()}
<project-outline>
${projectMaps.fileSystemTreeWithFileSummaries.text}
</project-outline>

<query>${query}</query>

<current-file-selection-contents>
${fileContents}
</current-file-selection-contents>
<current-file-selection>
${filePaths.join('\n')}
</current-file-selection>

Your task is to refine the current file selection for the given query. Review the project outline and the current file selection, then determine if any files should be added or removed from the list.

1. Analyze the initial file selection in relation to the query.
2. Identify any missing files that should be added to better answer the query.
3. Identify any files in the initial selection that may not be necessary or relevant.
4. Explain your reasoning for any additions or removals.
5. Provide a list of files to add or remove as a JSON object in the following format:

<json>
{
  "filesToAdd": ["path/to/newfile.ts"],
  "filesToRemove": ["path/to/removedfile.ts"]
}
</json>

The "filesToAdd" array should contain new files to add. The "filesToRemove" array should contain files to remove from the initial selection.`;

	const result = (await llms().medium.generateJson(prompt)) as {
		filesToAdd: string[];
		filesToRemove: string[];
	};

	logger.info(`Second pass file selection. Added:[${result.filesToAdd.join(', ')}]. Removed: [${result.filesToRemove.join(', ')}]`);

	// Add new files
	for (const fileToAdd of result.filesToAdd) {
		if (!filePaths.includes(fileToAdd)) {
			filePaths.push(fileToAdd);
		}
	}
	// Remove files
	filePaths = filePaths.filter((file) => !result.filesToRemove.includes(file));

	return filePaths;
}

async function synthesiseResult(query: string, filePaths: string[]): Promise<string> {
	const fileContents = await getFileSystem().readFilesAsXml(filePaths);

	const resultPrompt = `
	${await getTopLevelSummary()}
	${fileContents}
	
	<query>${query}</query>
	
	Give the project information and file contents, answer the query, providing references to the source files.
	
	1. List your observations relevant to query, focusing on functionality. Only provide opinions if asked.
	
	2. Review and reflect on your observations taking into account the provided information and your knowledge on the subject  .
	
	3. Output your final query response within <result></result> tags
	`;

	return await llms().medium.generateTextWithResult(resultPrompt, { id: 'codebase query synthesis' });
}
