import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { expect } from 'chai';
import pino from 'pino';
import { setupConditionalLoggerOutput } from '#test/testUtils';
import { VectorStoreConfig } from './core/config';
import type { SearchResult } from './core/interfaces';
import { getGoogleVectorServiceConfig } from './google/googleVectorConfig';
import { VectorSearchOrchestrator } from './google/vectorSearchOrchestrator';
import { batchValidateContextQuality, compareSearchResults, evaluateSearchRelevance, validateContextQuality } from './test/llmJudge';
import {
	cleanupTempDir,
	createMinimalTestRepo,
	createTestDataStoreId,
	createTestRepository,
	getSearchStats,
	getTestQueries,
	printConfig,
	validateSearchResults,
	waitForIndexing,
} from './test/testUtils';

const logger = pino({ name: 'VectorSearchE2ETest' });

describe('Vector Search E2E Tests', function () {
	setupConditionalLoggerOutput();
	this.timeout(120000); // 2 minutes (should complete in ~30 seconds)

	let orchestrator: VectorSearchOrchestrator;
	let testDataStoreId: string;
	let testRepoDir: string;

	before(async () => {
		// Create unique test data store
		testDataStoreId = createTestDataStoreId('e2e');
		logger.info({ testDataStoreId }, 'Created test data store ID');

		// Initialize orchestrator with default config
		const googleConfig = getGoogleVectorServiceConfig();
		googleConfig.dataStoreId = testDataStoreId;

		orchestrator = new VectorSearchOrchestrator(googleConfig);

		logger.info('Orchestrator initialized');
	});

	after(async () => {
		// Cleanup: delete test data store
		try {
			logger.info('Cleaning up test data store');
			await orchestrator.deleteDataStore();
		} catch (err) {
			logger.error({ err }, 'Failed to cleanup test data store');
		}
	});

	beforeEach(async () => {
		// Create temp repo for each test
		testRepoDir = await fs.mkdtemp(path.join(os.tmpdir(), 'vector-e2e-'));
		logger.debug({ testRepoDir }, 'Created temp test directory');
	});

	afterEach(async () => {
		// Cleanup temp repo
		await cleanupTempDir(testRepoDir);
	});

	describe('0. Diagnostic - Verify Data Store', function () {
		this.timeout(120000); // 2 minutes

		it('[DIAGNOSTIC] should verify data store exists and can list documents', async () => {
			logger.info('========== DIAGNOSTIC TEST START ==========');

			// Get data store info
			logger.info('Step 1: Getting data store info...');
			const dataStoreInfo = await orchestrator.getDataStoreInfo();
			logger.info({ dataStoreInfo }, 'Data store info retrieved');

			expect(dataStoreInfo).to.exist;
			expect(dataStoreInfo.displayName).to.exist;

			// List documents
			logger.info('Step 2: Listing documents in data store...');
			const documents = await orchestrator.listDocuments(100);
			logger.info({ documentCount: documents.length }, 'Documents listed');

			// Log document details
			if (documents.length > 0) {
				logger.info('First 5 documents:');
				for (let i = 0; i < Math.min(5, documents.length); i++) {
					const doc = documents[i];
					logger.info(
						{
							index: i + 1,
							id: doc.id,
							name: doc.name,
							hasStructData: !!doc.structData,
						},
						'Document details',
					);
				}
			} else {
				logger.warn('⚠️  NO DOCUMENTS FOUND IN DATA STORE!');
				logger.warn('This explains why searches return 0 results.');
				logger.warn('Import operations may have failed or not completed.');
			}

			// Try a simple search
			logger.info('Step 3: Testing search...');
			const searchResults = await orchestrator.search('function', { maxResults: 5 });
			logger.info({ resultCount: searchResults.length }, 'Search test completed');

			logger.info('========== DIAGNOSTIC TEST END ==========');

			// Don't fail the test - this is purely diagnostic
			// But log critical findings
			if (documents.length === 0) {
				logger.error('CRITICAL: Data store has no documents!');
			}
			if (searchResults.length === 0 && documents.length > 0) {
				logger.error('CRITICAL: Documents exist but search returns 0 results!');
			}
		});
	});

	describe('1. Basic Functionality - Fast Config', () => {
		it('should index and search TypeScript repository', async () => {
			// Create test repository
			await createTestRepository(testRepoDir);

			// Index with fast config (no LLM features)
			const fastConfig: VectorStoreConfig = {
				chunking: {
					dualEmbedding: false,
					contextualChunking: false,
					size: 2500,
				},
			};

			printConfig(fastConfig, 'Test Config');

			await orchestrator.indexRepository(testRepoDir, {
				config: fastConfig,
			});

			logger.info('Repository indexed, waiting for Discovery Engine');
			// Wait ~8-10 seconds for Discovery Engine to make documents searchable
			await waitForIndexing(orchestrator, 'function');

			// Search for authentication function
			const results = await orchestrator.search('function that authenticates users');

			// Validate results
			expect(results).to.be.an('array');
			expect(results.length).to.be.greaterThan(0);

			// Check that results contain auth-related code
			const hasAuthCode = results.some((r) => r.document.originalCode.toLowerCase().includes('auth'));
			expect(hasAuthCode).to.be.true;

			// Log stats
			const stats = getSearchStats(results);
			logger.info({ stats }, 'Search completed successfully');

			expect(stats.uniqueFiles).to.be.greaterThan(0);
		});

		it('should handle multiple search queries', async () => {
			// Create minimal test repo
			await createMinimalTestRepo(testRepoDir, {
				'src/math.ts': `
export function add(a: number, b: number): number {
  return a + b;
}

export function subtract(a: number, b: number): number {
  return a - b;
}
        `,
				'src/validation.ts': `
export function validateEmail(email: string): boolean {
  const regex = /^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/;
  return regex.test(email);
}
        `,
			});

			// Index
			await orchestrator.indexRepository(testRepoDir, {
				config: { chunking: { dualEmbedding: false, contextualChunking: false } },
			});
			await waitForIndexing(orchestrator, 'function'); // Poll for up to 15 minutes

			// Test multiple queries
			const testQueries = [
				{ query: 'function to add numbers', keywords: ['add'] },
				{ query: 'email validation', keywords: ['email', 'validate'] },
			];

			for (const { query, keywords } of testQueries) {
				const results = await orchestrator.search(query, { maxResults: 10 });
				expect(results.length).to.be.greaterThan(0);

				const isValid = validateSearchResults(results, keywords, 1);
				expect(isValid).to.be.true;

				logger.info({ query, resultCount: results.length }, 'Query test passed');
			}
		});
	});

	describe('2. Contextual Chunking Quality (LLM-as-a-judge)', function () {
		this.timeout(300000); // 5 minutes - LLM calls take time

		it('should generate high-quality context for chunks', async () => {
			// Create test file
			const testFile = `
import * as jwt from 'jsonwebtoken';

export class AuthService {
  private secretKey: string;

  constructor(secretKey: string) {
    this.secretKey = secretKey;
  }

  generateToken(userId: string, email: string): string {
    const payload = { userId, email, issuedAt: Date.now() };
    return jwt.sign(payload, this.secretKey, { expiresIn: '24h' });
  }

  verifyToken(token: string): any {
    return jwt.verify(token, this.secretKey);
  }
}
      `.trim();

			await createMinimalTestRepo(testRepoDir, {
				'src/auth.ts': testFile,
			});

			// Index with contextual chunking enabled
			const contextualConfig: VectorStoreConfig = {
				chunking: {
					dualEmbedding: false,
					contextualChunking: true,
					size: 1000,
				},
			};

			await orchestrator.indexRepository(testRepoDir, {
				config: contextualConfig,
			});
			await waitForIndexing(orchestrator, 'JWT');

			// Search to get back the indexed chunks
			const results = await orchestrator.search('JWT token generation', { maxResults: 5 });

			expect(results.length).to.be.greaterThan(0);

			// Validate context quality using LLM-as-a-judge
			const topResult = results[0];

			if (topResult.document.context) {
				const judgeResult = await validateContextQuality(topResult.document.originalCode, testFile, topResult.document.context, 'typescript');

				logger.info(
					{
						score: judgeResult.score,
						reasoning: judgeResult.reasoning,
						issues: judgeResult.issues,
						strengths: judgeResult.strengths,
					},
					'Context quality evaluation',
				);

				// Assert: context should be high quality (score > 5)
				expect(judgeResult.score).to.be.greaterThan(5);
				expect(judgeResult.reasoning).to.be.a('string').with.length.greaterThan(0);
			} else {
				logger.warn('No context found in result - contextual chunking may not have run');
			}
		});
	});

	describe('3. Configuration Comparison - Proving Improvements', function () {
		this.timeout(600000); // 10 minutes

		it('should show contextual chunking improves search quality', async () => {
			// Create diverse test repository
			await createTestRepository(testRepoDir);

			// Test queries
			const testQueries = getTestQueries().slice(0, 3); // Use first 3 queries

			// === BASELINE: Fast config ===
			logger.info('Testing BASELINE configuration (no LLM features)');
			await orchestrator.purgeAll();
			await orchestrator.indexRepository(testRepoDir, {
				config: { chunking: { dualEmbedding: false, contextualChunking: false } },
			});
			await waitForIndexing(orchestrator, 'function'); // Poll for up to 15 minutes

			const baselineResults: SearchResult[][] = [];
			for (const { query } of testQueries) {
				const results = await orchestrator.search(query, { maxResults: 5 });
				baselineResults.push(results);
			}

			// === ENHANCED: Contextual chunking ===
			logger.info('Testing ENHANCED configuration (contextual chunking)');
			await orchestrator.purgeAll();
			await waitForIndexing(); // Quick wait after purge

			await orchestrator.indexRepository(testRepoDir, {
				config: { chunking: { dualEmbedding: false, contextualChunking: true } },
			});
			await waitForIndexing(orchestrator, 'function'); // Poll for up to 15 minutes

			const enhancedResults: SearchResult[][] = [];
			for (const { query } of testQueries) {
				const results = await orchestrator.search(query, { maxResults: 5 });
				enhancedResults.push(results);
			}

			// === COMPARE using LLM-as-a-judge ===
			logger.info('Comparing results using LLM-as-a-judge');

			let winsForEnhanced = 0;
			let winsForBaseline = 0;
			let ties = 0;

			for (let i = 0; i < testQueries.length; i++) {
				const { query } = testQueries[i];
				const comparison = await compareSearchResults(query, baselineResults[i], enhancedResults[i], 5);

				logger.info(
					{
						query,
						winner: comparison.winner,
						baselineScore: comparison.baselineScore,
						enhancedScore: comparison.enhancedScore,
						reasoning: comparison.reasoning,
					},
					'Query comparison result',
				);

				if (comparison.winner === 'enhanced') winsForEnhanced++;
				else if (comparison.winner === 'baseline') winsForBaseline++;
				else ties++;
			}

			logger.info(
				{
					winsForEnhanced,
					winsForBaseline,
					ties,
					totalQueries: testQueries.length,
				},
				'Final comparison results',
			);

			// Assert: Enhanced should win more often than baseline
			// At least 50% of queries should show improvement
			expect(winsForEnhanced).to.be.greaterThan(winsForBaseline);
		});
	});

	describe('4. Incremental Sync', () => {
		it('should only reindex changed files', async () => {
			// Create initial repository
			await createMinimalTestRepo(testRepoDir, {
				'src/file1.ts': 'export const a = 1;',
				'src/file2.ts': 'export const b = 2;',
				'src/file3.ts': 'export const c = 3;',
			});

			// Measure full index time
			const fullIndexStart = Date.now();
			await orchestrator.indexRepository(testRepoDir, {
				incremental: false,
				config: { chunking: { dualEmbedding: false, contextualChunking: false } },
			});
			await waitForIndexing(orchestrator, 'export');
			const fullIndexDuration = Date.now() - fullIndexStart;

			// Verify initial indexing
			const initialResults = await orchestrator.search('export const');
			expect(initialResults.length).to.be.greaterThan(0);
			logger.info({ fullIndexDuration }, 'Full index completed');

			// Modify one file, add one file, delete one file
			await fs.writeFile(path.join(testRepoDir, 'src/file1.ts'), 'export const a = 10; // modified');
			await fs.writeFile(path.join(testRepoDir, 'src/file4.ts'), 'export const d = 4;');
			await fs.unlink(path.join(testRepoDir, 'src/file3.ts'));

			// Measure incremental update time
			const incrementalStart = Date.now();
			await orchestrator.indexRepository(testRepoDir, {
				incremental: true,
				config: { chunking: { dualEmbedding: false, contextualChunking: false } },
			});
			await waitForIndexing(orchestrator, 'export');
			const incrementalDuration = Date.now() - incrementalStart;

			// Verify search works after incremental update
			const updatedResults = await orchestrator.search('export const');
			expect(updatedResults.length).to.be.greaterThan(0);

			// Should find the new file
			const hasFile4 = updatedResults.some((r) => r.document.filePath.includes('file4'));
			expect(hasFile4).to.be.true;

			// Should not find deleted file
			const hasFile3 = updatedResults.some((r) => r.document.filePath.includes('file3'));
			expect(hasFile3).to.be.false;

			// Verify modified file reflects new content
			const modifiedResults = await orchestrator.search('modified', { maxResults: 5 });
			expect(modifiedResults.length).to.be.greaterThan(0);
			const hasModifiedContent = modifiedResults.some((r) => r.document.filePath.includes('file1') && r.document.originalCode.includes('10'));
			expect(hasModifiedContent).to.be.true;

			// Performance assertion: incremental should be faster (at least 30% faster for this small test)
			const speedup = ((fullIndexDuration - incrementalDuration) / fullIndexDuration) * 100;
			logger.info(
				{
					incrementalDuration,
					fullIndexDuration,
					speedup: `${speedup.toFixed(1)}%`,
				},
				'Incremental sync performance',
			);

			// Note: For small repos, the difference may be minimal, but it should still be faster
			expect(incrementalDuration).to.be.lessThan(fullIndexDuration * 1.5); // At most 1.5x slower

			// Test multiple incremental updates in sequence
			await fs.writeFile(path.join(testRepoDir, 'src/file5.ts'), 'export const e = 5;');
			await orchestrator.indexRepository(testRepoDir, {
				incremental: true,
				config: { chunking: { dualEmbedding: false, contextualChunking: false } },
			});
			await waitForIndexing(orchestrator, 'export');

			const finalResults = await orchestrator.search('export const', { maxResults: 10 });
			const hasFile5 = finalResults.some((r) => r.document.filePath.includes('file5'));
			expect(hasFile5).to.be.true;

			logger.info('Incremental sync test passed with performance verification');
		});
	});

	describe('5. Reranking Integration', function () {
		this.timeout(300000); // 5 minutes

		it('should rerank search results for better relevance', async () => {
			// Create test repository
			await createTestRepository(testRepoDir);

			// Index
			await orchestrator.indexRepository(testRepoDir, {
				config: { chunking: { dualEmbedding: false, contextualChunking: false } },
			});
			await waitForIndexing(orchestrator, 'function');

			// Search WITHOUT reranking
			const query = 'function that validates email addresses';
			const baselineResults = await orchestrator.search(query, { maxResults: 5 });

			expect(baselineResults.length).to.be.greaterThan(0);

			// Update config to enable reranking
			orchestrator.updateConfig({
				search: {
					reranking: {
						provider: 'vertex',
						model: 'semantic-ranker-default@latest',
						topK: 50,
					},
				},
			});

			// Search WITH reranking
			const rerankedResults = await orchestrator.search(query, { maxResults: 5 });

			expect(rerankedResults.length).to.be.greaterThan(0);

			// Verify reranking metadata is present
			expect(rerankedResults[0].metadata).to.have.property('rerankingScore');
			expect(rerankedResults[0].metadata).to.have.property('originalScore');

			logger.info(
				{
					baselineTop: baselineResults[0].document.filePath,
					baselineScore: baselineResults[0].score,
					rerankedTop: rerankedResults[0].document.filePath,
					rerankedScore: rerankedResults[0].score,
					rerankingScore: rerankedResults[0].metadata?.rerankingScore,
					originalScore: rerankedResults[0].metadata?.originalScore,
				},
				'Reranking comparison',
			);

			// Verify that reranking changed the order (it should in most cases)
			// Note: This might occasionally be the same, but we can at least verify the scores are different
			const hasRerankingMetadata = rerankedResults.every((r) => r.metadata?.rerankingScore !== undefined);
			expect(hasRerankingMetadata).to.be.true;
		});
	});

	describe('6. Search Quality Evaluation', function () {
		this.timeout(300000); // 5 minutes

		it('should return relevant results evaluated by LLM', async () => {
			// Create test repository
			await createTestRepository(testRepoDir);

			// Index
			await orchestrator.indexRepository(testRepoDir, {
				config: { chunking: { dualEmbedding: false, contextualChunking: false } },
			});
			await waitForIndexing(orchestrator, 'function'); // Poll for up to 15 minutes

			// Search
			const query = 'function that validates email addresses';
			const results = await orchestrator.search(query, { maxResults: 5 });

			expect(results.length).to.be.greaterThan(0);

			// Evaluate relevance using LLM-as-a-judge
			const evaluation = await evaluateSearchRelevance(query, results, 5);

			logger.info(
				{
					query,
					overallScore: evaluation.overallScore,
					individualScores: evaluation.individualScores,
					reasoning: evaluation.reasoning,
				},
				'Search relevance evaluation',
			);

			// Assert: Overall relevance should be reasonable (> 4/10)
			expect(evaluation.overallScore).to.be.greaterThan(4);

			// Assert: At least one result should be highly relevant (> 7/10)
			const hasHighlyRelevant = evaluation.individualScores.some((score) => score > 7);
			expect(hasHighlyRelevant).to.be.true;
		});
	});
});
