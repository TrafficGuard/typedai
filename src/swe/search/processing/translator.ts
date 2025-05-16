import pino from 'pino';
import { llms } from '#agent/agentContextLocalStorage';
import type { LLM } from '#shared/model/llm.model';
import { TRANSLATION_LLM_MODEL_ID } from '../config';
import { GENERATE_CHUNK_CONTEXT_PROMPT, TRANSLATE_CODE_TO_NL_PROMPT } from './prompts';

const logger = pino({ name: 'Translator' });

const MAX_RETRIES = 3;
const INITIAL_RETRY_DELAY_MS = 1000; // 1 second
const RETRY_DELAY_MULTIPLIER = 2; // For exponential backoff

function getTranslationLLM(): LLM {
	logger.info(`Attempting to use LLM model ID for translation: ${TRANSLATION_LLM_MODEL_ID}`);
	const allConfiguredLlms = llms(); // Retrieves Record<TaskLevel, LLM>

	for (const llmInstance of Object.values(allConfiguredLlms)) {
		// The getModel() method is part of the LLM interface
		if (llmInstance.getModel() === TRANSLATION_LLM_MODEL_ID) {
			logger.info(`Found configured LLM for translation: ${TRANSLATION_LLM_MODEL_ID}`);
			return llmInstance;
		}
	}

	logger.warn(`Configured LLM model ID '${TRANSLATION_LLM_MODEL_ID}' not found. Falling back to 'easy' tier LLM for translation.`);
	return allConfiguredLlms.easy; // Fallback to the 'easy' LLM instance
}

/**
 * Generates a natural language description for a given code chunk using an LLM.
 * @param codeChunkText The text content of the code chunk.
 * @param language The programming language of the chunk.
 * @returns A promise that resolves to the natural language description.
 */
export async function translateCodeToNaturalLanguage(codeChunkText: string, language: string): Promise<string> {
	const functionName = 'translateCodeToNaturalLanguage';
	logger.debug(`Translating code chunk (language: ${language}). Length: ${codeChunkText.length}`);

	// Construct a prompt for the LLM
	const prompt = TRANSLATE_CODE_TO_NL_PROMPT(language, codeChunkText);

	for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
		try {
			const llm = getTranslationLLM();
			const description = await llm.generateText(prompt);
			if (description && description.trim() !== '') {
				logger.debug(`Generated description: ${description.substring(0, 100)}...`);
				return description.trim();
			}
			// Handle case where LLM returns empty string as non-error
			throw new Error('LLM returned empty description');
		} catch (error) {
			const delay = INITIAL_RETRY_DELAY_MS * RETRY_DELAY_MULTIPLIER ** attempt;
			logger.error(
				{ err: error, attempt: attempt + 1, maxRetries: MAX_RETRIES, functionName, delay },
				`Error in ${functionName} (attempt ${attempt + 1}/${MAX_RETRIES}). Retrying in ${delay}ms...`,
			);

			if (attempt < MAX_RETRIES - 1) {
				await new Promise((resolve) => setTimeout(resolve, delay));
			} else {
				logger.error({ err: error, functionName }, `All ${MAX_RETRIES} retries failed for ${functionName}. Returning fallback description.`);
			}
		}
	}
	// Fallback or re-throw depending on desired error handling
	return 'Error generating description.';
}

/**
 * Generates a chunk-specific context for a given code chunk using an LLM,
 * based on the content of the entire document.
 * @param chunkContent The text content of the code chunk.
 * @param fullDocumentContent The text content of the entire document/file.
 * @param language The programming language of the chunk.
 * @returns A promise that resolves to the chunk-specific context.
 */
export async function generateChunkContext(chunkContent: string, fullDocumentContent: string, language: string): Promise<string> {
	const functionName = 'generateChunkContext';
	logger.debug(`Generating chunk-specific context (language: ${language}). Chunk Length: ${chunkContent.length}, Doc Length: ${fullDocumentContent.length}`);

	const prompt = GENERATE_CHUNK_CONTEXT_PROMPT(chunkContent, fullDocumentContent, language);

	for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
		try {
			const llm = getTranslationLLM(); // Using the same LLM as for general translation for now
			const context = await llm.generateText(prompt);
			if (context && context.trim() !== '') {
				logger.debug(`Generated chunk-specific context: ${context.substring(0, 100)}...`);
				return context.trim();
			}
			// Handle case where LLM returns empty string as non-error
			throw new Error('LLM returned empty context');
		} catch (error) {
			const delay = INITIAL_RETRY_DELAY_MS * RETRY_DELAY_MULTIPLIER ** attempt;
			logger.error(
				{ err: error, attempt: attempt + 1, maxRetries: MAX_RETRIES, functionName, delay },
				`Error in ${functionName} (attempt ${attempt + 1}/${MAX_RETRIES}). Retrying in ${delay}ms...`,
			);

			if (attempt < MAX_RETRIES - 1) {
				await new Promise((resolve) => setTimeout(resolve, delay));
			} else {
				logger.error({ err: error, functionName }, `All ${MAX_RETRIES} retries failed for ${functionName}. Returning fallback context.`);
			}
		}
	}
	return 'Error generating chunk context.';
}
