import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createByModelName } from '@microsoft/tiktokenizer';
import { getFileSystem, llms } from '#agent/agentContextUtils';
import { logger } from '#o11y/logger';
import type { SelectedFile } from '#shared/files/files.model';
import type { GenerateTextWithJsonResponse } from '#shared/llm/llm.model';
import { type RepositoryMaps, generateRepositoryMaps } from '#swe/summaries/repositoryMap';
import { getRepositoryOverview } from '#swe/summaries/summaryBuilder';
import { type ProjectInfo, getProjectInfo } from '../projectDetection';

export interface SelectFilesResponse {
	primaryFiles: SelectedFile[];
	secondaryFiles: SelectedFile[];
}

/**
 *
 * @param requirements
 * @param projectInfo
 */
export async function selectFilesToEdit(requirements: string, projectInfo?: ProjectInfo | null): Promise<SelectFilesResponse> {
	projectInfo ??= await getProjectInfo();
	const projectMaps: RepositoryMaps = await generateRepositoryMaps(projectInfo ? [projectInfo] : []);

	const tokenizer = await createByModelName('gpt-4o'); // TODO model specific tokenizing
	const fileSystemTreeTokens = tokenizer.encode(projectMaps.fileSystemTreeWithFolderSummaries.text).length;
	logger.info(`FileSystem tree tokens: ${fileSystemTreeTokens}`);

	if (projectInfo?.fileSelection) requirements += `\nAdditional note: ${projectInfo.fileSelection}`;

	const repositoryOverview: string = await getRepositoryOverview();
	const fileSystemWithSummaries: string = `<project_map>\n${projectMaps.fileSystemTreeWithFolderSummaries.text}\n</project_map>\n`;

	const prompt = `${repositoryOverview}
${fileSystemWithSummaries}
<requirements>\n${requirements}\n</requirements>

<task>
The end goal is to meet the requirements defined.  This will be achieved by editing the source code and configuration.
Your task is to select from in <project_map> the files which will be required to edit or view to fulfill the requirements.
The selected files will be passed to the AI code agent for impementation, and the agent will only have access to those particular files.

You will select:
1. The primary files which you anticipate will need to be edited, and their corresponding test files.
2. The secondary supporting files which contain documentation and type information (interfaces, types, classes, function, consts etc) that will be required to correctly makes the changes. This may include any files imported by the primary files. If the requirements reference any files relevant to the changes then include them too.

If there are any instructions related to file selection in the requirements, then those instructions take priority.

Explain your observations and reasoning.
Then finally your response must end with a JSON object in the format of the following example wrapped in <json> tags:
The file paths must exist in the <project_map /> file_contents path attributes.
<example>
<json>
{
 "primaryFiles": [
     { "filePath": "/dir/file1", "reason": "file1 will be edited because..." },
     { "filePath": "/dir/file1.test", "reason": "file1.test is a test for /dir/file1 (only if the path exists)" },
     { "filePath": "/dir/file2", "reason": "file2 will be edited because..." }
 ],
 "secondaryFiles": [
     { "filePath": "/dir/docs.txt", "reason": "Contains relevant documentation" },
     { "filePath": "/dir/file3", "reason": "Contains types referenced by /dir/file1" },
     { "filePath": "/dir/file4", "reason": "Contains types referenced by /dir/file1 and /dir/file2" },
     { "filePath": "/dir/file5.txt", "reason": "Referenced in the task requirements" },
 ]
}
</json>
</example>
</task>
`;
	const response: GenerateTextWithJsonResponse<SelectFilesResponse> = await llms().medium.generateTextWithJson(prompt, { id: 'selectFilesToEdit' });
	let selectedFiles = response.object;

	selectedFiles = removeLockFiles(selectedFiles);

	selectedFiles = await removeNonExistingFiles(selectedFiles);

	selectedFiles = await removeUnrelatedFiles(requirements, selectedFiles);

	// Perform second pass
	selectedFiles = await secondPass(requirements, selectedFiles, projectInfo);

	selectedFiles = removeLockFiles(selectedFiles);

	return selectedFiles;
}

async function secondPass(requirements: string, initialSelection: SelectFilesResponse, projectInfo: ProjectInfo | null): Promise<SelectFilesResponse> {
	const fileSystem = getFileSystem();
	const allFiles = [...initialSelection.primaryFiles, ...initialSelection.secondaryFiles];
	const fileContents = await fileSystem.readFilesAsXml(allFiles.map((file) => file.filePath));

	if (projectInfo?.fileSelection) requirements += `\nAdditional note: ${projectInfo.fileSelection}`;

	const projectMaps: RepositoryMaps = await generateRepositoryMaps(projectInfo ? [projectInfo] : []);

	const fileSystemWithSummaries: string = `<project_map>\n${projectMaps.fileSystemTreeWithFolderSummaries.text}\n</project_map>\n`;
	const repositoryOverview: string = await getRepositoryOverview();

	const prompt = `${repositoryOverview}
${fileSystemWithSummaries}

<current-file-selection-contents>
${fileContents}
</current-file-selection-contents>

<current-file-selection>
${JSON.stringify(initialSelection, null, 2)}
</current-file-selection>

<requirements>${requirements}</requirements>

Your task is to refine the current file selection for the given requirements.
The selected files will be passed to the AI code agent for impementation, and the agent will only have access to those particular files.

Review the current file selection and their contents, then determine if any files should be added or removed from the list.

1. Analyze the initial file selection in relation to the requirements, particuarly noting any instructions relating to file selection.
2. Identify any missing files that should be added to better meet the requirements.
3. Identify any files in the initial selection that may not be necessary or relevant.
4. Explain your reasoning for any additions, and the type, or removals.
The "type" property must be "primary" or "secondary"
- The primary files which you anticipate will need to be edited, and their corresponding test files.
- The secondary supporting files which contain documentation and type information (interfaces, types, classes, function, consts etc) that will be required to correctly makes the changes. Include any files imported by the primary files. If the requirements reference any files relevant to the changes then include them too.

5. Provide a JSON object with the list of files to add or remove. 
The "filesToAdd" array should contain new files to add, specifying whether they are primary or secondary.
The "filesToRemove" array should contain files to remove from the initial selection.
Response with the JSON object in the following format, including the surrounding <json> tag:
<json>
{
  "filesToAdd": [
    { "reason": "Reason for adding", "type": "primary|secondary", "filePath": "/path/to/newfile.ts" }
  ],
  "filesToRemove": [
    { "reason": "Reason for removing", "filePath": "/path/to/removedfile.ts"  }
  ]
}
</json>
`;

	const result = (await llms().medium.generateJson(prompt)) as {
		filesToAdd: { filePath: string; reason: string; type: 'primary' | 'secondary' }[];
		filesToRemove: { filePath: string; reason: string }[];
	};

	logger.info(
		`Second pass file selection. Added: [${result.filesToAdd.map((f) => f.filePath).join(', ')}]. Removed: [${result.filesToRemove.map((f) => f.filePath).join(', ')}]`,
	);

	// Remove files
	initialSelection.primaryFiles = initialSelection.primaryFiles.filter((file) => !result.filesToRemove.some((r) => r.filePath === file.filePath));
	initialSelection.secondaryFiles = initialSelection.secondaryFiles.filter((file) => !result.filesToRemove.some((r) => r.filePath === file.filePath));

	// Add new files
	for (const fileToAdd of result.filesToAdd) {
		const newFile = { filePath: fileToAdd.filePath, reason: fileToAdd.reason };

		if (!(await fileExists(newFile))) continue;

		if (fileToAdd.type === 'primary') {
			if (!initialSelection.primaryFiles.some((f) => f.filePath === fileToAdd.filePath)) {
				initialSelection.primaryFiles.push(newFile);
			}
		} else if (fileToAdd.type === 'secondary') {
			if (!initialSelection.secondaryFiles.some((f) => f.filePath === fileToAdd.filePath)) {
				initialSelection.secondaryFiles.push(newFile);
			}
		} else {
			logger.info(`Invalid type ${fileToAdd.type} for ${fileToAdd.filePath}`);
			initialSelection.primaryFiles.push(newFile);
		}
	}

	return initialSelection;
}

function keepOrRemoveFileAnalysisPrompt(requirements: string, file: SelectedFile, fileContents: string): string {
	return `
<file_path>${file.filePath}</file_path>

<file_contents>${fileContents}</file_contents>

<requirements>${requirements}</requirements>

This file was selected as a candidate file to implement the requirements based only on its file name, with the provided reason: ${file.reason}

Now that you can view the full contents of ths file, reassess if the file does need to be included in the fileset for the requirements.
We want to ensure we have the minimal required files to reduce costs and focus on the necessary files.
A file is considered related if it would be modified to implement the requirements, or contains essential details (code, types, configuration, documentation etc) that would be required to known when implementing the requirements.
  
Output the following:

1. If there are any instructions related to file selection in the requirements, then details how that relates to the file_path and file_contents.

2. Discuss why or why not this file should be included from the requirements, taking into priority consideration any file selection instructions in the requirements.

3. Critically review the discussion points, providing evidence for/against each point.

4. Respond with a JSON object in the following format:
<json>
{
	"explanation": "Brief explanation of why the file is required or not"
	"isRelated": true/false,
}
</json>
`;
}

export async function removeUnrelatedFiles(requirements: string, fileSelection: SelectFilesResponse): Promise<SelectFilesResponse> {
	const analyzeFile = async (file: SelectedFile): Promise<{ file: SelectedFile; isRelated: boolean; explanation: string }> => {
		const fileSystem = getFileSystem();
		const fileContents = (await fs.readFile(path.join(fileSystem.getWorkingDirectory(), file.filePath))).toString();
		const prompt = keepOrRemoveFileAnalysisPrompt(requirements, file, fileContents);

		const jsonResult: GenerateTextWithJsonResponse<{ isRelated: boolean; explanation: string }> = await llms().easy.generateTextWithJson(
			'You are an expert software developer tasked with identifying relevant files for a coding task.',
			prompt,
			{
				temperature: 0.5,
				id: 'Select files to edit - Remove unrelated files',
			},
		);

		return {
			file,
			isRelated: jsonResult.object.isRelated,
			explanation: jsonResult.object.explanation,
		};
	};

	const allFiles = [...fileSelection.primaryFiles, ...fileSelection.secondaryFiles];
	const analysisResults = await Promise.all(allFiles.map(analyzeFile));

	const filteredPrimaryFiles = fileSelection.primaryFiles.filter((file) => {
		const result = analysisResults.find((result) => result.file.filePath === file.filePath);
		if (result && !result.isRelated) {
			logger.info(`Removed unrelated primary file: ${file.filePath}. Reason: ${result.explanation}`);
		}
		return result?.isRelated;
	});

	const filteredSecondaryFiles = fileSelection.secondaryFiles.filter((file) => {
		const result = analysisResults.find((result) => result.file.filePath === file.filePath);
		if (result && !result.isRelated) {
			logger.info(`Removed unrelated secondary file: ${file.filePath}. Reason: ${result.explanation}`);
		}
		return result?.isRelated;
	});

	return {
		primaryFiles: filteredPrimaryFiles,
		secondaryFiles: filteredSecondaryFiles,
	};
}

/**
 * Remove large files
 * @param fileSelection
 */
function removeLockFiles(fileSelection: SelectFilesResponse): SelectFilesResponse {
	// TODO make this generic. maybe not necessary with the default projectInfo.selectFiles message of don't include package manager lock files
	fileSelection.primaryFiles = fileSelection.primaryFiles.filter((file) => !file.filePath.endsWith('package-lock.json'));
	fileSelection.secondaryFiles = fileSelection.secondaryFiles.filter((file) => !file.filePath.endsWith('package-lock.json'));
	return fileSelection;
}

export async function removeNonExistingFiles(fileSelection: SelectFilesResponse): Promise<SelectFilesResponse> {
	const primaryFiles = fileSelection.primaryFiles;
	const secondaryFiles = fileSelection.secondaryFiles;

	const existingPrimaryFiles = (await Promise.all(primaryFiles.map(fileExists))).filter((selected) => selected !== null);
	const existingSecondaryFiles = (await Promise.all(secondaryFiles.map(fileExists))).filter((selected) => selected !== null);

	return {
		primaryFiles: existingPrimaryFiles as SelectedFile[],
		secondaryFiles: existingSecondaryFiles as SelectedFile[],
	};
}

async function fileExists(selectedFile: SelectedFile): Promise<SelectedFile | null> {
	try {
		await fs.access(path.join(getFileSystem().getWorkingDirectory(), selectedFile.filePath));
		return selectedFile;
	} catch {
		logger.info(`Selected file for editing "${selectedFile.filePath}" does not exists.`);
		return null;
	}
}
