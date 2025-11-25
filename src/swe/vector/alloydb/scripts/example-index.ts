#!/usr/bin/env tsx

/**
 * AlloyDB Vector Search Example
 * Demonstrates basic indexing and search operations
 */

import path from 'node:path';
import { config } from 'dotenv';
import pino from 'pino';
import { createAlloyDBOrchestrator } from '../alloydbFactory';

const logger = pino({ name: 'AlloyDBExample', level: 'info' });

// Load environment variables
const envPath = path.join(__dirname, '../.env.local');
config({ path: envPath });

async function runExample() {
	console.log('🚀 AlloyDB Vector Search Example\n');

	// Configuration
	const repoIdentifier = 'example-test-repo';
	const repoPath = process.argv[2] || process.cwd();

	console.log(`Repository: ${repoPath}`);
	console.log(`Identifier: ${repoIdentifier}\n`);

	// Create orchestrator
	console.log('📦 Creating AlloyDB orchestrator...');
	const orchestrator = createAlloyDBOrchestrator(repoIdentifier, {
		// Connection settings
		alloydb: {
			database: process.env.ALLOYDB_DATABASE || 'vector_db',
			host: process.env.ALLOYDB_HOST || 'localhost',
			port: Number.parseInt(process.env.ALLOYDB_PORT || '5432'),
			user: process.env.ALLOYDB_USER || 'postgres',
			password: process.env.ALLOYDB_PASSWORD || 'alloydb123',
			embeddingModel: 'gemini-embedding-001',
			enableColumnarEngine: false, // May not be available in Omni
			vectorWeight: 0.7,
		},

		// Vector search features
		chunking: {
			dualEmbedding: false,
			contextualChunking: true,
		},
		search: { hybridSearch: true },

		// File filters (limit to TypeScript files for this example)
		includePatterns: ['src/**/*.ts'],
		fileExtensions: ['.ts'],

		// GCP settings (for reranking if enabled)
		googleCloud: {
			projectId: process.env.GCLOUD_PROJECT,
			region: process.env.GCLOUD_REGION || 'us-central1',
		},
	});

	console.log('✅ Orchestrator created\n');

	try {
		// Index repository
		console.log('📚 Indexing repository (this may take a while)...\n');

		let filesProcessed = 0;
		await orchestrator.indexRepository(repoPath, {
			incremental: false,
			onProgress: (progress) => {
				if (progress.filesProcessed > filesProcessed) {
					filesProcessed = progress.filesProcessed;
					console.log(`  [${progress.phase}] ${progress.currentFile} (${progress.filesProcessed}/${progress.totalFiles})`);
				}
			},
		});

		console.log('\n✅ Indexing complete!\n');

		// Example searches
		const queries = ['database connection', 'error handling', 'configuration management', 'vector search'];

		console.log('🔍 Running example searches...\n');

		for (const query of queries) {
			console.log(`\nQuery: "${query}"`);
			console.log('-'.repeat(80));

			const results = await orchestrator.search(query, {
				maxResults: 3,
			});

			if (results.length === 0) {
				console.log('  No results found');
			} else {
				results.forEach((result, idx) => {
					console.log(`\n  ${idx + 1}. ${result.document.filePath}:${result.document.startLine}-${result.document.endLine}`);
					console.log(`     Score: ${result.score.toFixed(4)}`);
					console.log(`     Language: ${result.document.language}`);
					if (result.document.functionName) {
						console.log(`     Function: ${result.document.functionName}`);
					}
					console.log(`     Code: ${result.document.originalCode.substring(0, 100)}...`);
				});
			}
		}

		console.log('\n\n✅ Example complete!');

		// Get stats
		const config = orchestrator.getConfig();
		console.log('\n📊 Configuration:');
		console.log(`   Contextual Chunking: ${config.chunking?.contextualChunking}`);
		console.log(`   Hybrid Search: ${config.search?.hybridSearch}`);
		console.log(`   Dual Embedding: ${config.chunking?.dualEmbedding}`);

		// Close connections
		await (orchestrator as any).vectorStore.close();
	} catch (error) {
		console.error('\n❌ Error:', error);
		process.exit(1);
	}
}

// Parse command line arguments
if (require.main === module) {
	const args = process.argv.slice(2);

	if (args.includes('--help') || args.includes('-h')) {
		console.log(`
AlloyDB Vector Search Example

Usage:
  tsx scripts/example-index.ts [REPO_PATH]

Arguments:
  REPO_PATH   Path to repository to index (default: current directory)

Environment Variables:
  See .env.local.example for configuration options

Examples:
  # Index current directory
  tsx scripts/example-index.ts

  # Index specific repository
  tsx scripts/example-index.ts /path/to/my/repo
		`);
		process.exit(0);
	}

	runExample().catch((error) => {
		console.error('Fatal error:', error);
		process.exit(1);
	});
}
