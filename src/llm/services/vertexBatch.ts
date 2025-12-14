/**
 * Vertex AI Batch Prediction API client for Gemini models.
 *
 * This module provides functionality to submit batch prediction jobs to Vertex AI,
 * which offers 50% cost savings compared to real-time inference.
 *
 * @see https://cloud.google.com/vertex-ai/generative-ai/docs/multimodal/batch-prediction-gemini
 */

import { execSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import * as readline from 'node:readline';
import { Storage } from '@google-cloud/storage';
import { GoogleAuth } from 'google-auth-library';
import { addCost } from '#agent/agentContext';
import { logger } from '#o11y/logger';
import { withActiveSpan } from '#o11y/trace';
import { sleep } from '#utils/async-utils';
import { envVar } from '#utils/env-var';

// ============================================================================
// Cost Tracking for Batch Predictions (50% discount)
// ============================================================================

/** Model pricing per million tokens (before batch discount) */
export interface ModelPricing {
	inputPerMillion: number;
	outputPerMillion: number;
	/** Cached input pricing (if applicable) */
	cachedInputPerMillion?: number;
}

/** Known Vertex AI model pricing */
const MODEL_PRICING: Record<string, ModelPricing> = {
	'gemini-2.5-flash': { inputPerMillion: 0.3, outputPerMillion: 2.5 },
	'gemini-2.5-flash-lite': { inputPerMillion: 0.1, outputPerMillion: 0.4 },
	'gemini-2.5-pro': { inputPerMillion: 1.25, outputPerMillion: 10 },
	'gemini-3-pro': { inputPerMillion: 2, outputPerMillion: 12 },
	'gemini-2.0-flash': { inputPerMillion: 0.1, outputPerMillion: 0.4 },
	'gemini-2.0-flash-lite': { inputPerMillion: 0.075, outputPerMillion: 0.3 },
};

/** Batch API discount (50% off standard pricing) */
const BATCH_DISCOUNT = 0.5;

/**
 * Calculates the cost for a batch prediction response.
 * Applies 50% batch discount automatically.
 */
export function calculateBatchCost(
	model: string,
	inputTokens: number,
	outputTokens: number,
	cachedInputTokens = 0,
): { inputCost: number; outputCost: number; totalCost: number } {
	// Find pricing for the model (try exact match first, then prefix match)
	let pricing = MODEL_PRICING[model];
	if (!pricing) {
		// Try to find by prefix (e.g., 'gemini-2.5-flash-preview-xxx' -> 'gemini-2.5-flash')
		for (const [key, value] of Object.entries(MODEL_PRICING)) {
			if (model.startsWith(key)) {
				pricing = value;
				break;
			}
		}
	}

	if (!pricing) {
		logger.warn({ model }, 'Unknown model for cost calculation, using gemini-2.5-flash pricing');
		pricing = MODEL_PRICING['gemini-2.5-flash']!;
	}

	// Calculate costs with batch discount
	const standardInputTokens = inputTokens - cachedInputTokens;
	const cachedRate = pricing.cachedInputPerMillion ?? pricing.inputPerMillion * 0.25; // Default 75% discount for cached

	const inputCost = ((standardInputTokens * pricing.inputPerMillion + cachedInputTokens * cachedRate) / 1_000_000) * BATCH_DISCOUNT;
	const outputCost = ((outputTokens * pricing.outputPerMillion) / 1_000_000) * BATCH_DISCOUNT;
	const totalCost = inputCost + outputCost;

	return { inputCost, outputCost, totalCost };
}

/** Aggregated cost statistics for a batch job */
export interface BatchCostStats {
	totalInputTokens: number;
	totalOutputTokens: number;
	totalCachedTokens: number;
	inputCost: number;
	outputCost: number;
	totalCost: number;
	requestCount: number;
	successCount: number;
	failureCount: number;
}

// ============================================================================
// GCloud and Bucket Detection
// ============================================================================

/**
 * Checks if gcloud CLI is installed and available.
 */
export function isGcloudInstalled(): boolean {
	try {
		execSync('gcloud --version', { stdio: 'pipe' });
		return true;
	} catch {
		return false;
	}
}

/**
 * Gets the current gcloud project ID.
 */
export function getGcloudProject(): string | null {
	try {
		const result = execSync('gcloud config get-value project', { stdio: 'pipe', encoding: 'utf-8' });
		const project = result.trim();
		return project && project !== '(unset)' ? project : null;
	} catch {
		return null;
	}
}

/**
 * Checks if a GCS bucket exists.
 */
export async function bucketExists(bucketName: string, projectId: string): Promise<boolean> {
	try {
		const storage = new Storage({ projectId });
		const [exists] = await storage.bucket(bucketName).exists();
		return exists;
	} catch (e) {
		logger.debug({ bucketName, error: e }, 'Error checking bucket existence');
		return false;
	}
}

/** Result of bucket creation operation */
export interface BucketCreationResult {
	success: boolean;
	error?: string;
}

/**
 * Creates a GCS bucket using gcloud CLI.
 * @returns Result indicating success or failure with error message
 */
export function createBucketWithGcloud(bucketName: string, projectId: string, region: string): BucketCreationResult {
	const cmd = `gcloud storage buckets create gs://${bucketName} --project=${projectId} --location=${region} --uniform-bucket-level-access`;
	logger.info({ bucketName, projectId, region }, 'Creating GCS bucket');
	try {
		execSync(cmd, { stdio: 'inherit' });
		return { success: true };
	} catch (e) {
		const errorMsg = e instanceof Error ? e.message : String(e);
		logger.error({ bucketName, projectId, region, error: e }, 'Failed to create GCS bucket');
		return { success: false, error: errorMsg };
	}
}

/**
 * Prompts user for Y/n confirmation.
 */
export async function promptYesNo(question: string): Promise<boolean> {
	const rl = readline.createInterface({
		input: process.stdin,
		output: process.stdout,
	});

	return new Promise((resolve) => {
		rl.question(`${question} (Y/n): `, (answer) => {
			rl.close();
			const normalized = answer.trim().toLowerCase();
			resolve(normalized === '' || normalized === 'y' || normalized === 'yes');
		});
	});
}

/** Discriminated union for batch setup result - ensures type safety */
export type BatchSetupResult = { ready: true; projectId: string; bucket: string; region: string } | { ready: false; error: string };

/**
 * Checks and sets up the batch processing environment.
 * - Verifies gcloud is installed
 * - Checks if bucket exists
 * - Offers to create bucket if it doesn't exist
 */
export async function ensureBatchEnvironment(config?: Partial<VertexBatchConfig>): Promise<BatchSetupResult> {
	// Check for gcloud
	if (!isGcloudInstalled()) {
		return {
			ready: false,
			error: 'gcloud CLI is not installed. Please install it from https://cloud.google.com/sdk/docs/install',
		};
	}

	// Get project ID
	const projectId = config?.projectId || process.env.GCLOUD_PROJECT || getGcloudProject();
	if (!projectId) {
		return {
			ready: false,
			error: 'No GCP project configured. Set GCLOUD_PROJECT environment variable or run "gcloud config set project <project-id>"',
		};
	}

	const region = config?.region || process.env.GCLOUD_REGION || 'us-central1';
	const bucketName = config?.bucket || process.env.VERTEX_BATCH_BUCKET || `${projectId}-vertex-batch`;

	// Check if bucket exists
	const exists = await bucketExists(bucketName, projectId);
	if (exists) {
		logger.info({ bucketName }, 'Batch bucket exists');
		return { ready: true, projectId, bucket: bucketName, region };
	}

	// Bucket doesn't exist - offer to create it
	logger.info({ bucketName, projectId, region }, 'Batch bucket does not exist, prompting user to create');

	const shouldCreate = await promptYesNo('Create this bucket now?');
	if (!shouldCreate) {
		return {
			ready: false,
			error: `Bucket gs://${bucketName} does not exist and user declined to create it`,
		};
	}

	const result = createBucketWithGcloud(bucketName, projectId, region);
	if (result.success) {
		logger.info({ bucketName }, 'Successfully created GCS bucket');
		return { ready: true, projectId, bucket: bucketName, region };
	}
	return {
		ready: false,
		error: `Failed to create bucket: ${result.error}`,
	};
}

// ============================================================================
// Batch Job State Persistence (for resume capability)
// ============================================================================

/** File info stored in batch job state for resume capability */
export interface BatchFileInfo {
	/** Relative file path */
	path: string;
	/** Content hash for change detection */
	hash: string;
}

/** Persisted state of a batch job for resume capability */
export interface BatchJobState {
	/** Vertex AI job ID (e.g., projects/xxx/locations/xxx/batchPredictionJobs/xxx) */
	jobId: string;
	/** Display name of the job */
	jobName: string;
	/** When the job was submitted */
	submittedAt: string;
	/** Current state of the job */
	state: JobState;
	/** Last time the state was checked */
	lastCheckedAt: string;
	/** Configuration used for the job */
	config: VertexBatchConfig;
	/** Number of requests in the batch */
	requestCount: number;
	/** Mapping of customId to file info (path + hash) for result processing */
	fileMapping: Record<string, BatchFileInfo>;
}

/** Request format for a single batch prediction item */
export interface BatchPredictionRequest {
	/** Unique identifier for this request (used to match responses) */
	customId: string;
	/** The prompt/request content */
	request: {
		contents: Array<{
			role: 'user' | 'model';
			parts: Array<{ text: string }>;
		}>;
		systemInstruction?: {
			parts: Array<{ text: string }>;
		};
		generationConfig?: {
			temperature?: number;
			topP?: number;
			topK?: number;
			maxOutputTokens?: number;
			responseMimeType?: string;
		};
	};
}

/** Response format for a single batch prediction result */
export interface BatchPredictionResponse {
	customId: string;
	status: 'success' | 'error';
	response?: {
		candidates: Array<{
			content: {
				parts: Array<{ text: string }>;
				role: string;
			};
			finishReason: string;
		}>;
		usageMetadata?: {
			promptTokenCount: number;
			candidatesTokenCount: number;
			totalTokenCount: number;
		};
	};
	error?: {
		code: number;
		message: string;
	};
}

/** Job state from Vertex AI */
export type JobState =
	| 'JOB_STATE_UNSPECIFIED'
	| 'JOB_STATE_QUEUED'
	| 'JOB_STATE_PENDING'
	| 'JOB_STATE_RUNNING'
	| 'JOB_STATE_SUCCEEDED'
	| 'JOB_STATE_FAILED'
	| 'JOB_STATE_CANCELLING'
	| 'JOB_STATE_CANCELLED'
	| 'JOB_STATE_PAUSED'
	| 'JOB_STATE_EXPIRED';

/** Batch prediction job status */
export interface BatchJobStatus {
	name: string;
	displayName: string;
	state: JobState;
	createTime: string;
	updateTime: string;
	startTime?: string;
	endTime?: string;
	error?: {
		code: number;
		message: string;
	};
	outputInfo?: {
		gcsOutputDirectory: string;
	};
}

export interface VertexBatchConfig {
	/** GCP project ID */
	projectId: string;
	/** Region for batch prediction (e.g., 'us-central1') */
	region: string;
	/** GCS bucket for input/output files */
	bucket: string;
	/** Model ID (e.g., 'gemini-2.5-flash') */
	model: string;
}

/** Default configuration from environment */
export function getDefaultVertexBatchConfig(): VertexBatchConfig {
	return {
		projectId: envVar('GCLOUD_PROJECT'),
		region: envVar('GCLOUD_REGION', 'us-central1'),
		bucket: envVar('VERTEX_BATCH_BUCKET', `${envVar('GCLOUD_PROJECT')}-vertex-batch`),
		model: envVar('VERTEX_BATCH_MODEL', 'gemini-2.5-flash'),
	};
}

/**
 * Vertex AI Batch Prediction client.
 *
 * Submits batch prediction jobs and retrieves results.
 */
export class VertexBatchClient {
	private readonly storage: Storage;
	private readonly auth: GoogleAuth;
	private readonly config: VertexBatchConfig;

	constructor(config?: Partial<VertexBatchConfig>) {
		const defaultConfig = getDefaultVertexBatchConfig();
		this.config = { ...defaultConfig, ...config };
		this.storage = new Storage({ projectId: this.config.projectId });
		this.auth = new GoogleAuth({
			scopes: ['https://www.googleapis.com/auth/cloud-platform'],
		});
	}

	/**
	 * Gets the current configuration.
	 */
	getConfig(): VertexBatchConfig {
		return { ...this.config };
	}

	/**
	 * Submits a batch prediction job.
	 *
	 * @param requests - Array of batch prediction requests
	 * @param jobName - Display name for the job
	 * @returns The job name/ID for polling
	 */
	async submitBatchJob(requests: BatchPredictionRequest[], jobName: string): Promise<string> {
		return withActiveSpan('submitVertexBatchJob', async (span) => {
			span.setAttributes({
				requestCount: requests.length,
				jobName,
				model: this.config.model,
			});

			// Generate unique input/output paths with UUID to prevent collisions
			const timestamp = Date.now();
			const uniqueId = randomUUID().slice(0, 8);
			const inputPath = `batch-input/${jobName}-${timestamp}-${uniqueId}.jsonl`;
			const outputPrefix = `batch-output/${jobName}-${timestamp}-${uniqueId}`;

			// Write requests to GCS as JSONL
			logger.info({ inputPath, requestCount: requests.length }, 'Writing batch requests to GCS');
			await this.writeRequestsToGcs(requests, inputPath);

			// Submit batch prediction job
			const jobId = await this.createBatchPredictionJob(jobName, inputPath, outputPrefix);

			span.setAttribute('jobId', jobId);
			logger.info({ jobId, jobName }, 'Batch prediction job submitted');

			return jobId;
		});
	}

	/**
	 * Polls for job completion and returns results.
	 *
	 * @param jobId - The batch job ID
	 * @param pollIntervalMs - Polling interval in milliseconds (default: 30s)
	 * @param maxWaitMs - Maximum wait time in milliseconds (default: 24h)
	 * @returns Array of batch prediction responses
	 */
	async waitForJobCompletion(jobId: string, pollIntervalMs = 30_000, maxWaitMs = 24 * 60 * 60 * 1000): Promise<BatchPredictionResponse[]> {
		return withActiveSpan('waitForVertexBatchJob', async (span) => {
			span.setAttribute('jobId', jobId);

			const startTime = Date.now();
			let lastState: JobState | undefined;

			while (Date.now() - startTime < maxWaitMs) {
				const status = await this.getJobStatus(jobId);

				if (status.state !== lastState) {
					logger.info({ jobId, state: status.state }, 'Batch job state changed');
					lastState = status.state;
				}

				if (status.state === 'JOB_STATE_SUCCEEDED') {
					span.setAttribute('finalState', status.state);
					if (status.outputInfo?.gcsOutputDirectory) {
						return this.readResultsFromGcs(status.outputInfo.gcsOutputDirectory);
					}
					throw new Error(`Job succeeded but no output directory found: ${jobId}`);
				}

				if (status.state === 'JOB_STATE_FAILED') {
					span.setAttribute('finalState', status.state);
					throw new Error(`Batch job failed: ${status.error?.message ?? 'Unknown error'}`);
				}

				if (status.state === 'JOB_STATE_CANCELLED' || status.state === 'JOB_STATE_EXPIRED') {
					span.setAttribute('finalState', status.state);
					throw new Error(`Batch job ${status.state}: ${jobId}`);
				}

				if (status.state === 'JOB_STATE_PAUSED') {
					logger.warn({ jobId }, 'Batch job is paused - may require manual intervention to resume');
					// Continue polling - job may be unpaused
				}

				await sleep(pollIntervalMs);
			}

			throw new Error(`Batch job timed out after ${maxWaitMs}ms: ${jobId}`);
		});
	}

	/**
	 * Submits a batch job and waits for completion.
	 *
	 * @param requests - Array of batch prediction requests
	 * @param jobName - Display name for the job
	 * @returns Array of batch prediction responses
	 */
	async submitAndWait(requests: BatchPredictionRequest[], jobName: string): Promise<BatchPredictionResponse[]> {
		const jobId = await this.submitBatchJob(requests, jobName);
		return this.waitForJobCompletion(jobId);
	}

	/**
	 * Gets the status of a batch prediction job.
	 */
	async getJobStatus(jobId: string): Promise<BatchJobStatus> {
		const client = await this.auth.getClient();
		const url = `https://${this.config.region}-aiplatform.googleapis.com/v1/${jobId}`;

		const response = await client.request({ url, method: 'GET' });
		return response.data as BatchJobStatus;
	}

	/**
	 * Cancels a running batch prediction job.
	 */
	async cancelJob(jobId: string): Promise<void> {
		const client = await this.auth.getClient();
		const url = `https://${this.config.region}-aiplatform.googleapis.com/v1/${jobId}:cancel`;

		await client.request({ url, method: 'POST' });
		logger.info({ jobId }, 'Batch job cancellation requested');
	}

	/**
	 * Writes batch requests to GCS as JSONL.
	 */
	private async writeRequestsToGcs(requests: BatchPredictionRequest[], gcsPath: string): Promise<void> {
		const bucket = this.storage.bucket(this.config.bucket);
		const file = bucket.file(gcsPath);
		// Add trailing newline for proper JSONL format
		const jsonlContent = `${requests.map((req) => JSON.stringify(req)).join('\n')}\n`;

		try {
			await file.save(jsonlContent, { contentType: 'application/jsonl' });
		} catch (e) {
			const fullPath = `gs://${this.config.bucket}/${gcsPath}`;
			logger.error({ gcsPath: fullPath, requestCount: requests.length, error: e }, 'Failed to write batch requests to GCS');
			throw new Error(`Failed to write batch requests to ${fullPath}: ${e instanceof Error ? e.message : String(e)}`);
		}
	}

	/**
	 * Reads batch results from GCS output directory.
	 * This is public to allow reading results when resuming a job.
	 */
	async readResultsFromGcs(outputDirectory: string): Promise<BatchPredictionResponse[]> {
		// Parse the GCS URI (gs://bucket/path)
		const match = outputDirectory.match(/^gs:\/\/([^/]+)\/(.+)$/);
		if (!match) {
			throw new Error(`Invalid GCS URI: ${outputDirectory}`);
		}

		const [, bucketName, prefix] = match;
		const bucket = this.storage.bucket(bucketName!);

		// List all files in the output directory
		const [files] = await bucket.getFiles({ prefix });

		const results: BatchPredictionResponse[] = [];

		for (const file of files) {
			if (file.name.endsWith('.jsonl')) {
				const [content] = await file.download();
				const lines = content.toString().split('\n').filter(Boolean);

				for (const line of lines) {
					try {
						const response = JSON.parse(line) as BatchPredictionResponse;
						results.push(response);
					} catch (e) {
						logger.warn({ line, error: e }, 'Failed to parse batch response line');
					}
				}
			}
		}

		logger.info({ resultCount: results.length, outputDirectory }, 'Read batch results from GCS');
		return results;
	}

	/**
	 * Creates a batch prediction job via the Vertex AI API.
	 */
	private async createBatchPredictionJob(displayName: string, inputPath: string, outputPrefix: string): Promise<string> {
		const client = await this.auth.getClient();
		const url = `https://${this.config.region}-aiplatform.googleapis.com/v1/projects/${this.config.projectId}/locations/${this.config.region}/batchPredictionJobs`;

		const requestBody = {
			displayName,
			model: `publishers/google/models/${this.config.model}`,
			inputConfig: {
				instancesFormat: 'jsonl',
				gcsSource: {
					uris: [`gs://${this.config.bucket}/${inputPath}`],
				},
			},
			outputConfig: {
				predictionsFormat: 'jsonl',
				gcsDestination: {
					outputUriPrefix: `gs://${this.config.bucket}/${outputPrefix}`,
				},
			},
		};

		const response = await client.request({
			url,
			method: 'POST',
			data: requestBody,
		});

		const job = response.data as { name: string };
		return job.name;
	}
}

/**
 * Creates a batch prediction request for JSON generation.
 *
 * @param customId - Unique identifier for this request
 * @param prompt - The prompt text
 * @param systemPrompt - Optional system prompt
 * @returns A batch prediction request object
 */
export function createJsonBatchRequest(customId: string, prompt: string, systemPrompt?: string): BatchPredictionRequest {
	const request: BatchPredictionRequest = {
		customId,
		request: {
			contents: [
				{
					role: 'user',
					parts: [{ text: prompt }],
				},
			],
			generationConfig: {
				responseMimeType: 'application/json',
				temperature: 0,
			},
		},
	};

	if (systemPrompt) {
		request.request.systemInstruction = {
			parts: [{ text: systemPrompt }],
		};
	}

	return request;
}

/**
 * Extracts text content from a batch prediction response.
 */
export function extractBatchResponseText(response: BatchPredictionResponse): string | null {
	if (response.status === 'error') {
		logger.warn({ customId: response.customId, error: response.error }, 'Batch request failed');
		return null;
	}

	const candidate = response.response?.candidates?.[0];
	if (!candidate) {
		logger.warn({ customId: response.customId }, 'No candidates in batch response');
		return null;
	}

	return candidate.content.parts.map((p) => p.text).join('');
}

/**
 * Aggregates cost statistics from a batch of responses.
 * Calculates total tokens and costs with 50% batch discount applied.
 *
 * @param responses - Array of batch prediction responses
 * @param model - Model name for pricing lookup
 * @returns Aggregated cost statistics
 */
export function aggregateBatchCosts(responses: BatchPredictionResponse[], model: string): BatchCostStats {
	const stats: BatchCostStats = {
		totalInputTokens: 0,
		totalOutputTokens: 0,
		totalCachedTokens: 0,
		inputCost: 0,
		outputCost: 0,
		totalCost: 0,
		requestCount: responses.length,
		successCount: 0,
		failureCount: 0,
	};

	for (const response of responses) {
		if (response.status === 'error') {
			stats.failureCount++;
			continue;
		}

		stats.successCount++;

		const usage = response.response?.usageMetadata;
		if (usage) {
			stats.totalInputTokens += usage.promptTokenCount || 0;
			stats.totalOutputTokens += usage.candidatesTokenCount || 0;
			// Note: cachedTokens would come from cachedContentTokenCount if available
		}
	}

	// Calculate costs with batch discount
	const cost = calculateBatchCost(model, stats.totalInputTokens, stats.totalOutputTokens, stats.totalCachedTokens);
	stats.inputCost = cost.inputCost;
	stats.outputCost = cost.outputCost;
	stats.totalCost = cost.totalCost;

	return stats;
}

/**
 * Logs batch cost statistics and optionally adds to agent context.
 *
 * @param stats - Aggregated cost statistics
 * @param model - Model name used
 * @param jobId - Optional job ID for logging context
 */
export function logAndRecordBatchCosts(stats: BatchCostStats, model: string, jobId?: string): void {
	logger.info(
		{
			jobId,
			model,
			totalInputTokens: stats.totalInputTokens,
			totalOutputTokens: stats.totalOutputTokens,
			inputCost: `$${stats.inputCost.toFixed(6)}`,
			outputCost: `$${stats.outputCost.toFixed(6)}`,
			totalCost: `$${stats.totalCost.toFixed(6)}`,
			requestCount: stats.requestCount,
			successCount: stats.successCount,
			failureCount: stats.failureCount,
			batchDiscount: '50%',
		},
		'Batch prediction costs (50% discount applied)',
	);

	// Add cost to agent context if active
	if (stats.totalCost > 0) {
		addCost(stats.totalCost);
	}
}
