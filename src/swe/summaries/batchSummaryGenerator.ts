/**
 * Batch summary generator using Vertex AI Batch Prediction API.
 *
 * This module provides batch processing for file/folder summaries, offering
 * 50% cost savings compared to real-time LLM calls.
 *
 * Workflow:
 * 1. Collect all files that need summaries
 * 2. Generate prompts for each file
 * 3. Submit batch job to Vertex AI
 * 4. Poll for completion
 * 5. Parse results and write summary files
 */

import { createHash } from 'node:crypto';
import path, { basename, dirname, join } from 'node:path';
import { typedaiDirName } from '#app/appDirs';
import { extractJsonResult } from '#llm/responseParsers';
import {
	type BatchFileInfo,
	type BatchJobState,
	type BatchPredictionRequest,
	type BatchPredictionResponse,
	VertexBatchClient,
	type VertexBatchConfig,
	aggregateBatchCosts,
	createJsonBatchRequest,
	ensureBatchEnvironment,
	extractBatchResponseText,
	logAndRecordBatchCosts,
} from '#llm/services/vertexBatch';
import { logger } from '#o11y/logger';
import { withActiveSpan } from '#o11y/trace';
import type { IFileSystemService } from '#shared/files/fileSystemService';
import type { Summary } from './llmSummaries';

// ============================================================================
// Batch Job State Persistence
// ============================================================================

const BATCH_STATE_FILE = '.typedai/batch-job-state.json';
const BATCH_LOCK_FILE = '.typedai/batch-job.lock';
/** Lock expires after 24 hours (batch jobs can run this long) */
const LOCK_EXPIRY_MS = 24 * 60 * 60 * 1000;

interface LockInfo {
	timestamp: number;
	pid: number;
}

/**
 * Attempts to acquire a lock for batch job submission.
 * Prevents concurrent submissions from overwriting each other's state.
 * @returns true if lock acquired, false if another process holds the lock
 */
export async function acquireBatchLock(fss: IFileSystemService): Promise<boolean> {
	const lockPath = join(fss.getWorkingDirectory(), BATCH_LOCK_FILE);
	try {
		// Check if lock exists and is recent
		if (await fss.fileExists(lockPath)) {
			try {
				const content = await fss.readFile(lockPath);
				const lockInfo: LockInfo = JSON.parse(content);
				const lockAge = Date.now() - lockInfo.timestamp;

				if (lockAge < LOCK_EXPIRY_MS) {
					logger.warn({ lockPath, lockAge: `${Math.round(lockAge / 1000 / 60)}m`, pid: lockInfo.pid }, 'Batch lock held by another process');
					return false; // Lock is still valid
				}
				logger.info({ lockPath, lockAge: `${Math.round(lockAge / 1000 / 60 / 60)}h` }, 'Stale lock found, overwriting');
			} catch {
				// Lock file corrupted, overwrite it
				logger.warn({ lockPath }, 'Corrupted lock file, overwriting');
			}
		}

		// Create/update lock file
		const lockInfo: LockInfo = { timestamp: Date.now(), pid: process.pid };
		await fss.writeFile(lockPath, JSON.stringify(lockInfo));
		logger.debug({ lockPath }, 'Acquired batch lock');
		return true;
	} catch (e) {
		logger.error({ error: e, lockPath }, 'Failed to acquire batch lock');
		return false;
	}
}

/**
 * Releases the batch job lock.
 */
export async function releaseBatchLock(fss: IFileSystemService): Promise<void> {
	const lockPath = join(fss.getWorkingDirectory(), BATCH_LOCK_FILE);
	try {
		await fss.deleteFile(lockPath);
		logger.debug({ lockPath }, 'Released batch lock');
	} catch {
		// Lock file might not exist, that's fine
	}
}

/**
 * Saves the batch job state to disk for resume capability.
 */
export async function saveBatchJobState(fss: IFileSystemService, state: BatchJobState): Promise<void> {
	const statePath = join(fss.getWorkingDirectory(), BATCH_STATE_FILE);
	await fss.writeFile(statePath, JSON.stringify(state, null, 2));
	logger.info({ jobId: state.jobId, statePath }, 'Saved batch job state');
}

/**
 * Loads the batch job state from disk.
 * @returns The batch job state, or null if no state file exists
 * @throws Error if the state file exists but is corrupted or unreadable
 */
export async function loadBatchJobState(fss: IFileSystemService): Promise<BatchJobState | null> {
	const statePath = join(fss.getWorkingDirectory(), BATCH_STATE_FILE);
	try {
		const content = await fss.readFile(statePath);
		return JSON.parse(content) as BatchJobState;
	} catch (e: any) {
		// File doesn't exist - no pending job
		if (e.code === 'ENOENT') {
			return null;
		}
		// JSON parse error - file is corrupted
		if (e instanceof SyntaxError) {
			logger.error({ error: e, statePath }, 'Batch job state file is corrupted - consider deleting it');
			throw new Error(`Batch job state file is corrupted: ${statePath}`);
		}
		// Other errors (permission denied, etc.)
		logger.error({ error: e, statePath }, 'Failed to read batch job state');
		throw e;
	}
}

/**
 * Clears the batch job state from disk and releases the lock.
 */
export async function clearBatchJobState(fss: IFileSystemService): Promise<void> {
	const statePath = join(fss.getWorkingDirectory(), BATCH_STATE_FILE);
	try {
		await fss.deleteFile(statePath);
		logger.debug('Cleared batch job state');
	} catch {
		// File doesn't exist, that's fine
	}
	// Also release the lock since the job is complete
	await releaseBatchLock(fss);
}

/**
 * Checks if there's a pending batch job that can be resumed.
 */
export async function hasPendingBatchJob(fss: IFileSystemService): Promise<boolean> {
	const state = await loadBatchJobState(fss);
	if (!state) return false;

	// Check if the job is still in progress
	const terminalStates = ['JOB_STATE_SUCCEEDED', 'JOB_STATE_FAILED', 'JOB_STATE_CANCELLED', 'JOB_STATE_EXPIRED'];
	return !terminalStates.includes(state.state);
}

/** Information about a file to be summarized */
export interface FileSummaryRequest {
	/** Absolute path to the file */
	filePath: string;
	/** Relative path from working directory */
	relativePath: string;
	/** File contents */
	contents: string;
	/** Content hash for change detection */
	contentHash: string;
	/** Parent folder summaries for context */
	parentSummaries: Summary[];
}

/** Result of batch summary generation */
export interface BatchSummaryResult {
	/** Total files processed */
	totalFiles: number;
	/** Successfully generated summaries */
	successCount: number;
	/** Failed summaries */
	failureCount: number;
	/** Files that were skipped (up-to-date) */
	skippedCount: number;
	/** Job ID for reference */
	jobId?: string;
	/** Summaries generated */
	summaries: Map<string, Summary>;
}

/** Result of processing batch responses */
interface ProcessedResponses {
	summaries: Map<string, Summary>;
	successCount: number;
	failureCount: number;
}

/**
 * Processes batch prediction responses and extracts summaries.
 * Shared by both generateBatchSummaries and resumeBatchJob.
 */
function processBatchResponses(responses: BatchPredictionResponse[], fileMapping: Record<string, BatchFileInfo>): ProcessedResponses {
	const summaries = new Map<string, Summary>();
	let successCount = 0;
	let failureCount = 0;

	for (const response of responses) {
		const fileInfo = fileMapping[response.customId];
		if (!fileInfo) {
			logger.warn({ customId: response.customId }, 'Response for unknown file');
			continue;
		}

		const text = extractBatchResponseText(response);
		if (!text) {
			failureCount++;
			continue;
		}

		try {
			const parsed = extractJsonResult(text) as { short: string; long: string };
			summaries.set(fileInfo.path, {
				path: fileInfo.path,
				short: parsed.short,
				long: parsed.long,
				meta: { hash: fileInfo.hash },
			});
			successCount++;
		} catch (e) {
			logger.warn({ customId: response.customId, error: e }, 'Failed to parse summary response');
			failureCount++;
		}
	}

	return { summaries, successCount, failureCount };
}

/**
 * Generates the file summary prompt (extracted from llmSummaries.ts for reuse).
 */
export function buildFileSummaryPrompt(fileContents: string, parentSummaries: Summary[]): string {
	let parentSummaryText = '';
	if (parentSummaries.length) {
		parentSummaryText = '<parent-summaries>\n';
		for (const summary of parentSummaries) {
			parentSummaryText += `<parent-summary path="${summary.path}">\n${summary.long}\n</parent-summary>\n`;
		}
		parentSummaryText += '</parent-summaries>\n\n';
	}

	return `Analyze this source code file and generate a factual, concise summary:

${parentSummaryText}
<source-code>
${fileContents}
</source-code>

Generate two summaries in JSON format:

SHORT SUMMARY:
- Maximum 15 words
- State what the file defines/implements/exports
- Omit filler words like "This file", "The file's main", "It features"
- Start directly with the subject (e.g., "API routes for...", "Service handling...", "Utilities for...")

LONG SUMMARY:
- Maximum 3 concise sentences
- List specific exports: classes, functions, routes, components, types
- Name key dependencies or patterns used
- Avoid subjective commentary (no "demonstrates quality", "commitment to", "plays a crucial role")
- Avoid generic phrases (no "provides a structured approach", "ensures type safety")
- Be factual and specific - focus on WHAT, not WHY or evaluation

CRITICAL JSON FORMATTING:
- Do NOT use backticks (\`) anywhere in the JSON output
- Reference code elements without markdown formatting (e.g., "parseFunctionCallsXml" not "\`parseFunctionCallsXml\`")
- Use plain text for all function names, class names, and code references

Examples of good vs bad:
❌ "The file's organization demonstrates commitment to code quality"
✅ "Exports createUser, deleteUser, updateUser functions"

❌ "Provides a structured approach to API development"
✅ "Defines 9 API routes using defineApiRoute helper"

❌ "Exports \`parseXml\` and \`parseJson\` functions"
✅ "Exports parseXml and parseJson functions"

Respond only with JSON in this format:
{
  "short": "Direct subject-focused summary under 15 words",
  "long": "Factual list of exports, dependencies, and patterns in 2-3 sentences"
}`;
}

/**
 * Generates the folder summary prompt.
 */
export function buildFolderSummaryPrompt(combinedSummary: string, parentSummaries: Summary[]): string {
	let parentSummaryText = '';
	if (parentSummaries.length) {
		parentSummaryText = '<parent-summaries>\n';
		for (const summary of parentSummaries) {
			parentSummaryText += `<parent-summary path="${summary.path}">\n${summary.long}\n</parent-summary>\n`;
		}
		parentSummaryText += '</parent-summaries>\n\n';
	}

	return `Analyze the following summaries of files and subfolders within this directory:

${parentSummaryText}
<summaries>
${combinedSummary}
</summaries>

Generate a factual, concise folder summary:

SHORT SUMMARY:
- Maximum 15 words
- State the folder's primary purpose/domain
- Start directly with the subject (e.g., "Authentication services and middleware", "API route definitions", "Database models and schemas")
- Omit "This folder", "Contains", "Includes"

LONG SUMMARY:
- Maximum 4 concise sentences
- List the main file/subfolder categories and their purposes
- Identify common patterns or shared dependencies
- State the folder's domain or responsibility
- Avoid subjective commentary (no "plays a crucial role", "demonstrates organization")
- Avoid generic phrases (no "provides functionality for", "ensures consistency")
- Be factual and specific

CRITICAL JSON FORMATTING:
- Do NOT use backticks (\`) anywhere in the JSON output
- Reference code elements without markdown formatting (e.g., "AuthService" not "\`AuthService\`")
- Use plain text for all function names, class names, file names, and code references

# Examples of good vs bad summaries:

❌ "This folder plays a crucial role in the project's authentication architecture"
✅ "Authentication: JWT middleware, session management, OAuth providers"

❌ "The folder demonstrates well-organized code structure"
✅ "Contains 5 route definition files and 3 validation schemas"

❌ "Contains \`userService.ts\` and \`authService.ts\`"
✅ "Contains userService.ts and authService.ts"

Respond only with JSON in this format:
{
  "short": "Direct domain/purpose under 15 words",
  "long": "Factual list of contents and patterns in 3-4 sentences"
}`;
}

function hash(content: string): string {
	return createHash('md5').update(content).digest('hex');
}

function getSummaryFileName(relativePath: string): string {
	const fileName = basename(relativePath);
	const dirPath = dirname(relativePath);
	return join(typedaiDirName, 'docs', dirPath, `${fileName}.json`);
}

/**
 * Batch summary generator using Vertex AI Batch Prediction.
 */
export class BatchSummaryGenerator {
	private readonly batchClient: VertexBatchClient;
	private readonly fss: IFileSystemService;
	private readonly workingDir: string;
	/** Cache for parent summaries to avoid repeated disk reads */
	private readonly parentSummaryCache = new Map<string, Summary[]>();

	constructor(fss: IFileSystemService, batchConfig?: Partial<VertexBatchConfig>) {
		this.fss = fss;
		this.workingDir = fss.getWorkingDirectory();
		this.batchClient = new VertexBatchClient(batchConfig);
	}

	/**
	 * Collects files that need summaries (new or changed).
	 *
	 * @param filePaths - Array of absolute file paths to process
	 * @returns Array of files needing summaries
	 */
	async collectFilesNeedingSummaries(filePaths: string[]): Promise<FileSummaryRequest[]> {
		const requests: FileSummaryRequest[] = [];

		for (const filePath of filePaths) {
			const relativePath = path.relative(this.workingDir, filePath);
			const summaryFilePath = getSummaryFileName(relativePath);

			let fileContents: string;
			try {
				fileContents = await this.fss.readFile(filePath);
			} catch (e) {
				logger.warn({ filePath, error: e }, 'Failed to read file, skipping');
				continue;
			}

			const contentHash = hash(fileContents);

			// Check if summary exists and is up-to-date
			if (await this.fss.fileExists(summaryFilePath)) {
				try {
					const summaryContent = await this.fss.readFile(summaryFilePath);
					const existingSummary: Summary = JSON.parse(summaryContent);
					if (existingSummary.meta?.hash === contentHash) {
						logger.debug({ relativePath }, 'Summary up to date, skipping');
						continue;
					}
				} catch (e) {
					// Summary file is corrupted, regenerate
					logger.debug({ relativePath, error: e }, 'Failed to read existing summary, will regenerate');
				}
			}

			// Get parent summaries for context
			const parentSummaries = await this.getParentSummaries(dirname(filePath));

			requests.push({
				filePath,
				relativePath,
				contents: fileContents,
				contentHash,
				parentSummaries,
			});
		}

		return requests;
	}

	/**
	 * Generates summaries for files using batch prediction.
	 *
	 * @param fileRequests - Files to summarize
	 * @param jobName - Name for the batch job
	 * @returns Batch summary result
	 */
	async generateBatchSummaries(fileRequests: FileSummaryRequest[], jobName = 'summary-batch'): Promise<BatchSummaryResult> {
		return withActiveSpan('generateBatchSummaries', async (span) => {
			span.setAttribute('fileCount', fileRequests.length);

			if (fileRequests.length === 0) {
				return {
					totalFiles: 0,
					successCount: 0,
					failureCount: 0,
					skippedCount: 0,
					summaries: new Map(),
				};
			}

			// Build batch requests
			const batchRequests: BatchPredictionRequest[] = fileRequests.map((req) => {
				const prompt = buildFileSummaryPrompt(req.contents, req.parentSummaries);
				return createJsonBatchRequest(req.relativePath, prompt);
			});

			logger.info({ requestCount: batchRequests.length, jobName }, 'Submitting batch summary job');

			// Submit and wait for completion
			const jobId = await this.batchClient.submitBatchJob(batchRequests, jobName);
			span.setAttribute('jobId', jobId);

			const responses = await this.batchClient.waitForJobCompletion(jobId);

			// Calculate and log batch costs (50% discount applied)
			const config = this.batchClient.getConfig();
			const costStats = aggregateBatchCosts(responses, config.model);
			logAndRecordBatchCosts(costStats, config.model, jobId);

			// Create file mapping for processing
			const fileMapping: Record<string, BatchFileInfo> = {};
			for (const req of fileRequests) {
				fileMapping[req.relativePath] = {
					path: req.relativePath,
					hash: req.contentHash,
				};
			}

			// Process responses using shared function
			const { summaries, successCount, failureCount } = processBatchResponses(responses, fileMapping);

			span.setAttributes({
				successCount,
				failureCount,
			});

			return {
				totalFiles: fileRequests.length,
				successCount,
				failureCount,
				skippedCount: 0,
				jobId,
				summaries,
			};
		});
	}

	/**
	 * Writes generated summaries to the file system.
	 */
	async writeSummaries(summaries: Map<string, Summary>): Promise<void> {
		for (const [relativePath, summary] of summaries) {
			const summaryFilePath = getSummaryFileName(relativePath);
			await this.fss.writeFile(summaryFilePath, JSON.stringify(summary, null, 2));
			logger.debug({ relativePath }, 'Wrote summary file');
		}
	}

	/**
	 * Full batch summary generation workflow.
	 *
	 * @param filePaths - Files to process
	 * @param jobName - Name for the batch job
	 * @returns Batch summary result
	 */
	async processFiles(filePaths: string[], jobName = 'summary-batch'): Promise<BatchSummaryResult> {
		return withActiveSpan('batchProcessFiles', async (span) => {
			span.setAttribute('inputFileCount', filePaths.length);

			// Collect files needing summaries
			const fileRequests = await this.collectFilesNeedingSummaries(filePaths);
			const skippedCount = filePaths.length - fileRequests.length;

			span.setAttributes({
				filesToProcess: fileRequests.length,
				skippedCount,
			});

			if (fileRequests.length === 0) {
				logger.info('All summaries up to date, nothing to process');
				return {
					totalFiles: filePaths.length,
					successCount: 0,
					failureCount: 0,
					skippedCount,
					summaries: new Map(),
				};
			}

			// Generate summaries
			const result = await this.generateBatchSummaries(fileRequests, jobName);
			result.skippedCount = skippedCount;

			// Write summaries to disk
			await this.writeSummaries(result.summaries);

			logger.info(
				{
					totalFiles: result.totalFiles,
					successCount: result.successCount,
					failureCount: result.failureCount,
					skippedCount: result.skippedCount,
				},
				'Batch summary generation complete',
			);

			return result;
		});
	}

	/**
	 * Gets parent folder summaries for context.
	 * Uses caching to avoid repeated disk reads for files in the same folder.
	 */
	private async getParentSummaries(folderPath: string): Promise<Summary[]> {
		// Check cache first
		const cacheKey = folderPath;
		if (this.parentSummaryCache.has(cacheKey)) {
			return this.parentSummaryCache.get(cacheKey)!;
		}

		const parentSummaries: Summary[] = [];
		let currentPath = dirname(folderPath);

		while (currentPath !== '.' && path.relative(this.workingDir, currentPath) !== '') {
			const relativeCurrentPath = path.relative(this.workingDir, currentPath);
			const summaryPath = join(typedaiDirName, 'docs', relativeCurrentPath, '_index.json');

			if (await this.fss.fileExists(summaryPath)) {
				try {
					const summaryContent = await this.fss.readFile(summaryPath);
					parentSummaries.unshift(JSON.parse(summaryContent));
				} catch (e) {
					logger.warn({ summaryPath, error: e }, 'Failed to read parent summary');
					break;
				}
			} else {
				break;
			}
			currentPath = dirname(currentPath);
		}

		// Store in cache
		this.parentSummaryCache.set(cacheKey, parentSummaries);
		return parentSummaries;
	}
}

/**
 * Creates a batch summary generator.
 */
export function createBatchSummaryGenerator(fss: IFileSystemService, batchConfig?: Partial<VertexBatchConfig>): BatchSummaryGenerator {
	return new BatchSummaryGenerator(fss, batchConfig);
}

// ============================================================================
// Resume Functionality
// ============================================================================

export interface ResumeResult {
	/** Whether a job was found to resume */
	found: boolean;
	/** Status of the resumed job */
	status?: 'pending' | 'running' | 'succeeded' | 'failed' | 'cancelled' | 'expired';
	/** Result if the job completed */
	result?: BatchSummaryResult;
	/** Error message if failed */
	error?: string;
	/** The job ID that was checked */
	jobId?: string;
	/** How long the job has been running */
	elapsedTime?: string;
}

/**
 * Resumes a pending batch job and retrieves results if completed.
 *
 * @param fss - File system service
 * @param batchConfig - Optional batch configuration override
 * @returns Resume result with status and results if available
 */
export async function resumeBatchJob(fss: IFileSystemService, batchConfig?: Partial<VertexBatchConfig>): Promise<ResumeResult> {
	const state = await loadBatchJobState(fss);
	if (!state) {
		return { found: false };
	}

	const batchClient = new VertexBatchClient(state.config);

	try {
		const jobStatus = await batchClient.getJobStatus(state.jobId);

		// Calculate elapsed time
		const submittedAt = new Date(state.submittedAt);
		const now = new Date();
		const elapsedMs = now.getTime() - submittedAt.getTime();
		const elapsedHours = Math.floor(elapsedMs / (1000 * 60 * 60));
		const elapsedMinutes = Math.floor((elapsedMs % (1000 * 60 * 60)) / (1000 * 60));
		const elapsedTime = elapsedHours > 0 ? `${elapsedHours}h ${elapsedMinutes}m` : `${elapsedMinutes}m`;

		// Update state with latest status
		state.state = jobStatus.state;
		state.lastCheckedAt = new Date().toISOString();
		await saveBatchJobState(fss, state);

		logger.info({ jobId: state.jobId, state: jobStatus.state, elapsedTime }, 'Batch job status');

		if (jobStatus.state === 'JOB_STATE_SUCCEEDED') {
			// Job completed - retrieve results
			if (!jobStatus.outputInfo?.gcsOutputDirectory) {
				await clearBatchJobState(fss);
				return {
					found: true,
					status: 'succeeded',
					jobId: state.jobId,
					elapsedTime,
					error: 'Job succeeded but no output directory found',
				};
			}

			const responses = await batchClient.readResultsFromGcs(jobStatus.outputInfo.gcsOutputDirectory);

			// Calculate and log batch costs (50% discount applied)
			const costStats = aggregateBatchCosts(responses, state.config.model);
			logAndRecordBatchCosts(costStats, state.config.model, state.jobId);

			// Process responses using shared function
			const { summaries, successCount, failureCount } = processBatchResponses(responses, state.fileMapping);

			// Write summaries to disk
			for (const [relativePath, summary] of summaries) {
				const summaryFilePath = getSummaryFileName(relativePath);
				await fss.writeFile(summaryFilePath, JSON.stringify(summary, null, 2));
			}

			// Clear the state file
			await clearBatchJobState(fss);

			return {
				found: true,
				status: 'succeeded',
				jobId: state.jobId,
				elapsedTime,
				result: {
					totalFiles: state.requestCount,
					successCount,
					failureCount,
					skippedCount: 0,
					jobId: state.jobId,
					summaries,
				},
			};
		}

		if (jobStatus.state === 'JOB_STATE_FAILED') {
			await clearBatchJobState(fss);
			return {
				found: true,
				status: 'failed',
				jobId: state.jobId,
				elapsedTime,
				error: jobStatus.error?.message ?? 'Unknown error',
			};
		}

		if (jobStatus.state === 'JOB_STATE_CANCELLED') {
			await clearBatchJobState(fss);
			return {
				found: true,
				status: 'cancelled',
				jobId: state.jobId,
				elapsedTime,
			};
		}

		if (jobStatus.state === 'JOB_STATE_EXPIRED') {
			await clearBatchJobState(fss);
			return {
				found: true,
				status: 'expired',
				jobId: state.jobId,
				elapsedTime,
			};
		}

		// Job still in progress
		const status = jobStatus.state === 'JOB_STATE_RUNNING' ? 'running' : 'pending';
		return {
			found: true,
			status,
			jobId: state.jobId,
			elapsedTime,
		};
	} catch (e) {
		logger.error({ error: e, jobId: state.jobId }, 'Failed to check batch job status');
		return {
			found: true,
			status: 'failed',
			jobId: state.jobId,
			error: e instanceof Error ? e.message : String(e),
		};
	}
}

/**
 * Submits a batch job with persistence for resume capability.
 * This version saves state so the job can be resumed if the process dies.
 * @throws Error if another batch job is already in progress
 */
export async function submitBatchJobWithPersistence(
	fss: IFileSystemService,
	fileRequests: FileSummaryRequest[],
	jobName = 'summary-batch',
	batchConfig?: Partial<VertexBatchConfig>,
): Promise<{ jobId: string; requestCount: number }> {
	// Check for existing batch job before acquiring lock
	const existingState = await loadBatchJobState(fss);
	if (existingState) {
		const terminalStates = ['JOB_STATE_SUCCEEDED', 'JOB_STATE_FAILED', 'JOB_STATE_CANCELLED', 'JOB_STATE_EXPIRED'];
		if (!terminalStates.includes(existingState.state)) {
			throw new Error(`A batch job is already in progress: ${existingState.jobId}. Use 'pnpm summaries resume' to check status.`);
		}
	}

	// Acquire lock to prevent concurrent submissions
	const lockAcquired = await acquireBatchLock(fss);
	if (!lockAcquired) {
		throw new Error('Another batch submission is in progress. Please wait or check for stale lock files.');
	}

	try {
		// Ensure batch environment is set up
		const setup = await ensureBatchEnvironment(batchConfig);
		if (!setup.ready) {
			throw new Error(setup.error ?? 'Batch environment not ready');
		}

		const config: VertexBatchConfig = {
			projectId: setup.projectId!,
			region: setup.region!,
			bucket: setup.bucket!,
			model: batchConfig?.model ?? 'gemini-2.5-flash',
		};

		const batchClient = new VertexBatchClient(config);

		// Build batch requests
		const batchRequests: BatchPredictionRequest[] = fileRequests.map((req) => {
			const prompt = buildFileSummaryPrompt(req.contents, req.parentSummaries);
			return createJsonBatchRequest(req.relativePath, prompt);
		});

		// Create file mapping for resume (stores path and hash for each file)
		const fileMapping: Record<string, BatchFileInfo> = {};
		for (const req of fileRequests) {
			fileMapping[req.relativePath] = {
				path: req.relativePath,
				hash: req.contentHash,
			};
		}

		logger.info({ requestCount: batchRequests.length, jobName }, 'Submitting batch summary job with persistence');

		// Submit the job
		const jobId = await batchClient.submitBatchJob(batchRequests, jobName);

		// Save state for resume
		const state: BatchJobState = {
			jobId,
			jobName,
			submittedAt: new Date().toISOString(),
			state: 'JOB_STATE_PENDING',
			lastCheckedAt: new Date().toISOString(),
			config,
			requestCount: batchRequests.length,
			fileMapping,
		};

		await saveBatchJobState(fss, state);

		logger.info({ jobId, requestCount: batchRequests.length }, 'Batch job submitted successfully');

		return { jobId, requestCount: batchRequests.length };
	} catch (e) {
		// Release lock on error so another submission can try
		await releaseBatchLock(fss);
		throw e;
	}
	// Note: Lock is NOT released on success - it will be released when job completes in resumeBatchJob
}
