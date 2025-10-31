/**
 * Demo script to index src/swe and test vector search queries
 * Usage: pnpm tsx src/swe/vector/demo.ts
 */

import * as path from 'node:path';
import pino from 'pino';
import { VectorStoreConfig } from './core/config';
import { getGoogleVectorServiceConfig } from './google/googleVectorConfig';
import { VectorSearchOrchestrator } from './google/vectorSearchOrchestrator';

const logger = pino({ name: 'VectorSearchDemo', level: 'info' });

async function main() {
	console.log(`\n${'='.repeat(60)}`);
	console.log('VECTOR SEARCH DEMO - Indexing src/swe');
	console.log(`${'='.repeat(60)}\n`);

	// Create unique data store for demo
	const testDataStoreId = `demo-vector-${Date.now()}`;
	logger.info({ testDataStoreId }, 'Using data store');

	// Initialize orchestrator
	const googleConfig = getGoogleVectorServiceConfig();
	googleConfig.dataStoreId = testDataStoreId;
	const orchestrator = new VectorSearchOrchestrator(googleConfig);

	// Fast config (no LLM features for speed)
	const config: VectorStoreConfig = {
		dualEmbedding: false,
		contextualChunking: false,
		chunkSize: 2500,
	};

	try {
		// Index src/swe directory
		const repoPath = path.join(process.cwd(), 'src/swe');
		console.log(`\n📂 Indexing directory: ${repoPath}\n`);

		await orchestrator.indexRepository(repoPath, { config });

		console.log('\n✅ Indexing complete. Waiting for Discovery Engine to make documents searchable...');
		console.log('⏳ This typically takes 8-30 seconds...\n');

		// Wait for Discovery Engine indexing (poll until results appear)
		const startTime = Date.now();
		let indexed = false;
		const maxWaitMs = 60000; // 1 minute
		const pollIntervalMs = 3000; // 3 seconds

		while (Date.now() - startTime < maxWaitMs) {
			const testResults = await orchestrator.search('function', { maxResults: 1 });
			if (testResults.length > 0) {
				const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
				console.log(`✓ Documents are searchable! (took ${elapsed}s)\n`);
				indexed = true;
				break;
			}
			await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
		}

		if (!indexed) {
			console.log('⚠️  Warning: Documents not yet searchable. Continuing anyway...\n');
		}

		// Run test queries
		console.log('='.repeat(60));
		console.log('RUNNING TEST QUERIES');
		console.log(`${'='.repeat(60)}\n`);

		const testQueries = [
			'code that handles AST parsing',
			'function that chunks code files',
			'code that generates embeddings',
			'vector search implementation',
			'code that handles git repositories',
		];

		for (const query of testQueries) {
			console.log(`\n🔍 Query: "${query}"`);
			console.log('-'.repeat(60));

			const results = await orchestrator.search(query, { maxResults: 3 });

			if (results.length === 0) {
				console.log('   ❌ No results found\n');
				continue;
			}

			console.log(`   Found ${results.length} result(s):\n`);

			for (let i = 0; i < results.length; i++) {
				const result = results[i];
				const preview = result.document.originalCode.substring(0, 150).replace(/\n/g, ' ').trim();

				console.log(`   ${i + 1}. ${result.document.filePath}:${result.document.startLine}`);
				if (result.document.functionName) {
					console.log(`      Function: ${result.document.functionName}`);
				}
				if (result.document.className) {
					console.log(`      Class: ${result.document.className}`);
				}
				console.log(`      Preview: ${preview}...`);
				console.log();
			}
		}

		console.log(`\n${'='.repeat(60)}`);
		console.log('DEMO COMPLETE');
		console.log(`${'='.repeat(60)}\n`);

		// Get stats
		console.log('📊 Statistics:');
		const allDocs = await orchestrator.listDocuments(500);
		console.log(`   Total documents indexed: ${allDocs.length}`);
		console.log(`   Data store ID: ${testDataStoreId}\n`);

		// Cleanup
		console.log('🧹 Cleaning up test data store...');
		await orchestrator.deleteDataStore();
		console.log('✅ Cleanup complete\n');
	} catch (error: any) {
		console.error('\n❌ Error:', error.message);
		console.error(error.stack);

		// Try to cleanup on error
		try {
			await orchestrator.deleteDataStore();
		} catch (cleanupError) {
			console.error('Failed to cleanup data store');
		}

		process.exit(1);
	}
}

main().catch(console.error);
