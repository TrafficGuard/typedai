#!/usr/bin/env node

import pino from 'pino';
import { createGoogleVectorService } from '../swe/vector/google/vectorStoreFactory';

const logger = pino({ name: 'MainSearchScript' });

export async function main(): Promise<void> {
	const args = process.argv.slice(2); // Remove 'node' and script path

	if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
		printUsage();
		process.exit(0);
	}

	const command = args[0];

	const vectorStore = await createGoogleVectorService(process.cwd());

	switch (command) {
		case 'index': {
			if (args.length < 2) {
				logger.error('Missing required argument: <source_directory>');
				printUsage();
				process.exit(1);
			}
			const sourceDir = args[1] || './';
			logger.info(`Starting indexing command for directory: ${sourceDir}`);
			try {
				await vectorStore.indexRepository(sourceDir);
				logger.info('Indexing completed successfully.');
			} catch (error) {
				logger.error(`Indexing failed: ${error}`);
				process.exit(1);
			}
			break;
		}

		case 'search': {
			if (args.length < 2) {
				logger.error('Missing required argument: <query>');
				printUsage();
				process.exit(1);
			}
			const query = args.slice(1).join(' '); // Join remaining args as query
			logger.info(`Starting search command for query: "${query}"`);
			try {
				const results = await vectorStore.search(query);
				if (results.length > 0) {
					logger.info('Search Results:');
					// Simple console output - enhance as needed
					results.forEach((result, index) => {
						console.log(`\n[${index + 1}] Score: ${result.score.toFixed(4)}`);
						console.log(`  File: ${result.document.filePath}`);
						if (result.document.functionName) {
							console.log(`  Function: ${result.document.functionName}`);
						}
						console.log(`  Lines: ${result.document.startLine}-${result.document.endLine}`);
						console.log(`  Description: ${result.document.naturalLanguageDescription}`);
						// Optionally print code snippet
						// console.log(`  Code:\n---\n${result.document.originalCode.substring(0, 200)}...\n---`);
					});
				} else {
					logger.info('No results found.');
				}
			} catch (error) {
				logger.error(`Search failed: ${error}`);
				process.exit(1);
			}
			break;
		}

		default:
			logger.error(`Unknown command: ${command}`);
			printUsage();
			process.exit(1);
	}
}

export function printUsage(): void {
	console.log(`
Usage: node dist/swe/search/index.js <command> [options]

Commands:
  index <source_directory>  Index the code in the specified directory.
                            Requires GCLOUD_PROJECT, DISCOVERY_ENGINE_DATA_STORE_ID env vars.
                            Optionally DISCOVERY_ENGINE_LOCATION (defaults to 'global').
  search <query>            Search the indexed code with a natural language query.
                            Requires GCLOUD_PROJECT, DISCOVERY_ENGINE_DATA_STORE_ID env vars.
                            Optionally DISCOVERY_ENGINE_LOCATION (defaults to 'global').

Options:
  -h, --help                Show this help message.

Environment Variables:
  GCLOUD_PROJECT            Your Google Cloud Project ID.
  DISCOVERY_ENGINE_DATA_STORE_ID  The ID of your Discovery Engine Data Store.
  DISCOVERY_ENGINE_LOCATION The location of your Discovery Engine resources (e.g., 'global', 'us', 'eu'). Defaults to 'global'.
  GOOGLE_APPLICATION_CREDENTIALS Path to your service account key file (if not using default credentials).
  // Add any other relevant env vars for LLM keys, etc.
`);
}

// main().catch((error) => {
// 	logger.fatal(`Unhandled error in main execution: ${error}`);
// 	process.exit(1);
// });
