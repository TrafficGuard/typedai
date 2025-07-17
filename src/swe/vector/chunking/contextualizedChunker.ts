import { cacheRetry, RetryableError } from '#cache/cacheRetry';
import pino from 'pino';
import { summaryLLM } from '#llm/services/defaultLlms';
import type { LLM } from '#shared/llm/llm.model';
import { quotaRetry } from '#utils/quotaRetry';
import { ContextualizedChunkItem, RawChunk } from './chunkTypes';

const logger = pino({ name: 'UnifiedChunkContextualizer' });

class ContextGenerator {
	constructor(
		private llm: LLM,
		private fileContent: string,
		private language: string,
		private filePath: string,
	) {}

	@cacheRetry({ retries: 5, backOffMs: 2000, version: 1 })
	@quotaRetry()
	async generateContextForChunk(chunk: RawChunk): Promise<string> {
		const contextPrompt = GENERATE_CHUNK_CONTEXT_PROMPT(chunk.original_chunk_content, this.fileContent, this.language);
		logger.info({ filePath: this.filePath, chunk_start_line: chunk.start_line, llmId: this.llm.getId() }, 'Requesting context for chunk from LLM');
		const generated_context_for_chunk = await this.llm.generateText(contextPrompt, { id: 'Chunk Context Generation' });
		logger.info({ filePath: this.filePath, chunk_start_line: chunk.start_line, contextLength: generated_context_for_chunk.length }, 'Received context for chunk');
		return generated_context_for_chunk.trim();
	}
}

/**
 * Processes an entire file content using an LLM to break it down into
 * meaningful, contextualized chunks.
 *
 * Note that with the Gemini embedding only the first 2,048 tokens in each input text are used to compute the embeddings
 *
 * This function will eventually call an LLM with a prompt to perform
 * both chunking and contextualization in a single step.
 *
 * @param filePath The path of the file being processed.
 * @param fileContent The full content of the file.
 * @param language The programming language of the file.
 * @returns A promise that resolves to an array of contextualized chunk items.
 */
export async function generateContextualizedChunks(filePath: string, fileContent: string, language: string): Promise<ContextualizedChunkItem[]> {
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

		const contextGenerator = new ContextGenerator(llmForContext, fileContent, language, filePath);

		logger.info({ filePath, totalChunks: rawChunks.length }, `Generating context for all chunks...`);
		const contextGenerationPromises = rawChunks.map(async (chunk) => {
			try {
				const generated_context = await contextGenerator.generateContextForChunk(chunk);
				return { ...chunk, generated_context };
			} catch (error) {
				logger.error({ filePath, chunk_start_line: chunk.start_line, error }, 'Failed to generate context for chunk after all retries');
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

export const TRANSLATE_CODE_TO_NL_PROMPT = (language: string, codeChunkText: string): string => `
You are an expert software engineer. Your task is to provide a clear, detailed, and semantically rich natural language explanation of the following ${language} code snippet.

Code Snippet:
\`\`\`${language}
${codeChunkText}
\`\`\`

Please provide an explanation covering:
1.  **Overall Purpose:** What is the primary goal of this code?
2.  **Key Functionalities:** What are the main operations or tasks it performs?
3.  **Mechanism:** Briefly, how does it achieve these functionalities?
4.  **Inputs & Outputs:** What are the main inputs it expects and outputs it produces (including types if obvious)?
5.  **Side Effects:** Are there any significant side effects (e.g., modifying external state, I/O operations)?
6.  **Context (if applicable):** If this snippet seems to be part of a larger module or system, what might its role be?

Your explanation should be in plain natural language, suitable for creating a high-quality embedding for semantic search. Be comprehensive yet as concise as possible while capturing the essential meaning and behavior of the code.
Explanation:`;

export const GENERATE_CHUNK_CONTEXT_PROMPT = (chunkContent: string, fullDocumentContent: string, language: string): string => `
<document lang="${language}">
${fullDocumentContent}
</document>
Here is the chunk we want to situate within the whole document. It is also in ${language}.
<chunk>
${chunkContent}
</chunk>
Please give a short succinct context to situate this chunk within the overall document for the purposes of improving search retrieval of the chunk.
Focus on the relationship of this chunk to the rest of the document, its purpose within the document, and any key interactions or dependencies it has with other parts of the document.
Answer only with the succinct context and nothing else.
`;
