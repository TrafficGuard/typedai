import { PredictionServiceClient, helpers, protos } from '@google-cloud/aiplatform';
import pino from 'pino';
import { cacheRetry } from '#cache/cacheRetry';
import { quotaRetry } from '#utils/quotaRetry';
import { CircuitBreakerConfig, GcpQuotaCircuitBreaker } from './gcpQuotaCircuitBreaker';
import {
	CIRCUIT_BREAKER_FAILURE_THRESHOLD,
	CIRCUIT_BREAKER_RETRY_INTERVAL_MS,
	CIRCUIT_BREAKER_SUCCESS_THRESHOLD,
	GoogleVectorServiceConfig,
} from './googleVectorConfig';

const logger = pino({ name: 'Embedder' });

type PredictRequest = protos.google.cloud.aiplatform.v1.IPredictRequest;

export type TaskType = 'RETRIEVAL_DOCUMENT' | 'CODE_RETRIEVAL_QUERY';

type Dimensionality = 768 | 1536 | 3072;

/**
 * @see https://ai.google.dev/gemini-api/docs/embeddings#control-embedding-size
 * Normalize a vector to unit length (L2 normalization)
 * @param values A numeric array.
 * @returns A new array where each value is normalized such that the Euclidean norm is 1.
 */
function normalizeEmbedding(values: number[]): number[] {
	const sumOfSquares = values.reduce((acc, value) => acc + value * value, 0);
	const norm = Math.sqrt(sumOfSquares);
	if (norm === 0) throw new Error('Cannot normalize a zero vector.');

	return values.map((x) => x / norm);
}

// https://cloud.google.com/vertex-ai/generative-ai/docs/model-reference/text-embeddings-api#generative-ai-get-text-embedding-nodejs
export class VertexAITextEmbeddingService {
	private client: PredictionServiceClient;
	private endpointPath: string;
	private circuitBreaker: GcpQuotaCircuitBreaker;

	constructor(googleCloudConfig: GoogleVectorServiceConfig, circuitBreakerConfig?: CircuitBreakerConfig) {
		const clientOptions = { apiEndpoint: `${googleCloudConfig.region}-aiplatform.googleapis.com` };
		this.client = new PredictionServiceClient(clientOptions);
		this.endpointPath = `projects/${googleCloudConfig.project}/locations/${googleCloudConfig.region}/publishers/google/models/${googleCloudConfig.embeddingModel}`;

		// Initialize circuit breaker with config or defaults
		this.circuitBreaker = new GcpQuotaCircuitBreaker(
			circuitBreakerConfig || {
				serviceName: 'Vertex AI Embeddings',
				retryIntervalMs: CIRCUIT_BREAKER_RETRY_INTERVAL_MS,
				failureThreshold: CIRCUIT_BREAKER_FAILURE_THRESHOLD,
				successThreshold: CIRCUIT_BREAKER_SUCCESS_THRESHOLD,
			},
		);
	}

	async generateEmbedding(text: string, taskType: TaskType, outputDimensionality: Dimensionality = 768): Promise<number[]> {
		if (!text || text.trim() === '') {
			logger.warn(
				{ functionName: 'VertexAITextEmbeddingService.generateEmbedding', taskType },
				'Attempted to generate embedding for empty text. Returning empty vector.',
			);
			return [];
		}

		return await this._generateEmbedding(text, taskType, outputDimensionality);
	}

	async generateEmbeddings(texts: string[], taskType: TaskType, outputDimensionality: Dimensionality = 768): Promise<(number[] | null)[]> {
		const allResults: (number[] | null)[] = [];
		for (const text of texts) {
			if (!text || text.trim() === '') {
				allResults.push(null);
				continue;
			}

			const embedding = await this._generateEmbedding(text, taskType, outputDimensionality);
			allResults.push(embedding);
		}
		return allResults;
	}

	/**
	 * Internal embedding generation with retry decorators
	 * Circuit breaker wraps this to handle quota exhaustion
	 */
	@cacheRetry({ retries: 3, backOffMs: 1000, scope: 'global' })
	@quotaRetry()
	private async _generateEmbeddingInternal(text: string, taskType: TaskType, outputDimensionality: Dimensionality): Promise<number[]> {
		const value = helpers.toValue({ content: text, task_type: taskType });
		if (!value) throw new Error('Invalid data type or NaN in embedding vector.');
		const instances = [value];
		const request: PredictRequest = {
			endpoint: this.endpointPath,
			instances: instances,
			parameters: helpers.toValue({ outputDimensionality }),
		};

		const [response] = await this.client.predict(request);

		const prediction = response.predictions?.[0];
		const embeddingValue = prediction?.structValue?.fields?.embeddings?.structValue?.fields?.values;
		if (embeddingValue?.listValue?.values) {
			const embedding = embeddingValue.listValue.values.map((v) => v.numberValue as number);
			if (embedding.some((n) => typeof n !== 'number' || Number.isNaN(n))) throw new Error('Invalid data type or NaN in embedding vector.');
			return outputDimensionality === 3072 ? embedding : normalizeEmbedding(embedding);
		}
		throw new Error('Invalid embedding structure in response');
	}

	/**
	 * Generate embedding with circuit breaker protection
	 * Relies on circuit breaker for quota management - maximum throughput strategy
	 */
	private async _generateEmbedding(text: string, taskType: TaskType, outputDimensionality: Dimensionality): Promise<number[]> {
		return await this.circuitBreaker.execute(async () => {
			return await this._generateEmbeddingInternal(text, taskType, outputDimensionality);
		});
	}
}
