import fs from 'node:fs';
import { join } from 'node:path';
import mime from 'mime-types';
import { getFileSystem, llms } from '#agent/agentContextLocalStorage';
import { func, funcClass } from '#functionSchema/functionDecorators';
import { countTokens } from '#llm/tokens';
import { LlmMessage, messageText } from '#shared/llm/llm.model';

@funcClass(__filename)
export class LlmTools {
	/**
	 * Counts the number of tokens in the provided text
	 * @param text the text to count tokens for
	 * @returns the number of tokens in the text
	 */
	@func()
	async countTextTokens(text: string): Promise<number> {
		return await countTokens(text);
	}

	/**
	 * Uses a large language model to transform the input content by applying the provided natural language instruction
	 * @param text the input text
	 * @param descriptionOfChanges a description of the changes/processing to apply to the text
	 * @returns the processed text
	 */
	@func()
	async processText(text: string, descriptionOfChanges: string): Promise<string> {
		const prompt = `<input>${text}<input>\n` + `<action>\n${descriptionOfChanges}. Output the response inside <result></result> tags.\n</action>`;
		return await llms().medium.generateTextWithResult(prompt, { id: 'LlmTools_processText' });
	}

	/**
	 * Uses a large language model to analyse an image/document
	 * @param filePath the path to the image/document
	 * @param query the query ask about the image/document
	 * @returns the analysis of the image/document
	 */
	@func()
	async analyseFile(filePath: string, query: string): Promise<string> {
		const fss = getFileSystem();
		if (!(await fss.fileExists(filePath))) throw new Error(`File ${filePath} does not exist`);

		const fileBuffer = await fs.promises.readFile(join(fss.getWorkingDirectory(), filePath));
		const base64 = fileBuffer.toString('base64');

		if (filePath.endsWith('.png') || filePath.endsWith('.jpg') || filePath.endsWith('.jpeg') || filePath.endsWith('.gif') || filePath.endsWith('.webp')) {
			const msg: LlmMessage = {
				role: 'user',
				content: [
					{ type: 'image', image: base64 },
					{ type: 'text', text: query },
				],
			};
			const result = await llms().medium.generateMessage([msg], { id: 'LlmTools_analyseFile' });
			return messageText(result);
		}

		if (filePath.endsWith('.pdf') || filePath.endsWith('.docx') || filePath.endsWith('.doc') || filePath.endsWith('.txt') || filePath.endsWith('.md')) {
			const mediaType = mime.lookup(filePath);
			const msg: LlmMessage = {
				role: 'user',
				content: [
					{ type: 'file', data: base64, mediaType },
					{ type: 'text', text: query },
				],
			};
			const result = await llms().medium.generateMessage([msg], { id: 'LlmTools_analyseFile' });
			return messageText(result);
		}
		throw new Error(`Unsupported file type: ${filePath}`);
	}
}
