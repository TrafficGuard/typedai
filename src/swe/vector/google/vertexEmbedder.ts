import { PredictionServiceClient, helpers, protos } from '@google-cloud/aiplatform';
import pino from 'pino';
import { countTokensSync } from '#llm/tokens';
import { sleep } from '#utils/async-utils';
import { cacheRetry, RetryableError } from '#cache/cacheRetry';
import { GoogleVectorServiceConfig, TOKENS_PER_MINUTE_QUOTA, getGoogleVectorServiceConfig } from './googleVectorConfig';

const logger = pino({ name: 'Embedder' });

type PredictRequest = protos.google.cloud.aiplatform.v1.IPredictRequest;

export type TaskType = 'RETRIEVAL_DOCUMENT' | 'CODE_RETRIEVAL_QUERY';
/**
 * Interface for a text embedding service.
 */
export interface TextEmbeddingService {
	generateEmbedding(text: string, taskType: TaskType): Promise<number[]>;
	generateEmbeddings(texts: string[], taskType: TaskType): Promise<(number[] | null)[]>;
}

// https://cloud.google.com/vertex-ai/generative-ai/docs/model-reference/text-embeddings-api#generative-ai-get-text-embedding-nodejs
export class VertexAITextEmbeddingService implements TextEmbeddingService {
	private client: PredictionServiceClient;
	private endpointPath: string;
	private tokenUsageHistory: { timestamp: number; tokens: number }[] = [];

	constructor(googleCloudConfig: GoogleVectorServiceConfig) {
		const clientOptions = { apiEndpoint: `${googleCloudConfig.region}-aiplatform.googleapis.com` };
		this.client = new PredictionServiceClient(clientOptions);
		this.endpointPath = `projects/${googleCloudConfig.project}/locations/${googleCloudConfig.region}/publishers/google/models/${googleCloudConfig.embeddingModel}`;
	}

	async generateEmbedding(text: string, taskType: TaskType): Promise<number[]> {
		if (!text || text.trim() === '') {
			logger.warn({ functionName: 'VertexAITextEmbeddingService.generateEmbedding', taskType }, 'Attempted to generate embedding for empty text. Returning empty vector.');
			return [];
		}

		try {
			return await this._generateEmbedding(text, taskType);
		} catch (error) {
			logger.error({ err: error }, `All retries failed for generating embedding.`);
			return [];
		}
	}

	async generateEmbeddings(texts: string[], taskType: TaskType): Promise<(number[] | null)[]> {
		const allResults: (number[] | null)[] = [];
		for (const text of texts) {
			if (!text || text.trim() === '') {
				allResults.push(null);
				continue;
			}

			try {
				const embedding = await this._generateEmbedding(text, taskType);
				allResults.push(embedding);
			} catch (error) {
				logger.error({ err: error, textSnippet: text.substring(0, 50) }, `All retries failed for generating embedding in batch.`);
				allResults.push(null);
			}
		}
		return allResults;
	}

	@cacheRetry({ retries: 3, backOffMs: 1000, scope: 'global' })
	private async _generateEmbedding(text: string, taskType: TaskType): Promise<number[]> {
		const functionName = 'VertexAITextEmbeddingService._generateEmbedding';

		const tokensInRequest = countTokensSync(text);
		await this.waitForRateLimit(tokensInRequest);

		const instances = [helpers.toValue({ content: text, task_type: taskType })];
		const request: PredictRequest = {
			endpoint: this.endpointPath,
			instances: instances,
			parameters: helpers.toValue({ outputDimensionality: 768 }),
		};

		let response;
		try {
			[response] = await this.client.predict(request);
		} catch (e) {
			throw new RetryableError(e as Error);
		}

		this.tokenUsageHistory.push({ timestamp: Date.now(), tokens: tokensInRequest });

		const prediction = response.predictions?.[0];
		const embeddingValue = prediction?.structValue?.fields?.embeddings?.structValue?.fields?.values;
		if (embeddingValue?.listValue?.values) {
			const embedding = embeddingValue.listValue.values.map((v) => v.numberValue as number);
			if (embedding.some((n) => typeof n !== 'number' || Number.isNaN(n))) {
				throw new RetryableError(new Error('Invalid data type or NaN in embedding vector.'));
			}
			return embedding;
		} else {
			throw new RetryableError(new Error('Invalid embedding structure in response'));
		}
	}

	private async waitForRateLimit(tokensInRequest: number): Promise<void> {
		while (true) {
			const now = Date.now();
			const oneMinuteAgo = now - 60_000;

			this.tokenUsageHistory = this.tokenUsageHistory.filter((record) => record.timestamp >= oneMinuteAgo);

			const currentTokensInLastMinute = this.tokenUsageHistory.reduce((sum, record) => sum + record.tokens, 0);

			if (currentTokensInLastMinute + tokensInRequest > TOKENS_PER_MINUTE_QUOTA) {
				const oldestTimestamp = this.tokenUsageHistory.length > 0 ? this.tokenUsageHistory[0].timestamp : now;
				const timeToWait = oldestTimestamp + 60_000 - now + 100;

				if (timeToWait > 0) {
					logger.warn(`Token quota will be exceeded. Waiting for ${Math.round(timeToWait / 1000)}s to avoid hitting the limit.`);
					await sleep(timeToWait);
				}
			} else {
				break;
			}
		}
	}
}

// Function to select the appropriate embedding model
let serviceInstance: TextEmbeddingService | null = null;
export function getEmbeddingService(): TextEmbeddingService {
	if (!serviceInstance) {
		serviceInstance = new VertexAITextEmbeddingService(getGoogleVectorServiceConfig());
	}
	return serviceInstance;
}

/**
 * Generates a vector embedding for the given text content.
 * @param text The text content to embed (e.g., contextualized chunk).
 * @param taskType The task type for the embedding (e.g., 'RETRIEVAL_DOCUMENT', 'CODE_RETRIEVAL_QUERY').
 * @returns A promise that resolves to the vector embedding (array of numbers).
 */
export async function generateEmbedding(text: string, taskType: TaskType): Promise<number[]> {
	const functionName = 'generateEmbedding (exported)';
	if (!text || text.trim() === '') {
		logger.warn({ functionName, taskType }, 'Attempted to generate embedding for empty text. Returning empty vector.');
		return [];
	}
	try {
		const embedder = getEmbeddingService();
		const embedding = await embedder.generateEmbedding(text, taskType);
		if (!Array.isArray(embedding)) {
			logger.error(
				{ functionName, taskType, textLength: text.length, embeddingResult: embedding },
				'Embedding generation returned invalid result (not an array). Returning empty vector.',
			);
			return [];
		}
		logger.debug(
			{ functionName, taskType, embeddingDimension: embedding.length },
			`Generated embedding vector of dimension: ${embedding.length} for task type ${taskType}`,
		);
		return embedding;
	} catch (error: any) {
		logger.error(
			{ err: { message: error.message, stack: error.stack }, functionName, taskType, textLength: text.length },
			`Error in ${functionName} after all retries. Returning empty vector as fallback.`,
		);
		return [];
	}
}
