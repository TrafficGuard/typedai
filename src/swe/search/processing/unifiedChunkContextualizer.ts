import pino from 'pino';
import type { LLM } from '#shared/model/llm.model';
import {summaryLLM} from "#llm/services/defaultLlms";

const logger = pino({ name: 'UnifiedChunkContextualizer' });

// This interface defines the structure for a single contextualized chunk
// produced by the LLM.
export interface ContextualizedChunkItem {
	original_chunk_content: string;
	generated_context: string;
	contextualized_chunk_content: string;
	source_location: {
		start_line: number;
		end_line: number;
		start_char_offset?: number;
		end_char_offset?: number;
	};
	chunk_type?: string;
}

interface RawChunk {
	original_chunk_content: string;
	start_line: number;
	end_line: number;
	chunk_type: string;
}

/**
 * Processes an entire file content using an LLM to break it down into
 * meaningful, contextualized chunks.
 *
 * This function will eventually call an LLM with a prompt to perform
 * both chunking and contextualization in a single step.
 *
 * @param filePath The path of the file being processed.
 * @param fileContent The full content of the file.
 * @param language The programming language of the file.
 * @returns A promise that resolves to an array of contextualized chunk items.
 */
export async function generateContextualizedChunksFromFile(filePath: string, fileContent: string, language: string): Promise<ContextualizedChunkItem[]> {
	logger.info({ filePath, language, contentLength: fileContent.length }, 'Starting contextualized chunk generation from file');

	const prompt = `
Analyze the following ${language} code file and identify logical chunks of code.
For each chunk, provide its content, start line number, end line number, and a type (e.g., "function_definition", "class_definition", "import_statement", "comment_block", "code_block").
Return the output as a valid JSON array of objects, where each object has the following keys: "original_chunk_content", "start_line", "end_line", "chunk_type".

File Content:
\`\`\`${language}
${fileContent}
\`\`\`

JSON Array:
`;

	try {
		const llm: LLM = summaryLLM(); // Using a default fast LLM for chunk identification
		const llmForContext = llm; // Using the same LLM for context generation for now

		logger.info({ filePath, language, llmId: llm.getId() }, 'Requesting chunk identification from LLM');

		const rawLlmResponse = await llm.generateText(prompt, { id: 'Contextualized Chunking' });
		logger.info({ filePath, rawLlmResponseLength: rawLlmResponse.length }, 'Received raw response from LLM for chunk identification');
		// For debugging, you might want to log the full rawLlmResponse, but be cautious with large responses.
		// logger.debug({ filePath, rawLlmResponse }, 'Full raw response from LLM');

		let rawChunks: RawChunk[];
		try {
			// Attempt to parse the LLM response, which might be wrapped in markdown code blocks
			const jsonRegex = /```json\s*([\s\S]*?)\s*```|([\s\S]*)/;
			const match = rawLlmResponse.match(jsonRegex);
			const jsonString = match ? (match[1] || match[2]).trim() : '';

			if (!jsonString) {
				logger.error({ filePath, rawLlmResponse }, 'LLM response did not contain a parseable JSON string.');
				return [];
			}

			rawChunks = JSON.parse(jsonString);
			if (!Array.isArray(rawChunks)) {
				logger.error({ filePath, parsedResponse: rawChunks }, 'LLM response, once parsed, is not a JSON array.');
				return [];
			}
			// Validate structure of first chunk as a sample
			if (rawChunks.length > 0) {
				const firstChunk = rawChunks[0];
				if (
					typeof firstChunk.original_chunk_content !== 'string' ||
					typeof firstChunk.start_line !== 'number' ||
					typeof firstChunk.end_line !== 'number' ||
					typeof firstChunk.chunk_type !== 'string'
				) {
					logger.error({ filePath, firstChunk }, 'A parsed chunk does not match the RawChunk structure.');
					return [];
				}
			}
			logger.info({ filePath, count: rawChunks.length }, 'Successfully parsed raw chunks from LLM response');
		} catch (parseError) {
			logger.error({ filePath, rawLlmResponse, error: parseError }, 'Failed to parse LLM response as JSON for chunk identification');
			return [];
		}

		const contextGenerationPromises = rawChunks.map(async (chunk) => {
			const contextPrompt = `
<document>
${fileContent}
</document>
Here is the chunk we want to situate within the whole document
<chunk>
${chunk.original_chunk_content}
</chunk>
Please give a short succinct context to situate this chunk within the overall document for the purposes of improving search retrieval of the chunk. Answer only with the succinct context and nothing else.
`;
			try {
				logger.info({ filePath, chunk_start_line: chunk.start_line, llmId: llmForContext.getId() }, 'Requesting context for chunk from LLM');
				const generated_context_for_chunk = await llmForContext.generateText(contextPrompt, { id: 'Chunk Context Generation' });
				logger.info({ filePath, chunk_start_line: chunk.start_line, contextLength: generated_context_for_chunk.length }, 'Received context for chunk');
				return { ...chunk, generated_context: generated_context_for_chunk.trim() };
			} catch (error) {
				logger.error({ filePath, chunk_start_line: chunk.start_line, error }, 'Failed to generate context for chunk');
				return { ...chunk, generated_context: '' }; // Assign empty context on error
			}
		});

		const chunksWithGeneratedContext = await Promise.all(contextGenerationPromises);

		const contextualizedChunks: ContextualizedChunkItem[] = chunksWithGeneratedContext.map((processedChunk) => {
			const original_chunk_content = processedChunk.original_chunk_content;
			const generated_context = processedChunk.generated_context;
			return {
				original_chunk_content: original_chunk_content,
				generated_context: generated_context,
				contextualized_chunk_content: generated_context ? `${generated_context}\n\n${original_chunk_content}` : original_chunk_content,
				source_location: {
					start_line: processedChunk.start_line,
					end_line: processedChunk.end_line,
				},
				chunk_type: processedChunk.chunk_type,
			};
		});

		logger.info({ filePath, count: contextualizedChunks.length }, 'Mapped chunks with generated context to ContextualizedChunkItem objects');
		return contextualizedChunks;
	} catch (error) {
		logger.error({ filePath, error }, 'Error during LLM call or overall processing for chunk identification or context generation');
		return [];
	}
}
