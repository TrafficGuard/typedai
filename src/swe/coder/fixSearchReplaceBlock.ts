import path from 'node:path';
import { logger } from '#o11y/logger';
import { LLM, LlmMessage, messageText, user } from '#shared/llm/llm.model';
import { EditBlock } from './coderTypes';
import { parseEditResponse } from './editBlockParser';

export async function tryFixSearchBlock(failedEdit: EditBlock, fileContentSnapshot: string, llm: LLM, fence: [string, string]): Promise<EditBlock | null> {
	const lang = path.extname(failedEdit.filePath).substring(1) || 'text';

	const fixPromptMessages: LlmMessage[] = [
		user(
			`You are an expert at correcting SEARCH/REPLACE blocks for code editing.
You will be given the content of a file and a SEARCH/REPLACE block that failed to apply, likely because the SEARCH part does not exactly match any segment of the file.

Your task is to:
1. Analyze the provided file content for the file: ${failedEdit.filePath}
2. Analyze the failed SEARCH/REPLACE block.
3. Modify *only* the SEARCH part of the block so that it exactly matches a contiguous segment of the provided file content.
   - The corrected SEARCH part should be as short as possible while still being unique and accurately targeting the intended change location.
   - Aim to preserve the original intent of the change.
4. Do *NOT* change the file path.
5. Do *NOT* change the REPLACE part.
6. Return *only* the complete, corrected SEARCH/REPLACE block in the specified format. Do not add any explanations or other text.

File content for: ${failedEdit.filePath}
${fence[0]}${lang}
${fileContentSnapshot}
${fence[1]}

Failed SEARCH/REPLACE block for: ${failedEdit.filePath}
${fence[0]}${lang}
<<<<<<< SEARCH
${failedEdit.originalText}=======
${failedEdit.updatedText}>>>>>>> REPLACE
${fence[1]}

Correct the SEARCH part and provide the full block:`,
		),
	];

	// logger.debug({ prompt: fixPromptMessages[0].content }, 'SearchReplaceCoder: Sending prompt to fix search block.');

	const llmResponseMsgObj = await llm.generateMessage(fixPromptMessages, {
		id: `SearchReplaceCoder.fixSearchBlock.${failedEdit.filePath}`,
		temperature: 0.05, // Low temperature for precise correction
	});

	const fixedBlockText = messageText(llmResponseMsgObj);
	if (!fixedBlockText?.trim()) {
		logger.warn('LLM returned empty response for search block fix.', { filePath: failedEdit.filePath });
		return null;
	}

	const parsedFix = parseEditResponse(fixedBlockText, 'diff', fence); // Assuming 'diff' format for the fix
	if (parsedFix.length === 1 && parsedFix[0].filePath === failedEdit.filePath) {
		// Basic validation: ensure it's one block and for the same file.
		// More validation could be added (e.g., REPLACE part is unchanged).
		if (parsedFix[0].updatedText.trim() === failedEdit.updatedText.trim()) {
			logger.info(`Successfully parsed corrected block for ${failedEdit.filePath}.`);
			return parsedFix[0];
		}
		logger.warn('Corrected block changed the REPLACE part. Discarding.', {
			filePath: failedEdit.filePath,
			originalReplace: failedEdit.updatedText,
			newReplace: parsedFix[0].updatedText,
		});
		return null;
	}
	logger.warn('Failed to parse corrected block or filePath mismatch.', {
		filePath: failedEdit.filePath,
		parsedCount: parsedFix.length,
		parsedFilePath: parsedFix[0]?.filePath,
		rawResponse: fixedBlockText,
	});
	return null;
}
