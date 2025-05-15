import pino from 'pino';
import { getLLM } from '../../../llm/llmFactory';
import type { LLM } from '../../../../shared/model/llm.model';

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
export async function generateContextualizedChunksFromFile(
  filePath: string,
  fileContent: string,
  language: string
): Promise<ContextualizedChunkItem[]> {
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
    const llm: LLM = getLLM('openai:gpt-3.5-turbo'); // Using a default fast LLM
    logger.info({ filePath, language, llmId: llm.getId() }, 'Requesting chunk identification from LLM');

    const rawLlmResponse = await llm.generateText(prompt);
    logger.info({ filePath, rawLlmResponseLength: rawLlmResponse.length }, 'Received raw response from LLM for chunk identification');
    // For debugging, you might want to log the full rawLlmResponse, but be cautious with large responses.
    // logger.debug({ filePath, rawLlmResponse }, 'Full raw response from LLM');


    let rawChunks: RawChunk[];
    try {
      // Attempt to parse the LLM response, which might be wrapped in markdown code blocks
      const jsonRegex = /```json\s*([\s\S]*?)\s*```|([\s\S]*)/;
      const match = rawLlmResponse.match(jsonRegex);
      const jsonString = match ? (match[1] || match[2]).trim() : "";

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
        if (typeof firstChunk.original_chunk_content !== 'string' ||
            typeof firstChunk.start_line !== 'number' ||
            typeof firstChunk.end_line !== 'number' ||
            typeof firstChunk.chunk_type !== 'string') {
          logger.error({ filePath, firstChunk }, 'A parsed chunk does not match the RawChunk structure.');
          return [];
        }
      }
      logger.info({ filePath, count: rawChunks.length }, 'Successfully parsed raw chunks from LLM response');
    } catch (parseError) {
      logger.error({ filePath, rawLlmResponse, error: parseError }, 'Failed to parse LLM response as JSON for chunk identification');
      return [];
    }

    const contextualizedChunks: ContextualizedChunkItem[] = rawChunks.map(chunk => ({
      original_chunk_content: chunk.original_chunk_content,
      generated_context: '', // Placeholder for this iteration
      contextualized_chunk_content: chunk.original_chunk_content, // Placeholder for this iteration
      source_location: {
        start_line: chunk.start_line,
        end_line: chunk.end_line,
      },
      chunk_type: chunk.chunk_type,
    }));

    logger.info({ filePath, count: contextualizedChunks.length }, 'Mapped raw chunks to ContextualizedChunkItem objects');
    return contextualizedChunks;

  } catch (error) {
    logger.error({ filePath, error }, 'Error during LLM call or overall processing for chunk identification');
    return [];
  }
}
