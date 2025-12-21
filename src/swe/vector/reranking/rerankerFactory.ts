import { logger } from '#o11y/logger';
import type { OllamaNestedConfig, RerankingConfig } from '../core/config';
import type { IReranker } from '../core/interfaces';
import type { GoogleVectorServiceConfig } from '../google/googleVectorConfig';

/**
 * Create a reranker based on the provided configuration
 *
 * @param config Reranking configuration specifying provider and options
 * @param googleConfig Google Cloud config (required for vertex provider)
 * @param ollamaConfig Ollama config (optional for ollama provider)
 * @returns IReranker instance
 * @throws Error if required config is missing for the specified provider
 */
export function createReranker(config: RerankingConfig, googleConfig?: GoogleVectorServiceConfig, ollamaConfig?: OllamaNestedConfig): IReranker {
	const { provider, model } = config;

	logger.info({ provider, model }, 'Creating reranker');

	switch (provider) {
		case 'vertex': {
			if (!googleConfig) {
				throw new Error('GoogleVectorServiceConfig is required for vertex reranker');
			}
			// Dynamic import to avoid loading when not needed
			const { VertexReranker } = require('./vertexReranker');
			return new VertexReranker(googleConfig, { model });
		}

		case 'morphllm': {
			const { MorphLLMReranker } = require('./morphllmReranker');
			return new MorphLLMReranker({ model });
		}

		case 'ollama': {
			const { OllamaReranker } = require('./ollamaReranker');
			return new OllamaReranker({
				apiUrl: ollamaConfig?.apiUrl,
				model,
			});
		}

		default:
			throw new Error(`Unknown reranking provider: ${provider}`);
	}
}

/**
 * Check if two reranking configs are equivalent
 * Used for lazy reranker caching
 */
export function rerankingConfigsEqual(a: RerankingConfig | null, b: RerankingConfig | null): boolean {
	if (a === b) return true;
	if (!a || !b) return false;
	return a.provider === b.provider && a.model === b.model && a.topK === b.topK;
}
