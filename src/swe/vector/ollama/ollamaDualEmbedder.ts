import { logger } from '#o11y/logger';
import type { VectorStoreConfig } from '../core/config';
import type { IEmbedder } from '../core/interfaces';
import { OLLAMA_EMBEDDING_MODELS, OllamaEmbedderAdapter } from './ollamaEmbedder';

/**
 * Dual embedding generator for Ollama
 * Uses Qwen3 8B for general text embeddings and Nomic Embed Code for code embeddings
 */
export class OllamaDualEmbeddingGenerator {
	private textEmbedder: IEmbedder;
	private codeEmbedder: IEmbedder;

	constructor(textEmbedder: IEmbedder, codeEmbedder: IEmbedder) {
		this.textEmbedder = textEmbedder;
		this.codeEmbedder = codeEmbedder;
	}

	/**
	 * Generate both code and natural language embeddings
	 * @param codeText Original code text
	 * @param naturalLanguageText Translated natural language description
	 * @param config Vector store configuration
	 * @returns Object with both embeddings
	 */
	async generateDualEmbeddings(
		codeText: string,
		naturalLanguageText: string,
		config: VectorStoreConfig,
	): Promise<{
		codeEmbedding: number[];
		naturalLanguageEmbedding: number[];
	}> {
		if (!config.chunking?.dualEmbedding) {
			// If dual embedding is disabled, generate only code embedding
			const codeEmbedding = await this.codeEmbedder.embed(codeText);
			return {
				codeEmbedding,
				naturalLanguageEmbedding: [],
			};
		}

		logger.debug('Generating dual embeddings (code with Nomic + text with Qwen3)');

		// Generate both embeddings in parallel using specialized models
		const [codeEmbedding, naturalLanguageEmbedding] = await Promise.all([this.codeEmbedder.embed(codeText), this.textEmbedder.embed(naturalLanguageText)]);

		return {
			codeEmbedding,
			naturalLanguageEmbedding,
		};
	}

	/**
	 * Generate dual embeddings for a batch of texts
	 */
	async generateDualEmbeddingsBatch(
		codeTexts: string[],
		naturalLanguageTexts: string[],
		config: VectorStoreConfig,
	): Promise<
		Array<{
			codeEmbedding: number[];
			naturalLanguageEmbedding: number[];
		}>
	> {
		if (codeTexts.length !== naturalLanguageTexts.length) {
			throw new Error('Code texts and natural language texts must have the same length');
		}

		if (!config.chunking?.dualEmbedding) {
			const codeEmbeddings = await this.codeEmbedder.embedBatch(codeTexts);
			return codeEmbeddings.map((codeEmbedding) => ({
				codeEmbedding,
				naturalLanguageEmbedding: [],
			}));
		}

		logger.debug({ count: codeTexts.length }, 'Generating dual embeddings batch');

		// Generate both sets of embeddings in parallel
		const [codeEmbeddings, naturalLanguageEmbeddings] = await Promise.all([
			this.codeEmbedder.embedBatch(codeTexts),
			this.textEmbedder.embedBatch(naturalLanguageTexts),
		]);

		return codeEmbeddings.map((codeEmbedding, index) => ({
			codeEmbedding,
			naturalLanguageEmbedding: naturalLanguageEmbeddings[index] || [],
		}));
	}

	/**
	 * Generate query embedding for search
	 * Uses text embedder for natural language queries
	 */
	async generateQueryEmbedding(queryText: string, _config: VectorStoreConfig): Promise<number[]> {
		// For queries, use the text embedder (Qwen3) as queries are typically natural language
		return await this.textEmbedder.embed(queryText);
	}

	/**
	 * Get the text embedder
	 */
	getTextEmbedder(): IEmbedder {
		return this.textEmbedder;
	}

	/**
	 * Get the code embedder
	 */
	getCodeEmbedder(): IEmbedder {
		return this.codeEmbedder;
	}
}

/**
 * Create Ollama dual embedding generator from config
 */
export function createOllamaDualEmbedder(config: VectorStoreConfig): OllamaDualEmbeddingGenerator {
	const apiUrl = config.ollama?.apiUrl || process.env.OLLAMA_API_URL || 'http://localhost:11434';

	// Text embedder: Qwen3 8B by default
	const textModel = config.ollama?.embeddingModel || OLLAMA_EMBEDDING_MODELS.QWEN3_8B.model;
	const textDimension = textModel === OLLAMA_EMBEDDING_MODELS.QWEN3_8B.model ? OLLAMA_EMBEDDING_MODELS.QWEN3_8B.dimension : 4096;

	const textEmbedder = new OllamaEmbedderAdapter({
		apiUrl,
		model: textModel,
		dimension: textDimension,
	});

	// Code embedder: Nomic Embed Code by default
	const codeModel = config.ollama?.codeEmbeddingModel || OLLAMA_EMBEDDING_MODELS.NOMIC_EMBED_CODE.model;
	const codeDimension = codeModel === OLLAMA_EMBEDDING_MODELS.NOMIC_EMBED_CODE.model ? OLLAMA_EMBEDDING_MODELS.NOMIC_EMBED_CODE.dimension : 768;

	const codeEmbedder = new OllamaEmbedderAdapter({
		apiUrl,
		model: codeModel,
		dimension: codeDimension,
	});

	return new OllamaDualEmbeddingGenerator(textEmbedder, codeEmbedder);
}
