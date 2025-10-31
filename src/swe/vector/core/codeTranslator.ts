import pino from 'pino';
import { cacheRetry } from '#cache/cacheRetry';
import { summaryLLM } from '#llm/services/defaultLlms';
import type { LLM } from '#shared/llm/llm.model';
import { quotaRetry } from '#utils/quotaRetry';
import { ContextualizedChunk, FileInfo, ICodeTranslator, RawChunk } from './interfaces';

const logger = pino({ name: 'CodeTranslator' });

/**
 * Code to natural language translator
 * Natural language embeddings are 12% better for code search in some benchmarks
 * Translates code chunks to plain English descriptions for dual embedding strategy
 */
export class LLMCodeTranslator implements ICodeTranslator {
	private llm: LLM;

	constructor(llm?: LLM) {
		this.llm = llm || summaryLLM();
	}

	async translate(chunk: RawChunk | ContextualizedChunk, fileInfo: FileInfo): Promise<string> {
		const results = await this.translateBatch([chunk], fileInfo);
		return results[0];
	}

	async translateBatch(chunks: Array<RawChunk | ContextualizedChunk>, fileInfo: FileInfo): Promise<string[]> {
		logger.info({ filePath: fileInfo.relativePath, chunkCount: chunks.length }, 'Starting code-to-English translation');

		// Translate all chunks in parallel
		const translationPromises = chunks.map(async (chunk, index) => {
			try {
				const translation = await this.translateSingleChunk(chunk, fileInfo);
				logger.debug(
					{
						filePath: fileInfo.relativePath,
						chunkIndex: index,
						translationLength: translation.length,
					},
					'Completed translation for chunk',
				);
				return translation;
			} catch (error) {
				logger.error(
					{
						filePath: fileInfo.relativePath,
						chunkIndex: index,
						error,
					},
					'Failed to translate chunk',
				);
				// Return chunk content as fallback
				return chunk.content;
			}
		});

		const translations = await Promise.all(translationPromises);

		logger.info({ filePath: fileInfo.relativePath, count: translations.length }, 'Completed code-to-English translation');

		return translations;
	}

	@cacheRetry({ retries: 2, backOffMs: 2000, version: 1 })
	@quotaRetry()
	private async translateSingleChunk(chunk: RawChunk | ContextualizedChunk, fileInfo: FileInfo): Promise<string> {
		const prompt = TRANSLATE_CODE_TO_NL_PROMPT(fileInfo.language, chunk.content, fileInfo.relativePath);

		logger.debug(
			{
				filePath: fileInfo.filePath,
				chunkStartLine: chunk.sourceLocation.startLine,
				llmId: this.llm.getId(),
			},
			'Requesting code-to-English translation from LLM',
		);

		const translation = await this.llm.generateText(prompt, { id: 'Code to English Translation' });

		return translation.trim();
	}
}

/**
 * Prompt for translating code to natural language
 * Optimized for creating high-quality embeddings for semantic search
 */
export const TRANSLATE_CODE_TO_NL_PROMPT = (language: string, codeChunkText: string, filePath?: string): string => `
You are an expert software engineer. Your task is to provide a clear, detailed, and semantically rich natural language explanation of the following ${language} code snippet${filePath ? ` from ${filePath}` : ''}.

Code Snippet:
\`\`\`${language}
${codeChunkText}
\`\`\`

Please provide an explanation covering:

1. **Overall Purpose**: What is the primary goal of this code? What problem does it solve?

2. **Key Functionalities**: What are the main operations or tasks it performs? List the core features.

3. **Mechanism**: How does it achieve these functionalities? Describe the approach or algorithm.

4. **Inputs & Outputs**: What are the main inputs it expects and outputs it produces? Include types if obvious.

5. **Side Effects**: Are there any significant side effects (e.g., modifying external state, I/O operations, API calls)?

6. **Dependencies**: What external functions, classes, or modules does this code depend on?

7. **Context**: If this snippet seems to be part of a larger module or system, what might its role be?

Your explanation should be:
- In plain natural language (no code syntax)
- Suitable for creating a high-quality embedding for semantic search
- Comprehensive yet concise, capturing the essential meaning and behavior
- Focused on the "what" and "why" rather than just the "how"

Provide ONLY the explanation, nothing else.
`;

/**
 * Simple code translator that extracts basic metadata
 * Fast and cost-free alternative that doesn't use LLM
 * Useful for basic dual embedding without LLM costs
 */
export class SimpleCodeTranslator implements ICodeTranslator {
	async translate(chunk: RawChunk | ContextualizedChunk, fileInfo: FileInfo): Promise<string> {
		return this.generateSimpleDescription(chunk, fileInfo);
	}

	async translateBatch(chunks: Array<RawChunk | ContextualizedChunk>, fileInfo: FileInfo): Promise<string[]> {
		return chunks.map((chunk) => this.generateSimpleDescription(chunk, fileInfo));
	}

	private generateSimpleDescription(chunk: RawChunk | ContextualizedChunk, fileInfo: FileInfo): string {
		const parts: string[] = [];

		// File and location
		parts.push(`This is a ${fileInfo.language} code snippet from ${fileInfo.relativePath}`);
		parts.push(`at lines ${chunk.sourceLocation.startLine} to ${chunk.sourceLocation.endLine}.`);

		// Chunk type
		if (chunk.chunkType && chunk.chunkType !== 'block' && chunk.chunkType !== 'file') {
			const type = chunk.chunkType.replace('_', ' ');
			parts.push(`It is a ${type}.`);
		}

		// Try to extract function/class name from content
		const name = this.extractName(chunk.content, fileInfo.language);
		if (name) {
			parts.push(`It defines "${name}".`);
		}

		// Add context if available (for ContextualizedChunk)
		if ('context' in chunk && chunk.context) {
			parts.push(chunk.context);
		}

		// Add a snippet of the actual code for reference
		const codePreview = this.getCodePreview(chunk.content, 200);
		if (codePreview) {
			parts.push(`Code preview: ${codePreview}`);
		}

		return parts.join(' ');
	}

	private extractName(code: string, language: string): string | null {
		// Simple regex-based name extraction
		const patterns: Record<string, RegExp[]> = {
			typescript: [
				/(?:export\s+)?(?:async\s+)?function\s+(\w+)/,
				/(?:export\s+)?class\s+(\w+)/,
				/(?:export\s+)?interface\s+(\w+)/,
				/(?:export\s+)?type\s+(\w+)/,
				/(?:export\s+)?const\s+(\w+)\s*=/,
			],
			javascript: [/(?:export\s+)?(?:async\s+)?function\s+(\w+)/, /(?:export\s+)?class\s+(\w+)/, /(?:export\s+)?const\s+(\w+)\s*=/],
			python: [/def\s+(\w+)/, /class\s+(\w+)/],
			java: [/(?:public|private|protected)?\s*(?:static\s+)?(?:class|interface)\s+(\w+)/, /(?:public|private|protected)?\s*(?:static\s+)?\w+\s+(\w+)\s*\(/],
			go: [/func\s+(\w+)/, /type\s+(\w+)\s+struct/, /type\s+(\w+)\s+interface/],
			rust: [/fn\s+(\w+)/, /struct\s+(\w+)/, /enum\s+(\w+)/, /trait\s+(\w+)/],
		};

		const langPatterns = patterns[language] || patterns.typescript;

		for (const pattern of langPatterns) {
			const match = code.match(pattern);
			if (match?.[1]) {
				return match[1];
			}
		}

		return null;
	}

	private getCodePreview(code: string, maxLength: number): string {
		// Get a preview of the code, removing extra whitespace
		const cleaned = code.trim().replace(/\s+/g, ' ');
		if (cleaned.length <= maxLength) {
			return cleaned;
		}
		return `${cleaned.substring(0, maxLength)}...`;
	}
}
