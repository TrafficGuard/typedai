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

		logger.info({ filePath: fileInfo.relativePath }, 'Starting single-call contextual chunking');

		const fileChunker = new SingleCallFileChunker(this.llm, fileInfo);

		try {
			// Generate chunks and context in a single LLM call
			const contextualizedChunks = await fileChunker.chunkAndContextualize();

			logger.info({ filePath: fileInfo.relativePath, chunkCount: contextualizedChunks.length }, 'Completed single-call contextual chunking');

			return contextualizedChunks;
		} catch (error) {
			logger.error({ filePath: fileInfo.filePath, error }, 'Failed to chunk and contextualize file');
			// Fallback: return original file as single chunk without context
			return [
				{
					content: fileInfo.content,
					sourceLocation: {
						startLine: 1,
						endLine: fileInfo.content.split('\n').length,
					},
					chunkType: 'file',
					context: '',
					contextualizedContent: fileInfo.content,
				},
			];
		}
	}
}

/**
 * Single-call file chunker with contextualization
 * Chunks and contextualizes an entire file in one LLM call
 * Dramatically reduces API calls: N chunks -> 1 call (80%+ reduction)
 */
class SingleCallFileChunker {
	constructor(
		private llm: LLM,
		private fileInfo: FileInfo,
	) {}

	@cacheRetry({ retries: 2, backOffMs: 2000, version: 4 })
	@quotaRetry()
	async chunkAndContextualize(): Promise<ContextualizedChunk[]> {
		const prompt = SINGLE_CALL_CHUNK_AND_CONTEXTUALIZE_PROMPT(this.fileInfo.content, this.fileInfo.language, this.fileInfo.filePath);

		logger.debug(
			{
				filePath: this.fileInfo.filePath,
				llmId: this.llm.getId(),
			},
			'Requesting single-call chunk and contextualize from LLM',
		);

		const llmResponse = await this.llm.generateText(prompt, { id: 'Single Call Chunk and Contextualize' });

		logger.debug(
			{
				filePath: this.fileInfo.filePath,
				responseLength: llmResponse.length,
			},
			'Received LLM response',
		);

		// Parse the XML response
		try {
			const chunks = this.parseChunksFromResponse(llmResponse);

			if (chunks.length === 0) {
				throw new Error('No chunks parsed from LLM response');
			}

			logger.debug(
				{
					filePath: this.fileInfo.filePath,
					chunkCount: chunks.length,
				},
				'Successfully parsed chunks from response',
			);

			return chunks;
		} catch (parseError) {
			logger.warn(
				{
					filePath: this.fileInfo.filePath,
					error: parseError,
				},
				'Failed to parse LLM response, retrying with refined prompt',
			);

			// Retry with refined prompt including examples
			return this.retryWithRefinedPrompt(llmResponse);
		}
	}

	@cacheRetry({ retries: 1, backOffMs: 2000, version: 4 })
	@quotaRetry()
	async retryWithRefinedPrompt(previousResponse: string): Promise<ContextualizedChunk[]> {
		const refinedPrompt = REFINED_CHUNK_PROMPT(this.fileInfo.content, this.fileInfo.language, this.fileInfo.filePath, previousResponse);

		logger.debug(
			{
				filePath: this.fileInfo.filePath,
			},
			'Retrying with refined prompt',
		);

		const llmResponse = await this.llm.generateText(refinedPrompt, { id: 'Refined Chunk and Contextualize' });

		const chunks = this.parseChunksFromResponse(llmResponse);

		if (chunks.length === 0) {
			throw new Error('No chunks parsed from refined LLM response');
		}

		return chunks;
	}

	private parseChunksFromResponse(response: string): ContextualizedChunk[] {
		const chunks: ContextualizedChunk[] = [];

		// Match <chunk:contextualised>...</chunk:contextualised> tags
		const chunkRegex = /<chunk:contextualised>\s*([\s\S]*?)\s*<\/chunk:contextualised>/gi;
		let match: RegExpExecArray | null = null;

		// biome-ignore lint/suspicious/noAssignInExpressions: ok
		while ((match = chunkRegex.exec(response)) !== null) {
			const chunkContent = match[1].trim();

			try {
				const parsedChunk = this.parseIndividualChunk(chunkContent);
				chunks.push(parsedChunk);
			} catch (error) {
				logger.warn(
					{
						filePath: this.fileInfo.filePath,
						error,
						chunkContent: chunkContent.substring(0, 100),
					},
					'Failed to parse individual chunk, skipping',
				);
			}
		}

		return chunks;
	}

	private parseIndividualChunk(chunkContent: string): ContextualizedChunk {
		// Extract metadata tags
		const startLineMatch = chunkContent.match(/<startLine>(\d+)<\/startLine>/);
		const endLineMatch = chunkContent.match(/<endLine>(\d+)<\/endLine>/);
		const chunkTypeMatch = chunkContent.match(/<chunkType>([^<]+)<\/chunkType>/);
		const contextMatch = chunkContent.match(/<context>([\s\S]*?)<\/context>/);
		const contentMatch = chunkContent.match(/<content>([\s\S]*?)<\/content>/);

		if (!startLineMatch || !endLineMatch || !contentMatch) {
			throw new Error('Missing required metadata: startLine, endLine, or content');
		}

		const startLine = Number.parseInt(startLineMatch[1], 10);
		const endLine = Number.parseInt(endLineMatch[1], 10);
		const chunkType = chunkTypeMatch ? chunkTypeMatch[1].trim() : 'block';
		const context = contextMatch ? contextMatch[1].trim() : '';
		const content = contentMatch[1].trim();

		return {
			content,
			sourceLocation: {
				startLine,
				endLine,
			},
			chunkType,
			context,
			contextualizedContent: context ? `${context}\n\n${content}` : content,
		};
	}
}

/**
 * Single-call prompt for chunking and contextualizing an entire file
 * Optimized for hybrid vector + keyword (BM25) search
 * Dramatically reduces API calls by doing everything in one LLM call
 */
export const SINGLE_CALL_CHUNK_AND_CONTEXTUALIZE_PROMPT = (fileContent: string, language: string, filePath: string): string => `
You are a code analysis expert. Analyze this ${language} file and intelligently break it into semantic chunks with contextualized descriptions.

<document path="${filePath}">
${fileContent}
</document>

Your task:
1. **Intelligently chunk the file** based on semantic meaning and coherence (not just syntax)
   - Functions, classes, and methods are natural chunks
   - Group related helper functions together if they're small
   - Keep import/export statements separate only if significant
   - Aim for chunks that are self-contained and meaningful
   - Target 50-500 lines per chunk (adjust based on complexity)

2. **Generate search-optimized context** for each chunk (2-4 sentences) that helps developers find this code through:
   - **Semantic search**: Describe what it does and why it exists
   - **Keyword search**: Include specific technical terms, APIs, patterns, and domain concepts
   - **File context**: Mention the parent class/module/namespace when applicable to provide hierarchical context
   - **Related components**: Reference companion methods/functions when they work together as a cohesive unit
   - **Use clear, generic language** that works for any code file (not overly specific examples)

3. **Include accurate metadata** for each chunk:
   - startLine: First line number of the chunk (1-indexed)
   - endLine: Last line number of the chunk (1-indexed)
   - chunkType: function, class, method, import, export, interface, type, constant, block, etc.

Output format (strictly follow this XML structure):

<chunk:contextualised>
<startLine>1</startLine>
<endLine>15</endLine>
<chunkType>import</chunkType>
<context>Import statements for the authentication module. Brings in JWT verification from jsonwebtoken library, bcrypt for password hashing, and custom error handlers for authentication failures.</context>
<content>
import jwt from 'jsonwebtoken';
import bcrypt from 'bcrypt';
import { AuthError, ValidationError } from './errors';
</content>
</chunk:contextualised>

<chunk:contextualised>
<startLine>17</startLine>
<endLine>45</endLine>
<chunkType>method</chunkType>
<context>Part of AuthService class. Generates JWT authentication tokens with user credentials and configurable expiration. Works in conjunction with verifyToken method to provide complete token-based authentication cycle. Uses jsonwebtoken library for token signing with secret key.</context>
<content>
generateToken(userId: string, email: string): string {
  const payload = { userId, email, issuedAt: Date.now() };
  return jwt.sign(payload, this.secretKey, { expiresIn: '24h' });
}
</content>
</chunk:contextualised>

Guidelines:
- **Provide hierarchical context**: Mention parent class/module/namespace to help locate code in file structure
- **Reference related components**: Note companion methods or functions that work together
- **Focus on purpose and technical terms**: What problem it solves, which APIs/libraries/patterns it uses
- **Avoid code repetition**: Don't repeat what's already visible in the content
- **Think searchability**: "If a developer searches for X, should they find this chunk?"
- **Be precise with line numbers**: They must match the actual file exactly
- **Complete coverage**: All chunks together must cover the entire file with no gaps or overlaps

Now chunk and contextualize the document:
`;

/**
 * Refined prompt for retry when initial parsing fails
 * Includes the previous response to help guide correction
 */
export const REFINED_CHUNK_PROMPT = (fileContent: string, language: string, filePath: string, previousResponse: string): string => `
You are a code analysis expert. Your previous response could not be parsed correctly. Please retry with strict adherence to the XML format.

<document path="${filePath}">
${fileContent}
</document>

<previous_response>
${previousResponse.substring(0, 500)}...
</previous_response>

CRITICAL: You MUST follow this exact XML structure for each chunk. Do not deviate:

<chunk:contextualised>
<startLine>NUMBER</startLine>
<endLine>NUMBER</endLine>
<chunkType>TYPE</chunkType>
<context>2-4 sentence description with keywords and technical terms</context>
<content>
actual code content here
</content>
</chunk:contextualised>

Requirements:
1. Every chunk MUST have: startLine, endLine, chunkType, context, and content tags
2. Line numbers must be integers (1-indexed)
3. All tags must be properly closed
4. Content should be the actual code from the file
5. Context should be 2-4 sentences describing what the code does and key technical terms

Example of correct format:

<chunk:contextualised>
<startLine>1</startLine>
<endLine>10</endLine>
<chunkType>import</chunkType>
<context>Import statements for Express web framework and middleware. Includes body-parser for JSON request handling, cors for cross-origin support, and custom authentication middleware.</context>
<content>
import express from 'express';
import bodyParser from 'body-parser';
import cors from 'cors';
import { authMiddleware } from './middleware/auth';
</content>
</chunk:contextualised>

Now chunk and contextualize the document with strict XML format:
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
