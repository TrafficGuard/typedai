#!/usr/bin/env node

/**
 * CLI for managing file/folder summaries with Cloud SQL sync.
 *
 * Commands:
 *   pull    - Pull summaries from Cloud SQL to local cache
 *   push    - Push local summaries to Cloud SQL
 *   sync    - Full sync: pull → build → push (uses smart LLM selection)
 *   build   - Build summaries locally (no cloud sync)
 *   resume  - Resume a pending batch job and retrieve results
 *   status  - Show sync status
 *
 * Smart LLM Selection (default for sync/build):
 *   - If summary store is empty: Uses Vertex AI Batch Prediction (50% cost savings)
 *   - For incremental updates: Uses OpenAI Flex Nano (batch pricing) if available
 *   - Otherwise: Uses defaultLLMs().easy
 */

import pino from 'pino';
import { llms } from '#agent/agentContextUtils';
import { getFileSystem } from '#agent/agentContextUtils';
import { initApplicationContext } from '#app/applicationContext';
import { shutdownTrace } from '#fastify/trace-init/trace-init';
import { openAIFlexGPT5, openAIFlexGPT5Mini, openAIFlexGPT5Nano, openAIFlexLLMRegistry } from '#llm/multi-agent/openaiFlex';
import { mlxGptOss20b, mlxLLMRegistry } from '#llm/services/mlx';
import { ensurePostgresDockerRunning } from '#modules/postgres/ensureDockerPostgres';
import type { LLM } from '#shared/llm/llm.model';
import { hasPendingBatchJob, loadBatchJobState, resumeBatchJob } from '#swe/summaries/batchSummaryGenerator';
import {
	type SummaryMode,
	buildSummaries,
	buildSummariesWithSmartLlm,
	buildSummariesWithSync,
	isSummaryStoreEmpty,
	pullSummariesFromCloud,
	pushSummariesToCloud,
} from '#swe/summaries/summaryBuilder';
import { getSummaryStoreConfig, isCloudSqlEnabled, isPostgresEnabled } from '#swe/summaryStore/config';
import { getRepositoryId } from '#swe/summaryStore/repoId';
import { getSyncStatusMessage, loadSyncState } from '#swe/summaryStore/syncState';
import { loadCliEnvironment } from './envLoader';

const logger = pino({ name: 'SummariesCLI' });

function printUsage(): void {
	const mlxModels = mlxLLMRegistry().map((fn) => fn().getId());
	const flexModels = openAIFlexLLMRegistry().map((fn) => fn().getId());
	flexModels.push('gpt-5-nano'); // Add nano which isn't in registry

	console.log(`
Usage: pnpm summaries <command> [options]

Commands:
  pull     Pull summaries from Cloud SQL to local cache
  push     Push local summaries to Cloud SQL
  sync     Full sync: pull summaries, rebuild changed files, push updates
  build    Build summaries locally without cloud sync
  resume   Resume a pending batch job and retrieve results
  status   Show current sync status and configuration

Options:
  --help, -h           Show this help message
  --mode <mode>        Processing mode:
                         auto     - Use batch API if store empty, otherwise realtime (default)
                         batch    - Force Vertex AI Batch Prediction (50% cost savings)
                         realtime - Force real-time processing
  --llm <model>        Use specified LLM for real-time processing (overrides auto selection)
                       Special values: 'mlx-gpt-oss-20b' for local MLX inference
                       Available MLX models: ${mlxModels.join(', ')}
                       Available OpenAI Flex models: ${flexModels.join(', ')}

Smart LLM Selection (when --llm not specified):
  - Empty store: Uses Vertex AI Batch Prediction (50% savings, may take hours)
  - Incremental: Uses OpenAI Flex Nano (batch pricing) if OPENAI_API_KEY set
  - Fallback:    Uses defaultLLMs().easy

Configuration:
  Configure Cloud SQL in .typedai.json:
  {
    "summaryStore": {
      "type": "cloudsql",
      "googleCloud": {
        "projectId": "your-project",
        "region": "us-central1",
        "instanceConnectionName": "project:region:instance",
        "database": "summaries"
      }
    }
  }

  Or for local PostgreSQL:
  {
    "summaryStore": {
      "type": "postgres",
      "postgres": {
        "host": "localhost",
        "port": 5432,
        "user": "postgres",
        "password": "",
        "database": "summaries"
      }
    }
  }

  Or via environment variables:
    # Cloud SQL
    SUMMARY_STORE_TYPE=cloudsql
    SUMMARY_STORE_INSTANCE=project:region:instance
    SUMMARY_STORE_DATABASE=summaries

    # Local PostgreSQL
    DATABASE_TYPE=postgres
    DATABASE_HOST=localhost
    DATABASE_PORT=5432
    DATABASE_USER=postgres
    DATABASE_PASSWORD=
    DATABASE_NAME=summaries
`);
}

/**
 * Get mode from --mode flag or default to 'auto'
 */
function getModeFromArgs(args: string[]): SummaryMode {
	const modeIndex = args.indexOf('--mode');
	if (modeIndex === -1 || modeIndex === args.length - 1) {
		return 'auto';
	}

	const mode = args[modeIndex + 1] as string;
	if (mode === 'auto' || mode === 'batch' || mode === 'realtime') {
		return mode;
	}

	logger.warn({ mode }, 'Unknown mode specified, using auto');
	return 'auto';
}

/**
 * Get LLM based on --llm flag or return undefined for auto selection
 */
function getLlmFromArgs(args: string[]): LLM | undefined {
	const llmIndex = args.indexOf('--llm');
	if (llmIndex === -1 || llmIndex === args.length - 1) {
		// No --llm flag, use auto selection
		return undefined;
	}

	const llmName = args[llmIndex + 1];

	// Check for special MLX model names
	if (llmName === 'mlx-gpt-oss-20b' || llmName === 'gpt-oss-20b') {
		logger.info('Using MLX GPT-OSS 20B model for summary generation');
		return mlxGptOss20b();
	}

	// Check for OpenAI Flex models
	if (llmName === 'gpt-5-nano' || llmName === 'gpt5-nano' || llmName === 'flex-nano') {
		logger.info('Using OpenAI Flex GPT5 Nano model for summary generation');
		return openAIFlexGPT5Nano();
	}
	if (llmName === 'gpt-5-mini' || llmName === 'gpt5-mini' || llmName === 'flex-mini') {
		logger.info('Using OpenAI Flex GPT5 Mini model for summary generation');
		return openAIFlexGPT5Mini();
	}
	if (llmName === 'gpt-5' || llmName === 'gpt5' || llmName === 'flex') {
		logger.info('Using OpenAI Flex GPT5 model for summary generation');
		return openAIFlexGPT5();
	}

	// Try to find matching MLX model by ID
	const mlxFactories = mlxLLMRegistry();
	for (const factory of mlxFactories) {
		const model = factory();
		if (model.getId() === llmName || model.getId().includes(llmName)) {
			logger.info({ model: model.getId() }, 'Using MLX model for summary generation');
			return model;
		}
	}

	// Try to find matching OpenAI Flex model by ID
	const flexFactories = openAIFlexLLMRegistry();
	for (const factory of flexFactories) {
		const model = factory();
		if (model.getId() === llmName || model.getId().includes(llmName)) {
			logger.info({ model: model.getId() }, 'Using OpenAI Flex model for summary generation');
			return model;
		}
	}

	// Fall back to default
	logger.warn({ llmName }, 'Unknown LLM specified, using default');
	return llms().easy;
}

async function main(): Promise<void> {
	loadCliEnvironment();

	const args = process.argv.slice(2);

	if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
		printUsage();
		process.exit(0);
	}

	// Ensure local postgres is running if configured for localhost
	await ensurePostgresDockerRunning();

	await initApplicationContext();

	const command = args[0];
	const fss = getFileSystem();

	try {
		switch (command) {
			case 'pull': {
				logger.info('Pulling summaries from Cloud SQL...');
				await pullSummariesFromCloud(fss);
				console.log('✓ Successfully pulled summaries from Cloud SQL');
				break;
			}

			case 'push': {
				logger.info('Pushing summaries to Cloud SQL...');
				await pushSummariesToCloud(fss);
				console.log('✓ Successfully pushed summaries to Cloud SQL');
				break;
			}

			case 'sync': {
				const syncMode = getModeFromArgs(args);
				const syncLlm = getLlmFromArgs(args);
				const isEmpty = await isSummaryStoreEmpty(fss);

				if (syncMode === 'batch' || (syncMode === 'auto' && isEmpty)) {
					logger.info('Starting full sync with batch processing: pull → batch build → push');
					console.log('Using Vertex AI Batch Prediction (50% cost savings)');
					console.log('Note: Batch jobs may take up to 24 hours to complete\n');
				} else {
					const llmId = syncLlm?.getId() ?? 'auto-selected';
					logger.info({ llm: llmId, mode: syncMode }, 'Starting full sync: pull → build → push');
				}

				await buildSummariesWithSmartLlm(fss, {
					mode: syncMode,
					llm: syncLlm,
					syncToCloud: true,
					pullFirst: true,
					pushAfter: true,
				});
				console.log('✓ Successfully synced summaries with Cloud SQL');
				break;
			}

			case 'build': {
				const buildMode = getModeFromArgs(args);
				const buildLlm = getLlmFromArgs(args);
				const isEmpty = await isSummaryStoreEmpty(fss);

				if (buildMode === 'batch' || (buildMode === 'auto' && isEmpty)) {
					logger.info('Building summaries with batch processing (no cloud sync)');
					console.log('Using Vertex AI Batch Prediction (50% cost savings)');
					console.log('Note: Batch jobs may take up to 24 hours to complete\n');
				} else {
					const llmId = buildLlm?.getId() ?? 'auto-selected';
					logger.info({ llm: llmId, mode: buildMode }, 'Building summaries locally (no cloud sync)...');
				}

				await buildSummariesWithSmartLlm(fss, {
					mode: buildMode,
					llm: buildLlm,
					syncToCloud: false,
				});
				console.log('✓ Successfully built local summaries');
				break;
			}

			case 'resume': {
				logger.info('Checking for pending batch job...');
				const resumeResult = await resumeBatchJob(fss);

				if (!resumeResult.found) {
					console.log('\nNo pending batch job found.');
					console.log('Run "pnpm summaries sync --mode batch" to start a new batch job.\n');
					break;
				}

				console.log('\n=== Batch Job Status ===\n');
				console.log(`Job ID: ${resumeResult.jobId}`);
				console.log(`Status: ${resumeResult.status}`);
				if (resumeResult.elapsedTime) {
					console.log(`Elapsed: ${resumeResult.elapsedTime}`);
				}

				if (resumeResult.status === 'succeeded' && resumeResult.result) {
					console.log('\n✓ Job completed successfully!');
					console.log(`  Files processed: ${resumeResult.result.totalFiles}`);
					console.log(`  Successful: ${resumeResult.result.successCount}`);
					console.log(`  Failed: ${resumeResult.result.failureCount}`);
					console.log('\nSummaries have been written to .typedai/docs/');
				} else if (resumeResult.status === 'failed') {
					console.log(`\n✗ Job failed: ${resumeResult.error}`);
				} else if (resumeResult.status === 'cancelled') {
					console.log('\n✗ Job was cancelled');
				} else if (resumeResult.status === 'expired') {
					console.log('\n✗ Job expired (exceeded 24 hour limit)');
				} else {
					// Still running or pending
					console.log(`\nJob is still ${resumeResult.status}...`);
					console.log(`Run "pnpm summaries resume" again later to check status.\n`);
				}
				break;
			}

			case 'status': {
				const config = await getSummaryStoreConfig();
				const repoId = await getRepositoryId();
				const syncState = await loadSyncState(fss);

				console.log('\n=== Summary Store Status ===\n');
				console.log(`Repository: ${repoId}`);
				console.log(`Cloud SQL: ${isCloudSqlEnabled(config) ? 'Enabled' : 'Not configured'}`);
				console.log(`PostgreSQL: ${isPostgresEnabled(config) ? 'Enabled' : 'Not configured'}`);

				if (isCloudSqlEnabled(config)) {
					console.log(`  Instance: ${config.googleCloud?.instanceConnectionName}`);
					console.log(`  Database: ${config.googleCloud?.database}`);
				}

				if (isPostgresEnabled(config)) {
					console.log(`  Host: ${config.postgres?.host}:${config.postgres?.port}`);
					console.log(`  Database: ${config.postgres?.database}`);
				}

				// Check for pending batch job
				const batchState = await loadBatchJobState(fss);
				if (batchState) {
					console.log('\n=== Pending Batch Job ===');
					console.log(`Job ID: ${batchState.jobId}`);
					console.log(`Submitted: ${batchState.submittedAt}`);
					console.log(`Last state: ${batchState.state}`);
					console.log(`Files: ${batchState.requestCount}`);
					console.log(`\nRun "pnpm summaries resume" to check status and retrieve results.`);
				}

				console.log(`\n${getSyncStatusMessage(syncState)}`);
				console.log('');
				break;
			}

			default: {
				console.error(`Unknown command: ${command}`);
				printUsage();
				process.exit(1);
			}
		}
	} catch (error) {
		logger.error({ error }, `Command '${command}' failed`);
		console.error(`\n✗ Error: ${error instanceof Error ? error.message : String(error)}`);
		process.exit(1);
	}

	await shutdownTrace();
	process.exit(0);
}

main().then(
	() => {},
	(e) => {
		console.error('Fatal error:', e);
		process.exit(1);
	},
);
