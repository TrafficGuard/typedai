#!/usr/bin/env node
/**
 * Vector Search CLI
 *
 * Production CLI for vector search operations:
 * - sync: Intelligently syncs repository (auto-detects full vs incremental)
 * - search: Queries the vector index
 *
 * Usage:
 *   pnpm vector:sync [path]           # Sync repository (auto-detects mode)
 *   pnpm vector:search "<query>"      # Search the index
 */

import * as path from 'node:path';
import * as readline from 'node:readline';
import { Command } from 'commander';
import pino from 'pino';
import { DEFAULT_VECTOR_CONFIG, buildGoogleVectorServiceConfig, loadVectorConfig } from './core/config';
import type { VectorStoreConfig } from './core/config';
import type { GoogleVectorServiceConfig } from './google/googleVectorConfig';
import { VectorSearchOrchestrator } from './google/vectorSearchOrchestrator';

/**
 * Wait for user to press Enter to continue
 */
async function waitForEnter(message = 'Press Enter to continue...'): Promise<void> {
	const rl = readline.createInterface({
		input: process.stdin,
		output: process.stdout,
	});

	return new Promise((resolve) => {
		rl.question(message, () => {
			rl.close();
			resolve();
		});
	});
}

/**
 * Print the final resolved configuration
 */
async function printConfiguration(
	config: VectorStoreConfig,
	googleConfig: GoogleVectorServiceConfig,
	options: { repoPath?: string; configRoot?: string; mode?: string },
): Promise<void> {
	console.log();
	console.log('Configuration:');
	console.log('━'.repeat(60));

	// Paths
	if (options.repoPath) {
		console.log(`  Repository:          ${options.repoPath}`);
	}
	if (options.configRoot) {
		console.log(`  Config Root:         ${options.configRoot}`);
	}
	if (options.mode) {
		console.log(`  Mode:                ${options.mode}`);
	}

	// Google Cloud / Discovery Engine
	console.log();
	console.log('  Google Cloud:');
	console.log(`    Project:           ${googleConfig.project}`);
	console.log(`    Region:            ${googleConfig.region}`);
	console.log(`    DE Location:       ${googleConfig.discoveryEngineLocation}`);
	console.log(`    DE Collection:     ${googleConfig.collection}`);
	console.log(`    DE Datastore:      ${googleConfig.dataStoreId}`);

	// Embedding
	console.log();
	console.log('  Embedding:');
	console.log(`    Provider:          ${config.embedding?.provider || 'vertex'}`);
	console.log(`    Model:             ${googleConfig.embeddingModel}`);

	// Chunking
	console.log();
	console.log('  Chunking:');
	console.log(`    Dual Embedding:    ${config.chunking?.dualEmbedding ? '✓ Enabled' : '✗ Disabled'}`);
	if (config.chunking?.contextualChunking) {
		// Dynamic import to avoid circular dependency at startup
		const { summaryLLM } = await import('../../llm/services/defaultLlmsModule.cjs');
		console.log(`    Contextual:        ✓ Enabled (LLM: ${summaryLLM().getId()})`);
	} else {
		console.log('    Contextual:        ✗ Disabled');
		console.log(`    Strategy:          ${config.chunking?.strategy || 'ast'}`);
		console.log(`    Chunk Size:        ${config.chunking?.size || 2500} chars`);
		console.log(`    Chunk Overlap:     ${config.chunking?.overlap || 300} chars`);
	}

	// Search
	console.log();
	console.log('  Search:');
	console.log(`    Hybrid Search:     ${config.search?.hybridSearch ? '✓ Enabled' : '✗ Disabled'}`);
	if (config.search?.reranking) {
		console.log(`    Reranking:         ✓ Enabled (${config.search.reranking.provider})`);
	} else {
		console.log('    Reranking:         ✗ Disabled');
	}

	// Include patterns
	if (config.includePatterns?.length) {
		console.log();
		console.log('  Include Patterns:');
		for (const pattern of config.includePatterns) {
			console.log(`    - ${pattern}`);
		}
	}

	console.log('━'.repeat(60));
	console.log();
}

const logger = pino({ name: 'VectorCLI', level: process.env.LOG_LEVEL || 'info' });

const program = new Command();

program.name('vector').description('Vector search CLI for code repositories').version('1.0.0');

/**
 * Sync command: Intelligently indexes repository
 * - Auto-detects: full index if data store is empty, incremental otherwise
 * - Loads config from .vectorconfig.json or package.json
 */
program
	.command('sync [path]')
	.description('Sync repository to vector index (auto-detects full vs incremental)')
	.option('-c, --config <path>', 'Path to .vectorconfig.json')
	.option('--config-name <name>', 'Name of config to use from .vectorconfig.json array')
	.option('--fs <path>', 'Filesystem/working directory for loading .vectorconfig.json (includePatterns are relative to this)')
	.option('--force-full', 'Force full reindex (skip auto-detection)')
	.option('--data-store <id>', 'Override data store ID')
	.option('--dry-run', 'Show what would be indexed without actually indexing')
	.option('-y, --yes', 'Skip confirmation prompt')
	.action(async (repoPath, options) => {
		const startTime = Date.now();

		try {
			// Determine the config root directory
			const configRoot = options.fs ? path.resolve(options.fs) : repoPath;

			// Load configuration
			const configPath = options.config || path.join(configRoot, '.vectorconfig.json');
			let config: VectorStoreConfig;

			try {
				config = loadVectorConfig(configRoot, options.configName);
				logger.info({ configPath, configName: options.configName, configRoot }, 'Loaded configuration');
				logger.debug({ googleCloud: config.googleCloud, discoveryEngine: config.discoveryEngine }, 'Resolved GCP config');
			} catch (error) {
				logger.warn('No configuration found, using defaults');
				config = DEFAULT_VECTOR_CONFIG;
			}

			const repoRoot = repoPath || (options.fs ? path.resolve(options.fs) : process.cwd());

			if (options.dataStore) {
				config.discoveryEngine = { ...config.discoveryEngine, datastoreId: options.dataStore };
			}

			if (repoPath && path.resolve(repoPath) !== path.resolve(configRoot) && config.includePatterns?.length) {
				config.includePatterns = [];
			}

			// Build Google config from VectorStoreConfig (uses config values over env vars)
			const googleConfig = buildGoogleVectorServiceConfig(config);
			if (options.dataStore) {
				googleConfig.dataStoreId = options.dataStore;
			}

			// Override quota project to match the target project from config
			// This ensures API quota is charged to the correct project (not ADC default)
			if (googleConfig.project) {
				process.env.GOOGLE_CLOUD_QUOTA_PROJECT = googleConfig.project;
			}

			const orchestrator = new VectorSearchOrchestrator(googleConfig, config);

			// Auto-detect: check if data store is empty
			const isForceFullReindex = options.forceFull;
			let isInitialIndex = isForceFullReindex;

			if (!isForceFullReindex) {
				console.log('🔍 Checking data store status...');
				try {
					const existingDocs = await orchestrator.listDocuments(1);
					isInitialIndex = existingDocs.length === 0;

					if (isInitialIndex) {
						console.log('📦 Empty data store detected - performing initial full index');
					} else {
						console.log('♻️  Existing data detected - performing incremental update');
					}
				} catch (error: any) {
					logger.warn({ error: error.message }, 'Failed to check data store status, assuming initial index');
					isInitialIndex = true;
					console.log('📦 Performing initial full index');
				}
			} else {
				console.log('🔄 Force full reindex mode enabled');
			}

			// Print full configuration and wait for confirmation
			await printConfiguration(config, googleConfig, {
				repoPath,
				configRoot,
				mode: isInitialIndex ? 'Full Index' : 'Incremental Update',
			});

			if (options.dryRun) {
				console.log('🏃 Dry run mode - no actual indexing will be performed');
				process.exit(0);
			}

			// Wait for user confirmation unless --yes flag
			if (!options.yes) {
				await waitForEnter('Press Enter to start indexing...');
			}

			// Index repository with progress reporting
			let lastProgress = '';
			await orchestrator.indexRepository(repoRoot, {
				incremental: !isInitialIndex,
				config,
				onProgress: (progress) => {
					const msg = `[${progress.phase}] ${progress.filesProcessed}/${progress.totalFiles}`;
					if (msg !== lastProgress) {
						process.stdout.write(`\r${msg}`);
						lastProgress = msg;
					}
				},
			});

			console.log(); // New line after progress

			const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
			const minutes = (Number.parseFloat(elapsed) / 60).toFixed(1);

			console.log();
			console.log('✅ Sync completed successfully!');
			console.log('━'.repeat(50));
			console.log(`  Duration: ${elapsed}s (${minutes} minutes)`);
			console.log(`  Mode: ${isInitialIndex ? 'Full Index' : 'Incremental Update'}`);
			console.log('━'.repeat(50));
		} catch (error: any) {
			console.error();
			console.error('❌ Sync failed:', error.message);
			logger.error({ error }, 'Sync operation failed');
			process.exit(1);
		}
	});

program
	.command('batch [path]')
	.description('Batch index repository with resumable state file')
	.option('-c, --config <path>', 'Path to .vectorconfig.json')
	.option('--config-name <name>', 'Name of config to use from .vectorconfig.json array')
	.option('--fs <path>', 'Filesystem/working directory for loading .vectorconfig.json')
	.option('--state-file <path>', 'Path to checkpoint file for resumable batch runs')
	.option('--concurrency <number>', 'Max concurrent files', '3')
	.option('--continue-on-error', 'Continue processing other files when one fails', true)
	.option('-y, --yes', 'Skip confirmation prompt')
	.action(async (repoPath, options) => {
		const root = repoPath || process.cwd();
		const configRoot = options.fs ? path.resolve(options.fs) : root;

		let config: VectorStoreConfig;
		try {
			config = loadVectorConfig(configRoot, options.configName);
			logger.info({ configRoot, configName: options.configName }, 'Loaded configuration');
		} catch {
			config = DEFAULT_VECTOR_CONFIG;
			logger.warn('No configuration found, using defaults');
		}

		const googleConfig = buildGoogleVectorServiceConfig(config);

		// Override quota project to match the target project from config
		if (googleConfig.project) {
			process.env.GOOGLE_CLOUD_QUOTA_PROJECT = googleConfig.project;
		}

		// Print full configuration
		await printConfiguration(config, googleConfig, {
			repoPath: root,
			configRoot,
			mode: 'Batch Index',
		});

		// Wait for user confirmation unless --yes flag
		if (!options.yes) {
			await waitForEnter('Press Enter to start batch indexing...');
		}

		const orchestrator = new VectorSearchOrchestrator(googleConfig, config);

		let lastProgress = '';
		await orchestrator.indexRepositoryBatch(root, {
			config,
			stateFilePath: options.stateFile,
			concurrency: Number.parseInt(options.concurrency, 10),
			continueOnError: options.continueOnError,
			onProgress: (progress) => {
				const msg = `[${progress.phase}] ${progress.filesProcessed}/${progress.totalFiles} ${progress.currentFile || ''}`;
				if (msg !== lastProgress) {
					process.stdout.write(`\r${msg}`);
					lastProgress = msg;
				}
			},
		});

		console.log('\n✅ Batch indexing completed');
	});

/**
 * Search command: Queries the vector index
 */
program
	.command('search <query>')
	.description('Search the vector index')
	.option('-n, --limit <number>', 'Maximum number of results', '10')
	.option('--config-name <name>', 'Name of config to use from .vectorconfig.json array')
	.option('--fs <path>', 'Filesystem/working directory for loading .vectorconfig.json')
	.option('--json', 'Output results as JSON')
	.option('--data-store <id>', 'Override data store ID')
	.option('--file <pattern>', 'Filter results by file pattern')
	.option('--lang <language>', 'Filter results by language (ts, py, js, etc)')
	.option('--rerank', 'Enable reranking for better result quality')
	.action(async (query, options) => {
		try {
			// Determine the config root directory
			const configRoot = options.fs ? path.resolve(options.fs) : process.cwd();

			// Load config and apply CLI overrides
			let config: VectorStoreConfig;
			try {
				config = loadVectorConfig(configRoot, options.configName);
			} catch (error) {
				config = DEFAULT_VECTOR_CONFIG;
			}

			// Apply --rerank flag (enables vertex reranking with defaults)
			const useReranking = options.rerank || config.search?.reranking;
			if (options.rerank && !config.search?.reranking) {
				config.search = {
					...config.search,
					reranking: {
						provider: 'vertex',
						model: 'semantic-ranker-default@latest',
						topK: 50,
					},
				};
			}

			// Build Google config from VectorStoreConfig (uses config values over env vars)
			const googleConfig = buildGoogleVectorServiceConfig(config);
			if (options.dataStore) {
				googleConfig.dataStoreId = options.dataStore;
			}

			// Override quota project to match the target project from config
			if (googleConfig.project) {
				process.env.GOOGLE_CLOUD_QUOTA_PROJECT = googleConfig.project;
			}

			const orchestrator = new VectorSearchOrchestrator(googleConfig, config);

			console.log(`🔍 Searching for: "${query}"`);
			if (useReranking) {
				console.log('   Reranking: Enabled\n');
			} else {
				console.log();
			}

			const maxResults = Number.parseInt(options.limit);
			const results = await orchestrator.search(query, { maxResults, reranking: useReranking });

			if (results.length === 0) {
				console.log('No results found.');
				process.exit(0);
			}

			if (options.json) {
				// JSON output
				console.log(JSON.stringify(results, null, 2));
			} else {
				// Pretty-print results
				console.log(`Found ${results.length} result(s):\n`);

				for (let i = 0; i < results.length; i++) {
					const result = results[i];
					console.log(`${i + 1}. ${result.document.filePath}:${result.document.startLine}`);

					if (result.document.functionName) {
						console.log(`   Function: ${result.document.functionName}`);
					}
					if (result.document.className) {
						console.log(`   Class: ${result.document.className}`);
					}

					// Show code preview (first 150 characters)
					const preview = result.document.originalCode.trim(); //.substring(0, 150).replace(/\n/g, ' ').trim();
					console.log(`   Preview: ${preview}...`);
					console.log();
				}
			}
		} catch (error: any) {
			console.error('❌ Search failed:', error.message);
			logger.error({ error }, 'Search operation failed');
			process.exit(1);
		}
	});

/**
 * Purge command: Deletes all documents from the vector store
 */
program
	.command('purge')
	.description('Delete all documents from the vector store')
	.option('--config-name <name>', 'Name of config to use from .vectorconfig.json array')
	.option('--fs <path>', 'Filesystem/working directory for loading .vectorconfig.json')
	.option('--data-store <id>', 'Override data store ID')
	.option('--yes', 'Skip confirmation prompt')
	.action(async (options) => {
		try {
			// Load configuration to get the right data store
			const configRoot = options.fs ? path.resolve(options.fs) : process.cwd();
			let config: VectorStoreConfig;

			try {
				config = loadVectorConfig(configRoot, options.configName);
				logger.info({ configName: options.configName, configRoot }, 'Loaded configuration');
			} catch (error) {
				logger.warn('No configuration found, using defaults');
				config = DEFAULT_VECTOR_CONFIG;
			}

			// Build Google config from VectorStoreConfig (uses config values over env vars)
			const googleConfig = buildGoogleVectorServiceConfig(config);
			if (options.dataStore) {
				googleConfig.dataStoreId = options.dataStore;
			}

			// Override quota project to match the target project from config
			if (googleConfig.project) {
				process.env.GOOGLE_CLOUD_QUOTA_PROJECT = googleConfig.project;
			}

			const orchestrator = new VectorSearchOrchestrator(googleConfig, config);

			// Confirm before purging
			if (!options.yes) {
				console.log('⚠️  WARNING: This will delete ALL documents from the vector store!');
				console.log(`   Data Store ID: ${googleConfig.dataStoreId}`);
				console.log(`   Project: ${googleConfig.project}`);
				console.log();
				console.log('   This action cannot be undone.');
				console.log();
				console.log('   To proceed, run with --yes flag:');
				console.log(`   pnpm vector:purge --yes ${options.configName ? `--config-name ${options.configName}` : ''}`);
				process.exit(0);
			}

			console.log('🗑️  Purging all documents...');
			await orchestrator.purgeAll();
			console.log('✅ All documents deleted successfully!');
		} catch (error: any) {
			console.error('❌ Purge failed:', error.message);
			logger.error({ error }, 'Purge operation failed');
			process.exit(1);
		}
	});

/**
 * Delete command: Deletes a single file from the vector store
 */
program
	.command('delete <filePath>')
	.description('Delete a single file from the vector store')
	.option('--config-name <name>', 'Name of config to use from .vectorconfig.json array')
	.option('--fs <path>', 'Filesystem/working directory for loading .vectorconfig.json')
	.option('--data-store <id>', 'Override data store ID')
	.option('--yes', 'Skip confirmation prompt')
	.action(async (filePath, options) => {
		try {
			// Load configuration to get the right data store
			const configRoot = options.fs ? path.resolve(options.fs) : process.cwd();
			let config: VectorStoreConfig;

			try {
				config = loadVectorConfig(configRoot, options.configName);
				logger.info({ configName: options.configName, configRoot }, 'Loaded configuration');
			} catch (error) {
				logger.warn('No configuration found, using defaults');
				config = DEFAULT_VECTOR_CONFIG;
			}

			// Build Google config from VectorStoreConfig (uses config values over env vars)
			const googleConfig = buildGoogleVectorServiceConfig(config);
			if (options.dataStore) {
				googleConfig.dataStoreId = options.dataStore;
			}

			// Override quota project to match the target project from config
			if (googleConfig.project) {
				process.env.GOOGLE_CLOUD_QUOTA_PROJECT = googleConfig.project;
			}

			const orchestrator = new VectorSearchOrchestrator(googleConfig, config);

			// Confirm before deleting
			if (!options.yes) {
				console.log('⚠️  WARNING: This will delete the file from the vector store!');
				console.log(`   File: ${filePath}`);
				console.log(`   Data Store ID: ${googleConfig.dataStoreId}`);
				console.log(`   Project: ${googleConfig.project}`);
				console.log();
				console.log('   To proceed, run with --yes flag:');
				console.log(`   pnpm vector:delete "${filePath}" --yes ${options.configName ? `--config-name ${options.configName}` : ''}`);
				process.exit(0);
			}

			console.log(`🗑️  Deleting file: ${filePath}...`);
			const deletedCount = await orchestrator.deleteFile(filePath);
			if (deletedCount > 0) {
				console.log(`✅ Deleted ${deletedCount} document(s) successfully!`);
			} else {
				console.log(`⚠️  No documents found for file: ${filePath}`);
				process.exit(1);
			}
		} catch (error: any) {
			console.error('❌ Delete failed:', error.message);
			logger.error({ error }, 'Delete operation failed');
			process.exit(1);
		}
	});

// Parse CLI arguments
program.parse();
