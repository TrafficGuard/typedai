import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import pino from 'pino';
import { sleep } from '#utils/async-utils';
import { VectorStoreConfig } from '../core/config';
import { SearchResult } from '../core/interfaces';

const logger = pino({ name: 'VectorTestUtils' });

/**
 * Creates a realistic test repository with diverse code samples
 */
export async function createTestRepository(repoDir: string, options?: { includeTests?: boolean }): Promise<void> {
	const { includeTests = false } = options || {};

	// Read test fixtures
	const fixturesDir = path.join(__dirname, 'fixtures');

	// Copy TypeScript fixtures
	const tsFiles = ['auth.ts', 'validation.ts', 'api.ts', 'utils.ts'];
	for (const file of tsFiles) {
		const sourcePath = path.join(fixturesDir, 'typescript', file);
		const destPath = path.join(repoDir, 'src', file);
		await fs.mkdir(path.dirname(destPath), { recursive: true });
		await fs.copyFile(sourcePath, destPath);
	}

	// Copy Python fixtures
	const pyFile = 'data_processor.py';
	const pySourcePath = path.join(fixturesDir, 'python', pyFile);
	const pyDestPath = path.join(repoDir, 'python', pyFile);
	await fs.mkdir(path.dirname(pyDestPath), { recursive: true });
	await fs.copyFile(pySourcePath, pyDestPath);

	// Create a README
	await fs.writeFile(
		path.join(repoDir, 'README.md'),
		`# Test Repository

This is a test repository for vector search testing.

## Structure
- \`src/\` - TypeScript source files
- \`python/\` - Python source files
`,
	);

	// Optionally create test files
	if (includeTests) {
		await fs.writeFile(
			path.join(repoDir, 'src', 'auth.test.ts'),
			`import { AuthService } from './auth';

describe('AuthService', () => {
  it('should authenticate user', async () => {
    const authService = new AuthService('secret');
    const token = await authService.authenticateUser('test@example.com', 'password');
    expect(token).toBeDefined();
  });
});
`,
		);
	}

	logger.info({ repoDir, fileCount: tsFiles.length + 1 }, 'Created test repository');
}

/**
 * Creates a minimal test repository with specific code
 */
export async function createMinimalTestRepo(repoDir: string, files: Record<string, string>): Promise<void> {
	for (const [filePath, content] of Object.entries(files)) {
		const fullPath = path.join(repoDir, filePath);
		await fs.mkdir(path.dirname(fullPath), { recursive: true });
		await fs.writeFile(fullPath, content);
	}

	logger.info({ repoDir, fileCount: Object.keys(files).length }, 'Created minimal test repository');
}

/**
 * Waits for Google Discovery Engine indexing to complete
 * Discovery Engine is eventually consistent, so we need to wait
 * This function polls Discovery Engine until results are found
 *
 * @param orchestrator - The VectorSearchOrchestrator to poll
 * @param testQuery - A simple query to check if indexing is complete (e.g., "export const")
 * @param maxWaitMs - Maximum time to wait in milliseconds (default: 180 seconds)
 * @param pollIntervalMs - How often to poll in milliseconds (default: 3 seconds)
 * @param initialDelayMs - Initial delay before starting to poll (default: 5 seconds) to account for propagation
 * @returns The time it took for results to appear
 */
export async function waitForIndexing(
	orchestrator?: any,
	testQuery?: string,
	maxWaitMs = 180000, // 180 seconds (3 minutes) - Discovery Engine eventual consistency
	pollIntervalMs = 3000, // 3 seconds
	initialDelayMs = 5000, // 5 seconds initial delay for propagation
): Promise<number> {
	// If no orchestrator provided, just do a simple wait (backward compatibility)
	if (!orchestrator || !testQuery) {
		const defaultWait = 10000;
		logger.debug({ delayMs: defaultWait }, 'Waiting for indexing to complete (simple wait)');
		await sleep(defaultWait);
		return defaultWait;
	}

	const startTime = Date.now();

	// Add initial delay to let propagation happen
	if (initialDelayMs > 0) {
		logger.info({ initialDelayMs }, 'Waiting for initial propagation delay before polling');
		await sleep(initialDelayMs);
	}

	let attempts = 0;
	const maxAttempts = Math.ceil((maxWaitMs - initialDelayMs) / pollIntervalMs);

	logger.info({ testQuery, maxWaitMs, pollIntervalMs, maxAttempts, initialDelayMs }, 'Starting Discovery Engine polling for indexed documents');

	while (attempts < maxAttempts) {
		attempts++;
		const elapsed = Date.now() - startTime;

		try {
			// Poll Discovery Engine with test query
			const results = await orchestrator.search(testQuery, { maxResults: 5 });

			if (results && results.length > 0) {
				const elapsedSeconds = (elapsed / 1000).toFixed(1);
				logger.info(
					{
						elapsedMs: elapsed,
						elapsedSeconds: `${elapsedSeconds}s`,
						attempts,
						resultCount: results.length,
					},
					'✓ Discovery Engine indexing complete - documents are now searchable',
				);
				return elapsed;
			}

			logger.debug(
				{
					attempt: attempts,
					maxAttempts,
					elapsedMs: elapsed,
					elapsedSeconds: `${(elapsed / 1000).toFixed(1)}s`,
					resultCount: 0,
				},
				'No results yet, waiting for Discovery Engine...',
			);

			// Wait before next poll
			if (attempts < maxAttempts) {
				await sleep(pollIntervalMs);
			}
		} catch (error) {
			logger.warn({ error, attempts, elapsed }, 'Error during indexing poll, continuing...');
			if (attempts < maxAttempts) {
				await sleep(pollIntervalMs);
			}
		}
	}

	const totalElapsed = Date.now() - startTime;
	logger.warn(
		{
			elapsedMs: totalElapsed,
			elapsedSeconds: `${(totalElapsed / 1000).toFixed(1)}s`,
			attempts,
		},
		'⚠ Timeout waiting for Discovery Engine indexing - documents may not be searchable yet',
	);

	return totalElapsed;
}

/**
 * Compares search result quality between two result sets
 */
export function compareSearchQuality(
	baseline: SearchResult[],
	enhanced: SearchResult[],
	query: string,
): {
	baselineRelevance: number;
	enhancedRelevance: number;
	improvement: number;
	topResultChanged: boolean;
} {
	// Simple relevance score based on position and score
	const calculateRelevance = (results: SearchResult[]): number => {
		return results.reduce((sum, result, index) => {
			// Weight by position (earlier results more important)
			const positionWeight = 1 / (index + 1);
			return sum + result.score * positionWeight;
		}, 0);
	};

	const baselineRelevance = calculateRelevance(baseline);
	const enhancedRelevance = calculateRelevance(enhanced);
	const improvement = ((enhancedRelevance - baselineRelevance) / baselineRelevance) * 100;

	const topResultChanged = baseline[0]?.id !== enhanced[0]?.id;

	logger.info(
		{
			query,
			baselineRelevance,
			enhancedRelevance,
			improvement: `${improvement.toFixed(1)}%`,
			topResultChanged,
		},
		'Search quality comparison',
	);

	return {
		baselineRelevance,
		enhancedRelevance,
		improvement,
		topResultChanged,
	};
}

/**
 * Generates test queries for search quality testing
 */
export function getTestQueries(): Array<{ query: string; expectedKeywords: string[] }> {
	return [
		{
			query: 'function that validates email addresses',
			expectedKeywords: ['email', 'validate', 'regex'],
		},
		{
			query: 'authentication with JWT tokens',
			expectedKeywords: ['jwt', 'token', 'auth'],
		},
		{
			query: 'password hashing and verification',
			expectedKeywords: ['password', 'hash', 'bcrypt'],
		},
		{
			query: 'API endpoint for creating users',
			expectedKeywords: ['user', 'create', 'POST', 'api'],
		},
		{
			query: 'utility to format dates for display',
			expectedKeywords: ['date', 'format', 'display'],
		},
		{
			query: 'remove duplicate values from array',
			expectedKeywords: ['duplicate', 'unique', 'array'],
		},
		{
			query: 'data cleaning and missing values',
			expectedKeywords: ['clean', 'missing', 'data'],
		},
		{
			query: 'normalize numeric data to 0-1 range',
			expectedKeywords: ['normalize', 'numeric', 'range'],
		},
	];
}

/**
 * Validates that search results contain expected keywords
 */
export function validateSearchResults(results: SearchResult[], expectedKeywords: string[], minMatches = 1): boolean {
	if (results.length === 0) {
		return false;
	}

	// Check top results for keywords
	const topResults = results.slice(0, 3);
	let matchCount = 0;

	for (const result of topResults) {
		const contentLower = result.document.originalCode.toLowerCase();
		const descriptionLower = (result.document.naturalLanguageDescription || '').toLowerCase();
		const combined = `${contentLower} ${descriptionLower}`;

		const hasMatch = expectedKeywords.some((keyword) => combined.includes(keyword.toLowerCase()));

		if (hasMatch) {
			matchCount++;
		}
	}

	return matchCount >= minMatches;
}

/**
 * Extracts statistics from search results
 */
export function getSearchStats(results: SearchResult[]): {
	avgScore: number;
	minScore: number;
	maxScore: number;
	uniqueFiles: number;
	avgCodeLength: number;
} {
	if (results.length === 0) {
		return {
			avgScore: 0,
			minScore: 0,
			maxScore: 0,
			uniqueFiles: 0,
			avgCodeLength: 0,
		};
	}

	const scores = results.map((r) => r.score);
	const files = new Set(results.map((r) => r.document.filePath));
	const codeLengths = results.map((r) => r.document.originalCode.length);

	return {
		avgScore: scores.reduce((a, b) => a + b, 0) / scores.length,
		minScore: Math.min(...scores),
		maxScore: Math.max(...scores),
		uniqueFiles: files.size,
		avgCodeLength: codeLengths.reduce((a, b) => a + b, 0) / codeLengths.length,
	};
}

/**
 * Creates a unique test data store ID
 */
export function createTestDataStoreId(prefix = 'test'): string {
	return `${prefix}-vector-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
}

/**
 * Cleans up temporary directory
 */
export async function cleanupTempDir(dir: string): Promise<void> {
	try {
		await fs.rm(dir, { recursive: true, force: true });
		logger.debug({ dir }, 'Cleaned up temporary directory');
	} catch (error) {
		logger.warn({ error, dir }, 'Failed to cleanup temporary directory');
	}
}

/**
 * Measures execution time of an async function
 */
export async function measureTime<T>(fn: () => Promise<T>, label: string): Promise<{ result: T; durationMs: number }> {
	const start = Date.now();
	const result = await fn();
	const durationMs = Date.now() - start;

	logger.info({ label, durationMs }, 'Measured execution time');

	return { result, durationMs };
}

/**
 * Retries a function with exponential backoff
 * Useful for handling eventual consistency in Discovery Engine
 */
export async function retryWithBackoff<T>(
	fn: () => Promise<T>,
	options: {
		maxAttempts?: number;
		initialDelay?: number;
		maxDelay?: number;
		factor?: number;
		shouldRetry?: (error: any) => boolean;
	} = {},
): Promise<T> {
	const { maxAttempts = 5, initialDelay = 1000, maxDelay = 30000, factor = 2, shouldRetry = () => true } = options;

	let lastError: Error | undefined;
	let delay = initialDelay;

	for (let attempt = 1; attempt <= maxAttempts; attempt++) {
		try {
			return await fn();
		} catch (error) {
			lastError = error as Error;

			if (attempt < maxAttempts && shouldRetry(error)) {
				logger.debug({ attempt, maxAttempts, delay, error: lastError.message }, 'Retrying after error');
				await sleep(Math.min(delay, maxDelay));
				delay *= factor;
			} else {
				break;
			}
		}
	}

	throw lastError;
}

/**
 * Calculates cost estimate for a configuration
 */
export function estimateConfigCost(
	config: VectorStoreConfig,
	fileCount: number,
	avgFileSize = 5000,
): {
	totalCost: number;
	costPerFile: number;
	breakdown: Record<string, number>;
} {
	const breakdown: Record<string, number> = {};

	// Base embedding cost (~$0.00001 per 1K tokens)
	const tokensPerFile = avgFileSize / 4; // rough estimate
	const baseEmbeddingCost = (tokensPerFile / 1000) * 0.00001 * fileCount;
	breakdown.base_embedding = baseEmbeddingCost;

	let totalCost = baseEmbeddingCost;

	// Dual embedding cost (2x embedding)
	if (config.dualEmbedding) {
		const dualCost = baseEmbeddingCost * 2; // Translation + second embedding
		breakdown.dual_embedding = dualCost;
		totalCost += dualCost;
	}

	// Contextual chunking cost (5 chunks per file, each with full file context)
	if (config.contextualChunking) {
		const chunksPerFile = 5;
		const contextTokens = avgFileSize + 100; // full file + prompt
		const contextCost = ((chunksPerFile * contextTokens) / 1000) * 0.00001 * fileCount;
		breakdown.contextual_chunking = contextCost;
		totalCost += contextCost;
	}

	return {
		totalCost,
		costPerFile: totalCost / fileCount,
		breakdown,
	};
}

/**
 * Pretty prints a configuration
 */
export function printConfig(config: VectorStoreConfig, label = 'Configuration'): void {
	console.log(`\n${label}:`);
	console.log('━'.repeat(50));
	console.log(`  Dual Embedding: ${config.dualEmbedding ? '✓' : '✗'}`);
	console.log(`  Contextual Chunking: ${config.contextualChunking ? '✓' : '✗'}`);
	console.log(`  Chunk Size: ${config.chunkSize || 2500}`);
	console.log(`  Strategy: ${config.chunkStrategy || 'ast'}`);
	console.log('━'.repeat(50));
}
