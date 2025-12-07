import axios from 'axios';
import pino from 'pino';
import type { IEmbedder } from '../core/interfaces';

const logger = pino({ name: 'OllamaEmbedder' });

/**
 * Ollama embedding model configurations
 */
export interface OllamaEmbeddingModelConfig {
	model: string;
	dimension: number;
	description: string;
}

/**
 * Supported Ollama embedding models
 */
export const OLLAMA_EMBEDDING_MODELS = {
	// Qwen3 8B Embedding - general purpose, high quality
	QWEN3_8B: {
		model: 'qwen3-embedding:8b',
		dimension: 4096,
		description: 'Qwen3 8B - General purpose embedding model with high quality results',
	},
	// Nomic Embed Code - optimized for code
	NOMIC_EMBED_CODE: {
		model: 'manutic/nomic-embed-code',
		dimension: 768,
		description: 'Nomic Embed Code - Specialized model for code embeddings',
	},
	// Nomic Embed Text - general text embedding
	NOMIC_EMBED_TEXT: {
		model: 'nomic-embed-text',
		dimension: 768,
		description: 'Nomic Embed Text - General text embedding model',
	},
	// Mxbai Embed Large - alternative high quality model
	MXBAI_EMBED_LARGE: {
		model: 'mxbai-embed-large',
		dimension: 1024,
		description: 'Mxbai Embed Large - High quality general embedding model',
	},
} as const;

export type OllamaEmbeddingModelName = keyof typeof OLLAMA_EMBEDDING_MODELS;

/**
 * Ollama embedder configuration
 */
export interface OllamaEmbedderConfig {
	/** Ollama API URL (default: http://localhost:11434) */
	apiUrl?: string;
	/** Model to use for embeddings */
	model: string;
	/** Expected embedding dimension */
	dimension: number;
	/** Request timeout in milliseconds (default: 60000) */
	timeout?: number;
}

/**
 * Ollama embedder adapter implementing IEmbedder interface
 * Supports open weights models like Qwen3 8B and Nomic Embed Code
 */
export class OllamaEmbedderAdapter implements IEmbedder {
	private apiUrl: string;
	private model: string;
	private dimension: number;
	private timeout: number;

	constructor(config: OllamaEmbedderConfig) {
		this.apiUrl = config.apiUrl || process.env.OLLAMA_API_URL || 'http://localhost:11434';
		this.model = config.model;
		this.dimension = config.dimension;
		this.timeout = config.timeout || 60000;
	}

	/**
	 * Generate embedding for a single text
	 */
	async embed(text: string, _taskType?: string): Promise<number[]> {
		try {
			const response = await axios.post(
				`${this.apiUrl}/api/embed`,
				{
					model: this.model,
					input: text,
				},
				{
					timeout: this.timeout,
				},
			);

			const embeddings = response.data.embeddings;
			if (!embeddings || embeddings.length === 0) {
				throw new Error('No embeddings returned from Ollama');
			}

			return embeddings[0];
		} catch (error) {
			logger.error({ error, model: this.model }, 'Failed to generate embedding');
			throw error;
		}
	}

	/**
	 * Generate embeddings for multiple texts (batched)
	 * Ollama's /api/embed supports batch input
	 */
	async embedBatch(texts: string[], _taskType?: string): Promise<number[][]> {
		if (texts.length === 0) {
			return [];
		}

		try {
			const response = await axios.post(
				`${this.apiUrl}/api/embed`,
				{
					model: this.model,
					input: texts,
				},
				{
					timeout: this.timeout * Math.min(texts.length, 10), // Scale timeout with batch size
				},
			);

			const embeddings = response.data.embeddings;
			if (!embeddings || embeddings.length !== texts.length) {
				throw new Error(`Expected ${texts.length} embeddings, got ${embeddings?.length || 0}`);
			}

			logger.debug({ count: texts.length, model: this.model }, 'Generated batch embeddings');
			return embeddings;
		} catch (error) {
			logger.error({ error, model: this.model, count: texts.length }, 'Failed to generate batch embeddings');
			throw error;
		}
	}

	/**
	 * Get embedding dimension
	 */
	getDimension(): number {
		return this.dimension;
	}

	/**
	 * Get model name
	 */
	getModel(): string {
		return this.model;
	}

	/**
	 * Check if Ollama is available and the model is loaded
	 */
	async isAvailable(): Promise<boolean> {
		try {
			const response = await axios.get(`${this.apiUrl}/api/tags`, { timeout: 5000 });
			const models = response.data.models || [];
			return models.some((m: { name: string }) => m.name.startsWith(this.model));
		} catch {
			return false;
		}
	}
}

/**
 * Create a general purpose Ollama embedder using Qwen3 8B
 */
export function createQwen3Embedder(apiUrl?: string): OllamaEmbedderAdapter {
	return new OllamaEmbedderAdapter({
		apiUrl,
		model: OLLAMA_EMBEDDING_MODELS.QWEN3_8B.model,
		dimension: OLLAMA_EMBEDDING_MODELS.QWEN3_8B.dimension,
	});
}

/**
 * Create a code-specialized Ollama embedder using Nomic Embed Code
 */
export function createNomicCodeEmbedder(apiUrl?: string): OllamaEmbedderAdapter {
	return new OllamaEmbedderAdapter({
		apiUrl,
		model: OLLAMA_EMBEDDING_MODELS.NOMIC_EMBED_CODE.model,
		dimension: OLLAMA_EMBEDDING_MODELS.NOMIC_EMBED_CODE.dimension,
	});
}

/**
 * Create a text embedder using Nomic Embed Text
 */
export function createNomicTextEmbedder(apiUrl?: string): OllamaEmbedderAdapter {
	return new OllamaEmbedderAdapter({
		apiUrl,
		model: OLLAMA_EMBEDDING_MODELS.NOMIC_EMBED_TEXT.model,
		dimension: OLLAMA_EMBEDDING_MODELS.NOMIC_EMBED_TEXT.dimension,
	});
}
