import { PredictionServiceClient, helpers, protos } from '@google-cloud/aiplatform';
import pino from 'pino';
import { cacheRetry } from '#cache/cacheRetry';
import { countTokens } from '#llm/tokens';
import { sleep } from '#utils/async-utils';
import { quotaRetry } from '#utils/quotaRetry';
import { GoogleVectorServiceConfig, TOKENS_PER_MINUTE_QUOTA } from './googleVectorConfig';

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
	private tokenUsageHistory: { timestamp: number; tokens: number }[] = [];

	constructor(googleCloudConfig: GoogleVectorServiceConfig) {
		const clientOptions = { apiEndpoint: `${googleCloudConfig.region}-aiplatform.googleapis.com` };
		this.client = new PredictionServiceClient(clientOptions);
		this.endpointPath = `projects/${googleCloudConfig.project}/locations/${googleCloudConfig.region}/publishers/google/models/${googleCloudConfig.embeddingModel}`;
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

	@cacheRetry({ retries: 3, backOffMs: 1000, scope: 'global' })
	@quotaRetry()
	private async _generateEmbedding(text: string, taskType: TaskType, outputDimensionality: Dimensionality): Promise<number[]> {
		const tokensInRequest = await countTokens(text);
		await this.waitForRateLimit(tokensInRequest);

		const instances = [helpers.toValue({ content: text, task_type: taskType })];
		const request: PredictRequest = {
			endpoint: this.endpointPath,
			instances: instances,
			parameters: helpers.toValue({ outputDimensionality }),
		};

		const [response] = await this.client.predict(request);

		this.tokenUsageHistory.push({ timestamp: Date.now(), tokens: tokensInRequest });

		const prediction = response.predictions?.[0];
		const embeddingValue = prediction?.structValue?.fields?.embeddings?.structValue?.fields?.values;
		if (embeddingValue?.listValue?.values) {
			const embedding = embeddingValue.listValue.values.map((v) => v.numberValue as number);
			if (embedding.some((n) => typeof n !== 'number' || Number.isNaN(n))) throw new Error('Invalid data type or NaN in embedding vector.');
			return outputDimensionality === 3072 ? embedding : normalizeEmbedding(embedding);
		}
		throw new Error('Invalid embedding structure in response');
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
