#!/usr/bin/env node
/**
 * ChromaDB + Ollama Vector Search CLI
 *
 * Local-first CLI for vector search operations using ChromaDB and Ollama:
 * - index: Index a repository into ChromaDB
 * - search: Search the vector index
 * - purge: Delete all indexed data
 *
 * Usage:
 *   npx ts-node src/swe/vector/chroma/cli.ts index /path/to/repo
 *   npx ts-node src/swe/vector/chroma/cli.ts search "how does authentication work"
 *   npx ts-node src/swe/vector/chroma/cli.ts purge
 */

import * as path from 'node:path';
import { Command } from 'commander';
import { logger } from '#o11y/logger';
import type { VectorStoreConfig } from '../core/config';
import { OLLAMA_EMBEDDING_MODELS } from '../ollama/ollamaEmbedder';
import { ChromaOrchestrator } from './chromaOrchestrator';

const program = new Command();

program.name('chroma-vector').description('ChromaDB + Ollama vector search CLI for code repositories').version('1.0.0');

/**
 * Index command: Index a repository using ChromaDB + Ollama
 */
program
	.command('index <path>')
	.description('Index a repository into ChromaDB using Ollama embeddings')
	.option('--name <name>', 'Collection name identifier (default: derived from path)')
	.option('--chroma-url <url>', 'ChromaDB server URL (default: http://localhost:8000)', 'http://localhost:8000')
	.option('--ollama-url <url>', 'Ollama API URL (default: http://localhost:11434)', 'http://localhost:11434')
	.option('--model <model>', 'Ollama embedding model', OLLAMA_EMBEDDING_MODELS.NOMIC_EMBED_CODE.model)
	.option('--include <patterns>', 'Comma-separated glob patterns to include (e.g., "src/**,lib/**")')
	.option('--incremental', 'Perform incremental update (only changed files)')
	.option('--contextual', 'Enable contextual chunking (LLM-generated context)')
	.action(async (repoPath, options) => {
		const startTime = Date.now();

		try {
			const absolutePath = path.resolve(repoPath);
			const repoName = options.name || path.basename(absolutePath);

			console.log('🚀 Starting ChromaDB + Ollama vector indexing\n');
			console.log('Configuration:');
			console.log('━'.repeat(50));
			console.log(`  Repository: ${absolutePath}`);
			console.log(`  Collection: ${repoName}`);
			console.log(`  ChromaDB: ${options.chromaUrl}`);
			console.log(`  Ollama: ${options.ollamaUrl}`);
			console.log(`  Model: ${options.model}`);
			console.log(`  Mode: ${options.incremental ? 'Incremental' : 'Full'}`);
			console.log(`  Contextual Chunking: ${options.contextual ? '✓' : '✗'}`);
			if (options.include) {
				console.log(`  Include: ${options.include}`);
			}
			console.log('━'.repeat(50));
			console.log();

			// Build config
			const config: VectorStoreConfig = {
				name: repoName,
				chroma: {
					url: options.chromaUrl,
				},
				ollama: {
					apiUrl: options.ollamaUrl,
				},
				embedding: {
					provider: 'ollama',
					model: options.model,
				},
				chunking: {
					dualEmbedding: false,
					contextualChunking: options.contextual || false,
					size: 2500,
					overlap: 300,
					strategy: 'ast',
				},
				search: {
					hybridSearch: true,
				},
				includePatterns: options.include ? options.include.split(',').map((p: string) => p.trim()) : undefined,
			};

			const orchestrator = new ChromaOrchestrator(repoName, config);

			// Index repository with progress reporting
			let lastProgress = '';
			await orchestrator.indexRepository(absolutePath, {
				incremental: options.incremental,
				config,
				onProgress: (progress) => {
					const msg = `[${progress.phase}] ${progress.filesProcessed}/${progress.totalFiles} ${progress.currentFile || ''}`;
					if (msg !== lastProgress) {
						process.stdout.write(`\r${' '.repeat(80)}\r${msg}`);
						lastProgress = msg;
					}
				},
			});

			console.log(); // New line after progress

			const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
			const stats = await orchestrator.getStats();

			console.log();
			console.log('✅ Indexing completed successfully!');
			console.log('━'.repeat(50));
			console.log(`  Duration: ${elapsed}s`);
			console.log(`  Total chunks: ${stats.totalChunks}`);
			console.log('━'.repeat(50));
		} catch (error: any) {
			console.error();
			console.error('❌ Indexing failed:', error.message);
			logger.error({ error }, 'Indexing operation failed');
			process.exit(1);
		}
	});

/**
 * Search command: Search the vector index
 */
program
	.command('search <query>')
	.description('Search the ChromaDB vector index')
	.option('--name <name>', 'Collection name identifier (required)')
	.option('-n, --limit <number>', 'Maximum number of results', '10')
	.option('--chroma-url <url>', 'ChromaDB server URL', 'http://localhost:8000')
	.option('--ollama-url <url>', 'Ollama API URL', 'http://localhost:11434')
	.option('--model <model>', 'Ollama embedding model', OLLAMA_EMBEDDING_MODELS.NOMIC_EMBED_CODE.model)
	.option('--json', 'Output results as JSON')
	.action(async (query, options) => {
		try {
			if (!options.name) {
				console.error('❌ --name is required. Specify the collection name used during indexing.');
				process.exit(1);
			}

			const config: VectorStoreConfig = {
				name: options.name,
				chroma: {
					url: options.chromaUrl,
				},
				ollama: {
					apiUrl: options.ollamaUrl,
				},
				embedding: {
					provider: 'ollama',
					model: options.model,
				},
			};

			const orchestrator = new ChromaOrchestrator(options.name, config);

			console.log(`🔍 Searching for: "${query}"\n`);

			const maxResults = Number.parseInt(options.limit);
			const results = await orchestrator.search(query, { maxResults });

			if (results.length === 0) {
				console.log('No results found.');
				process.exit(0);
			}

			if (options.json) {
				console.log(JSON.stringify(results, null, 2));
			} else {
				console.log(`Found ${results.length} result(s):\n`);

				for (let i = 0; i < results.length; i++) {
					const result = results[i];
					console.log(`${i + 1}. ${result.document.filePath}:${result.document.startLine}`);
					console.log(`   Score: ${result.score.toFixed(4)}`);

					if (result.document.functionName) {
						console.log(`   Function: ${result.document.functionName}`);
					}
					if (result.document.className) {
						console.log(`   Class: ${result.document.className}`);
					}

					// Show code preview
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
 * Purge command: Delete all indexed data
 */
program
	.command('purge')
	.description('Delete all indexed data from the collection')
	.option('--name <name>', 'Collection name identifier (required)')
	.option('--chroma-url <url>', 'ChromaDB server URL', 'http://localhost:8000')
	.option('--yes', 'Skip confirmation prompt')
	.action(async (options) => {
		try {
			if (!options.name) {
				console.error('❌ --name is required. Specify the collection name to purge.');
				process.exit(1);
			}

			if (!options.yes) {
				console.log('⚠️  WARNING: This will delete ALL documents from the collection!');
				console.log(`   Collection: ${options.name}`);
				console.log();
				console.log('   To proceed, run with --yes flag');
				process.exit(0);
			}

			const config: VectorStoreConfig = {
				name: options.name,
				chroma: {
					url: options.chromaUrl,
				},
			};

			const orchestrator = new ChromaOrchestrator(options.name, config);

			console.log('🗑️  Purging collection...');
			await orchestrator.purge();
			console.log('✅ Collection purged successfully!');
		} catch (error: any) {
			console.error('❌ Purge failed:', error.message);
			logger.error({ error }, 'Purge operation failed');
			process.exit(1);
		}
	});

/**
 * Stats command: Show collection statistics
 */
program
	.command('stats')
	.description('Show collection statistics')
	.option('--name <name>', 'Collection name identifier (required)')
	.option('--chroma-url <url>', 'ChromaDB server URL', 'http://localhost:8000')
	.action(async (options) => {
		try {
			if (!options.name) {
				console.error('❌ --name is required. Specify the collection name.');
				process.exit(1);
			}

			const config: VectorStoreConfig = {
				name: options.name,
				chroma: {
					url: options.chromaUrl,
				},
			};

			const orchestrator = new ChromaOrchestrator(options.name, config);
			const stats = await orchestrator.getStats();

			console.log('📊 Collection Statistics:');
			console.log('━'.repeat(50));
			console.log(`  Collection: ${options.name}`);
			console.log(`  Total Documents: ${stats.totalDocuments}`);
			console.log(`  Total Chunks: ${stats.totalChunks}`);
			console.log('━'.repeat(50));
		} catch (error: any) {
			console.error('❌ Stats failed:', error.message);
			logger.error({ error }, 'Stats operation failed');
			process.exit(1);
		}
	});

// Parse CLI arguments
program.parse();
