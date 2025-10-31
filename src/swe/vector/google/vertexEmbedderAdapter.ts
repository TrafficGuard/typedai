import pino from 'pino';
import { VectorStoreConfig } from '../core/config';
import { IEmbedder } from '../core/interfaces';
import { GoogleVectorServiceConfig } from './googleVectorConfig';
import { TaskType, VertexAITextEmbeddingService } from './vertexEmbedder';

const logger = pino({ name: 'VertexEmbedderAdapter' });

type Dimensionality = 768 | 1536 | 3072;

/**
 * Adapter for VertexAITextEmbeddingService that implements IEmbedder interface
 * Supports configurable dual embeddings and task types
 */
export class VertexEmbedderAdapter implements IEmbedder {
	private service: VertexAITextEmbeddingService;
	private dimension: Dimensionality;
	private model: string;

	constructor(googleConfig: GoogleVectorServiceConfig, dimension: Dimensionality = 768) {
		this.service = new VertexAITextEmbeddingService(googleConfig);
		this.dimension = dimension;
		this.model = googleConfig.embeddingModel;
	}

	async embed(text: string, taskType?: string): Promise<number[]> {
		const vertexTaskType = (taskType as TaskType) || 'RETRIEVAL_DOCUMENT';
		return await this.service.generateEmbedding(text, vertexTaskType, this.dimension);
	}

	async embedBatch(texts: string[], taskType?: string): Promise<number[][]> {
		const vertexTaskType = (taskType as TaskType) || 'RETRIEVAL_DOCUMENT';
		const results = await this.service.generateEmbeddings(texts, vertexTaskType, this.dimension);

		// Filter out nulls and return only valid embeddings
		return results.filter((result): result is number[] => result !== null);
	}

	getDimension(): number {
		return this.dimension;
	}

	getModel(): string {
		return this.model;
	}
}

/**
 * Dual embedding generator for code + natural language embeddings
 */
export class DualEmbeddingGenerator {
	private embedder: IEmbedder;

	constructor(embedder: IEmbedder) {
		this.embedder = embedder;
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
		if (!config.dualEmbedding) {
			// If dual embedding is disabled, generate only code embedding
			const codeEmbedding = await this.embedder.embed(codeText, 'CODE_RETRIEVAL_QUERY');
			return {
				codeEmbedding,
				naturalLanguageEmbedding: [], // Empty array indicates no NL embedding
			};
		}

		logger.debug('Generating dual embeddings (code + natural language)');

		// Generate both embeddings in parallel
		const [codeEmbedding, naturalLanguageEmbedding] = await Promise.all([
			this.embedder.embed(codeText, 'CODE_RETRIEVAL_QUERY'),
			this.embedder.embed(naturalLanguageText, 'RETRIEVAL_DOCUMENT'),
		]);

		return {
			codeEmbedding,
			naturalLanguageEmbedding,
		};
	}

	/**
	 * Generate dual embeddings for a batch of texts
	 * More efficient than calling generateDualEmbeddings multiple times
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

		if (!config.dualEmbedding) {
			// If dual embedding is disabled, generate only code embeddings
			const codeEmbeddings = await this.embedder.embedBatch(codeTexts, 'CODE_RETRIEVAL_QUERY');
			return codeEmbeddings.map((codeEmbedding) => ({
				codeEmbedding,
				naturalLanguageEmbedding: [],
			}));
		}

		logger.debug({ count: codeTexts.length }, 'Generating dual embeddings batch');

		// Generate both sets of embeddings in parallel
		const [codeEmbeddings, naturalLanguageEmbeddings] = await Promise.all([
			this.embedder.embedBatch(codeTexts, 'CODE_RETRIEVAL_QUERY'),
			this.embedder.embedBatch(naturalLanguageTexts, 'RETRIEVAL_DOCUMENT'),
		]);

		// Combine results
		return codeEmbeddings.map((codeEmbedding, index) => ({
			codeEmbedding,
			naturalLanguageEmbedding: naturalLanguageEmbeddings[index] || [],
		}));
	}

	/**
	 * Generate query embedding for search
	 * When searching, use natural language embedding if dual embedding is enabled
	 * @param queryText The search query (natural language)
	 * @param config Vector store configuration
	 * @returns Query embedding
	 */
	async generateQueryEmbedding(queryText: string, config: VectorStoreConfig): Promise<number[]> {
		// For queries, always use CODE_RETRIEVAL_QUERY task type
		// This optimizes the embedding space for code search
		return await this.embedder.embed(queryText, 'CODE_RETRIEVAL_QUERY');
	}
}

/**
 * Get the appropriate task type for document embedding
 * @param isDualEmbedding Whether dual embedding is enabled
 * @param isNaturalLanguage Whether this is the natural language embedding
 */
export function getDocumentTaskType(isDualEmbedding: boolean, isNaturalLanguage: boolean): TaskType {
	if (isDualEmbedding && isNaturalLanguage) {
		return 'RETRIEVAL_DOCUMENT';
	}
	return 'CODE_RETRIEVAL_QUERY';
}

/**
 * Get the appropriate task type for query embedding
 */
export function getQueryTaskType(): TaskType {
	return 'CODE_RETRIEVAL_QUERY';
}
