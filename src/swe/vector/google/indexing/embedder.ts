import { PredictionServiceClient, helpers, protos } from '@google-cloud/aiplatform';
import { struct } from 'pb-util';
import pino from 'pino';
import { countTokensSync } from '#llm/tokens';
import { sleep } from '#utils/async-utils';
import { DISCOVERY_ENGINE_EMBEDDING_MODEL, EMBEDDING_API_BATCH_SIZE, GCLOUD_PROJECT, GCLOUD_REGION, TOKENS_PER_MINUTE_QUOTA } from '../config';

const logger = pino({ name: 'Embedder' });

const MAX_RETRIES = 3;
const INITIAL_RETRY_DELAY_MS = 1000; // 1 second
const RETRY_DELAY_MULTIPLIER = 2; // For exponential backoff

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

	constructor() {
		const clientOptions = {
			apiEndpoint: `${GCLOUD_REGION}-aiplatform.googleapis.com`,
		};
		this.client = new PredictionServiceClient(clientOptions);
		this.endpointPath = `projects/${GCLOUD_PROJECT}/locations/${GCLOUD_REGION}/publishers/google/models/${DISCOVERY_ENGINE_EMBEDDING_MODEL}`;
	}

	async generateEmbedding(text: string, taskType: string): Promise<number[]> {
		const functionName = 'VertexAITextEmbeddingService.generateEmbedding';
		if (!text || text.trim() === '') {
			logger.warn({ functionName, taskType }, 'Attempted to generate embedding for empty text. Returning empty vector.');
			return [];
		}
		const results = await this.generateEmbeddings([text], taskType);
		if (results.length > 0 && results[0]) {
			return results[0];
		}
		return [];
	}

	async generateEmbeddings(texts: string[], taskType: string): Promise<(number[] | null)[]> {
		const functionName = 'VertexAITextEmbeddingService.generateEmbeddings';
		if (!texts || texts.length === 0) {
			logger.warn({ functionName, taskType }, 'Attempted to generate embeddings for empty text array. Returning empty array.');
			return [];
		}

		const allResults: (number[] | null)[] = new Array(texts.length).fill(null);
		const subBatchSize = EMBEDDING_API_BATCH_SIZE;

		for (let i = 0; i < texts.length; i += subBatchSize) {
			const subBatchTexts = texts.slice(i, i + subBatchSize);
			const subBatchIndices = Array.from({ length: subBatchTexts.length }, (_, k) => i + k);

			const batchTokens = subBatchTexts.reduce((sum, text) => sum + countTokensSync(text), 0);

			// Rate limiting logic
			while (true) {
				let now = Date.now();
				const oneMinuteAgo = now - 60_000;

				// Prune old history
				while (this.tokenUsageHistory.length > 0 && this.tokenUsageHistory[0].timestamp < oneMinuteAgo) {
					this.tokenUsageHistory.shift();
				}

				const currentTokensInLastMinute = this.tokenUsageHistory.reduce((sum, record) => sum + record.tokens, 0);

				if (currentTokensInLastMinute + batchTokens > TOKENS_PER_MINUTE_QUOTA) {
					const oldestTimestamp = this.tokenUsageHistory.length > 0 ? this.tokenUsageHistory[0].timestamp : now;
					const timeToWait = oldestTimestamp + 60_000 - now + 1000;

					if (timeToWait > 0) {
						logger.warn(`Token quota will be exceeded. Waiting for ${Math.round(timeToWait / 1000)}s to avoid hitting the limit.`);
						await sleep(timeToWait);
					}
					// After waiting, re-evaluate in the next loop iteration
				} else {
					// We have capacity, break the while loop and proceed
					break;
				}
			}

			this.tokenUsageHistory.push({ timestamp: Date.now(), tokens: batchTokens });

			const instances = subBatchTexts.map((text) => {
				if (!text || text.trim() === '') {
					// This case should ideally be pre-filtered or handled by caller,

			const request: PredictRequest = {
				endpoint: this.endpointPath,
				instances: instances,
				// discoveryengine datastore only supports 768 dimensions, even though gemini-embedding-001 can generate 3072 dimensions
				parameters: helpers.toValue({ outputDimensionality: 768 }),
			};

			const subBatchEmbeddings: (number[] | null)[] = new Array(subBatchTexts.length).fill(null);

			for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
				logger.debug(
					{ functionName, taskType, subBatchSize: subBatchTexts.length, attempt: attempt + 1, maxRetries: MAX_RETRIES, globalStartIndex: i },
					`Requesting embeddings for sub-batch from Vertex AI (attempt ${attempt + 1}/${MAX_RETRIES})`,
				);
				try {
					const [response] = await this.client.predict(request);

					if (!response.predictions || response.predictions.length !== subBatchTexts.length) {
						logger.error(
							{ response, functionName, taskType, expectedCount: subBatchTexts.length, receivedCount: response.predictions?.length },
							'Mismatched predictions count from Vertex AI or empty/invalid predictions structure.',
						);
						// This is a batch-level error, mark all in sub-batch as null if retries exhausted
						if (attempt === MAX_RETRIES - 1) throw new Error('Mismatched or invalid prediction structure from Vertex AI for sub-batch.');
						// Continue to retry
					} else {
						for (let j = 0; j < response.predictions.length; j++) {
							const prediction = response.predictions[j] as protos.google.protobuf.IValue;
							const embeddingValue = prediction?.structValue?.fields?.embeddings?.structValue?.fields?.values;

							if (!embeddingValue?.listValue?.values) {
								logger.warn(
									{ prediction, functionName, taskType, textIndexInSubBatch: j, globalTextIndex: subBatchIndices[j] },
									'Empty or invalid embedding structure for a text in sub-batch.',
								);
								subBatchEmbeddings[j] = null; // Mark as null for this specific text
							} else {
								const embedding = embeddingValue.listValue.values.map((v) => v.numberValue as number);
								if (embedding.some((n) => typeof n !== 'number' || Number.isNaN(n))) {
									logger.warn(
										{ prediction, functionName, taskType, textIndexInSubBatch: j, globalTextIndex: subBatchIndices[j] },
										'Invalid data type or NaN in embedding vector for a text in sub-batch.',
									);
									subBatchEmbeddings[j] = null;
								} else {
									subBatchEmbeddings[j] = embedding;
								}
							}
						}
						// Successfully processed this sub-batch
						break; // Exit retry loop for this sub-batch
					}
				} catch (error: any) {
					const delay = INITIAL_RETRY_DELAY_MS * RETRY_DELAY_MULTIPLIER ** attempt;
					logger.error(
						{
							err: { message: error.message, stack: error.stack, details: error.details },
							attempt: attempt + 1,
							maxRetries: MAX_RETRIES,
							functionName,
							taskType,
							delay,
							globalStartIndex: i,
						},
						`Error in ${functionName} for sub-batch (attempt ${attempt + 1}/${MAX_RETRIES}). Retrying in ${delay}ms...`,
					);

					if (attempt < MAX_RETRIES - 1) {
						await sleep(delay);
					} else {
						logger.error(
							{ err: { message: error.message, stack: error.stack, details: error.details }, functionName, taskType, globalStartIndex: i },
							`All ${MAX_RETRIES} retries failed for sub-batch in ${functionName}. Marking all in sub-batch as null.`,
						);
						// Error already thrown by the last attempt or will be implicitly handled by subBatchEmbeddings remaining null
					}
				}
			} // End retry loop for sub-batch

			// Assign results from subBatchEmbeddings to the correct positions in allResults
			for (let k = 0; k < subBatchEmbeddings.length; k++) {
				allResults[subBatchIndices[k]] = subBatchEmbeddings[k];
			}
		} // End loop over sub-batches

		logger.debug(
			{ functionName, taskType, totalTexts: texts.length, successfulEmbeddings: allResults.filter((r) => r !== null).length },
			'Finished generating embeddings for all texts.',
		);
		return allResults;
	}
}

// Function to select the appropriate embedding model
let serviceInstance: TextEmbeddingService | null = null;
export function getEmbeddingService(): TextEmbeddingService {
	if (!serviceInstance) {
		serviceInstance = new VertexAITextEmbeddingService();
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
	// logger.debug(`Generating embedding for text length: ${text.length}, task type: ${taskType}`);
	if (!text || text.trim() === '') {
		logger.warn({ functionName, taskType }, 'Attempted to generate embedding for empty text. Returning empty vector.');
		return [];
	}
	try {
		const embedder = getEmbeddingService();
		const embedding = await embedder.generateEmbedding(text, taskType);
		if (!Array.isArray(embedding)) {
			// This case should ideally be handled by the retry logic within VertexAITextEmbeddingService
			// or if a different embedder implementation returns non-array.
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
