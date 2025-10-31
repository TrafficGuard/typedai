import pino from 'pino';
import { RetryableError, cacheRetry } from '#cache/cacheRetry';
import { summaryLLM } from '#llm/services/defaultLlms';
import type { LLM } from '#shared/llm/llm.model';
import { quotaRetry } from '#utils/quotaRetry';
import { VectorStoreConfig } from './config';
import { ContextualizedChunk, FileInfo, IContextualizer, RawChunk } from './interfaces';

const logger = pino({ name: 'Contextualizer' });

/**
 * Contextualizer implementation using LLM to generate context for chunks
 * Based on Anthropic's contextual retrieval approach
 * Improves retrieval by 49-67% by prepending context to each chunk
 */
export class LLMContextualizer implements IContextualizer {
	private llm: LLM;

	constructor(llm?: LLM) {
		this.llm = llm || summaryLLM();
	}

	async contextualize(chunks: RawChunk[], fileInfo: FileInfo, config: VectorStoreConfig): Promise<ContextualizedChunk[]> {
		if (!config.contextualChunking) {
			logger.debug({ filePath: fileInfo.relativePath }, 'Contextual chunking disabled, skipping contextualization');
			// Return chunks as-is but with empty context
			return chunks.map((chunk) => ({
				...chunk,
				context: '',
				contextualizedContent: chunk.content,
			}));
		}

		logger.info({ filePath: fileInfo.relativePath, chunkCount: chunks.length }, 'Starting contextual chunk generation');

		const contextGenerator = new ContextGenerator(this.llm, fileInfo.content, fileInfo.language, fileInfo.filePath);

		// Generate context for all chunks in parallel
		const contextGenerationPromises = chunks.map(async (chunk) => {
			try {
				const context = await contextGenerator.generateContextForChunk(chunk);
				return {
					...chunk,
					context,
					contextualizedContent: context ? `${context}\n\n${chunk.content}` : chunk.content,
				};
			} catch (error) {
				logger.error({ filePath: fileInfo.filePath, chunkStartLine: chunk.sourceLocation.startLine, error }, 'Failed to generate context for chunk');
				// Return chunk without context on error
				return {
					...chunk,
					context: '',
					contextualizedContent: chunk.content,
				};
			}
		});

		const contextualizedChunks = await Promise.all(contextGenerationPromises);

		logger.info({ filePath: fileInfo.relativePath, count: contextualizedChunks.length }, 'Completed contextual chunk generation');

		return contextualizedChunks;
	}
}

/**
 * Context generator for individual chunks
 * Uses caching and retry decorators for resilience and cost optimization
 */
class ContextGenerator {
	constructor(
		private llm: LLM,
		private fileContent: string,
		private language: string,
		private filePath: string,
	) {}

	@cacheRetry({ retries: 2, backOffMs: 2000, version: 2 })
	@quotaRetry()
	async generateContextForChunk(chunk: RawChunk): Promise<string> {
		const contextPrompt = GENERATE_CHUNK_CONTEXT_PROMPT(chunk.content, this.fileContent, this.language, this.filePath);

		logger.debug(
			{
				filePath: this.filePath,
				chunkStartLine: chunk.sourceLocation.startLine,
				llmId: this.llm.getId(),
			},
			'Requesting context for chunk from LLM',
		);

		const generatedContext = await this.llm.generateText(contextPrompt, { id: 'Chunk Context Generation' });

		logger.debug(
			{
				filePath: this.filePath,
				chunkStartLine: chunk.sourceLocation.startLine,
				contextLength: generatedContext.length,
			},
			'Received context for chunk',
		);

		return generatedContext.trim();
	}
}

/**
 * Prompt for generating chunk context
 * Optimized for hybrid vector + keyword (BM25) search
 * Query-oriented approach that maximizes both semantic and lexical retrieval
 *
 * Key improvements:
 * - Explicitly optimizes for both vector similarity and keyword matching
 * - Encourages inclusion of searchable technical terms and APIs
 * - Focuses on problems/use cases developers search for
 * - Bridges the gap between developer queries and code semantics
 */
export const GENERATE_CHUNK_CONTEXT_PROMPT = (chunkContent: string, fullDocumentContent: string, language: string, filePath: string): string => `
Generate search-optimized context for this ${language} code chunk.

<document path="${filePath}">
${fullDocumentContent}
</document>

<chunk>
${chunkContent}
</chunk>

Write 2-4 sentences that help developers find this code through:
- **Semantic search**: Describe what it does and why it exists
- **Keyword search**: Include specific technical terms, APIs, patterns, and domain concepts

Focus on:
1. **What problem this solves** - the use case or scenario
2. **Key technical terms** - APIs, algorithms, patterns, libraries used
3. **Domain context** - how it fits in the broader system
4. **Searchable concepts** - terms developers would query for

Avoid repeating code that's already visible. Think: "If a developer searches for X, should they find this chunk?"

Context:
`;

/**
 * Simple metadata-based contextualizer
 * Adds basic context using chunk metadata without LLM calls
 * Fast and cost-free alternative for basic context
 */
export class MetadataContextualizer implements IContextualizer {
	async contextualize(chunks: RawChunk[], fileInfo: FileInfo, config: VectorStoreConfig): Promise<ContextualizedChunk[]> {
		return chunks.map((chunk) => {
			// Generate simple metadata-based context
			const context = this.generateMetadataContext(chunk, fileInfo);
			return {
				...chunk,
				context,
				contextualizedContent: context ? `${context}\n\n${chunk.content}` : chunk.content,
			};
		});
	}

	private generateMetadataContext(chunk: RawChunk, fileInfo: FileInfo): string {
		const parts: string[] = [];

		// File context
		parts.push(`File: ${fileInfo.relativePath}`);

		// Language
		parts.push(`Language: ${fileInfo.language}`);

		// Chunk type
		if (chunk.chunkType && chunk.chunkType !== 'block' && chunk.chunkType !== 'file') {
			parts.push(`Type: ${chunk.chunkType.replace('_', ' ')}`);
		}

		// Location
		parts.push(`Lines: ${chunk.sourceLocation.startLine}-${chunk.sourceLocation.endLine}`);

		return parts.join(' | ');
	}
}
