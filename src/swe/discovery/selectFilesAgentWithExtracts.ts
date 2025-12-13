import path from 'node:path';
import { getFileSystem, llms } from '#agent/agentContextUtils';
import { logger } from '#o11y/logger';
import type { SelectedFile } from '#shared/files/files.model';
import { type LlmMessage, type UserContentExt, user } from '#shared/llm/llm.model';
import type { ProjectInfo } from '#swe/projectDetection';
import { QueryOptions, queryWithFileSelection2 } from './selectFilesAgentWithSearch';

// Interface for line number extracts
export interface LineNumberExtract {
	from: number;
	to: number;
}

// Interface for file extracts details
export interface FileExtractDetail {
	extractReasoning: string;
	lineNumberExtracts: LineNumberExtract[];
}

// Interface for the final output structure
export interface SelectFilesAndExtractsResult {
	editableFiles: SelectedFile[];
	readOnlyFilesWithExtracts: Record<string, FileExtractDetail>; // Keyed by filePath
	answerFromInitialQuery: string;
}

export async function selectFilesAndExtracts(requirements: UserContentExt, options: QueryOptions = {}): Promise<SelectFilesAndExtractsResult> {
	const { files: initialSelectedFiles, answer: answerFromInitialQuery } = await queryWithFileSelection2(requirements, options);
	if (!initialSelectedFiles || initialSelectedFiles.length === 0) {
		logger.info('selectFilesAndExtracts: No initial files selected by queryWithFileSelection2.');
		return { editableFiles: [], readOnlyFilesWithExtracts: {}, answerFromInitialQuery };
	}

	const filePathsForClassification = initialSelectedFiles.map((f) => f.filePath);
	const classificationPromptText = `
<requirements>
${typeof requirements === 'string' ? requirements : JSON.stringify(requirements)}
</requirements>
<files_to_classify>
${filePathsForClassification.join('\n')}
</files_to_classify>

Based on the requirements, classify each file as "editable" (will likely need direct code changes) or "readonly" (provides context, won't be changed).
Respond ONLY with a JSON object in the following format inside <json></json> tags:
{
  "fileClassifications": [
    { "filePath": "string", "status": "editable" | "readonly", "reason": "string" }
  ]
}
`;
	const classificationMessages: LlmMessage[] = [user(classificationPromptText)];
	let classifications: Array<{ filePath: string; status: 'editable' | 'readonly'; reason: string }> = [];
	try {
		const classificationResponse = await llms().medium.generateTextWithJson<{
			fileClassifications: Array<{ filePath: string; status: 'editable' | 'readonly'; reason: string }>;
		}>(classificationMessages, { id: 'sfawe-classification', thinking: 'high' });
		classifications = classificationResponse.object.fileClassifications;
	} catch (error) {
		logger.error(error, 'selectFilesAndExtracts: Failed to classify files.');
		// Fallback: treat all as editable if classification fails
		const editableFilesFallback = initialSelectedFiles.map((file) => ({
			...file,
			reason: file.reason || 'Classification failed, defaulted to editable',
		}));
		return { editableFiles: editableFilesFallback, readOnlyFilesWithExtracts: {}, answerFromInitialQuery };
	}

	const editableFiles: SelectedFile[] = [];
	const readOnlyFilePaths: string[] = [];
	const initialFileMap = new Map(initialSelectedFiles.map((f) => [f.filePath, f]));

	for (const cf of classifications) {
		const originalFile = initialFileMap.get(cf.filePath);
		if (!originalFile) {
			logger.warn(`selectFilesAndExtracts: Classified file ${cf.filePath} not in initial selection.`);
			continue;
		}
		if (cf.status === 'editable') {
			editableFiles.push({ ...originalFile, reason: cf.reason || originalFile.reason, category: 'edit' });
		} else {
			readOnlyFilePaths.push(cf.filePath);
		}
	}

	const readOnlyFilesWithExtracts: Record<string, FileExtractDetail> = {};
	for (const roFilePath of readOnlyFilePaths) {
		const fileContentWithLines = await readFileWithLineNumbers(roFilePath);
		if (!fileContentWithLines) {
			logger.warn(`selectFilesAndExtracts: Could not read ${roFilePath} for extraction.`);
			continue;
		}

		const extractPromptText = `
<requirements>
${typeof requirements === 'string' ? requirements : JSON.stringify(requirements)}
</requirements>
<file_path>${roFilePath}</file_path>
<file_content_with_line_numbers>
${fileContentWithLines}
</file_content_with_line_numbers>

Identify critical sections of this read-only file for the given requirements.
Respond ONLY with a JSON object in the following format inside <json></json> tags:
{
  "extractReasoning": "string",
  "lineNumberExtracts": [{ "from": number, "to": number }]
}
`;
		const extractMessages: LlmMessage[] = [user(extractPromptText)];
		try {
			const extractResponse = await llms().medium.generateTextWithJson<FileExtractDetail>(extractMessages, {
				id: `sfawe-extract-${roFilePath.replace(/[^a-zA-Z0-9]/g, '_')}`,
			});
			if (extractResponse.object?.lineNumberExtracts) {
				readOnlyFilesWithExtracts[roFilePath] = extractResponse.object;
			} else {
				logger.warn(`selectFilesAndExtracts: Malformed extraction response for ${roFilePath}`);
			}
		} catch (error) {
			logger.error(error, `selectFilesAndExtracts: Failed to extract from ${roFilePath}`);
		}
	}

	return { editableFiles, readOnlyFilesWithExtracts, answerFromInitialQuery };
}

async function readFileWithLineNumbers(filePath: string): Promise<string | null> {
	const fs = getFileSystem();
	try {
		const fullPath = path.isAbsolute(filePath) ? filePath : path.join(fs.getWorkingDirectory(), filePath);
		const content = await fs.readFile(fullPath);
		const lines = content.split('\n');
		return lines.map((line, index) => `${index + 1}: ${line}`).join('\n');
	} catch (error) {
		logger.error(error, `readFileWithLineNumbers: Error reading file ${filePath}`);
		return null;
	}
}
