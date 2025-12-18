/**
 * Evaluation script to compare different LLMs for contextual chunking
 * Tests multiple LLMs using the best prompt across multiple code files
 *
 * Usage: node --env-file=variables/test.env -r esbuild-register src/swe/vector/evaluate-chunking-llms.ts
 *
 * Configure the test by editing the CONFIG object below
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { cerebrasZaiGLM_4_6 } from '#llm/services/cerebras';
import { claudeCodeSonnet } from '#llm/services/claudeCode';
import { openaiGPT5nano } from '#llm/services/openai';
import { vertexGemini_2_5_Flash_Lite, vertexGemini_3_0_Flash } from '#llm/services/vertexai';
import type { LLM } from '#shared/llm/llm.model';
import { validateContextQuality } from '#swe/vector/test/llmJudge';
import { ASTChunker } from './chunking/astChunker';
import { VectorStoreConfig } from './core/config';

// ============================================================================
// CONFIGURATION
// ============================================================================

const CONFIG = {
	// LLMs to compare (array of factory functions)
	llmsToTest: [openaiGPT5nano, vertexGemini_3_0_Flash, vertexGemini_2_5_Flash_Lite],

	// Test files to use for evaluation (multiple files for robust testing)
	testFiles: ['src/swe/vector/core/contextualizer.ts', 'src/swe/vector/chunking/astChunker.ts', 'src/swe/vector/codeLoader.ts'],

	// How many chunks to test per file (to limit API calls)
	chunksPerFile: 2,

	// Enable LLM-as-a-judge quality evaluation (adds extra API calls)
	enableQualityEvaluation: true,

	// Judge LLM for quality evaluation (evaluates generated context quality)
	judgeLLM: claudeCodeSonnet,
};

// ============================================================================
// PROMPT - Using best prompt from prompt evaluation
// ============================================================================

const QUERY_ORIENTED_PROMPT = (chunkContent: string, fullDocumentContent: string, language: string, filePath: string): string => `
Generate search-optimized context for this ${language} code chunk.

<document path="${filePath}">
${fullDocumentContent}
</document>

<chunk>
${chunkContent}
</chunk>

Write 2-4 sentences that help developers find this code through:
- **Semantic search**: Describe what it does and why it exists
- **Keyword search**: Include specific technical terms, APIs, patterns, and domain concepts

Focus on:
1. **What problem this solves** - the use case or scenario
2. **Key technical terms** - APIs, algorithms, patterns, libraries used
3. **Domain context** - how it fits in the broader system
4. **Searchable concepts** - terms developers would query for

Avoid repeating code that's already visible. Think: "If a developer searches for X, should they find this chunk?"

Context:`;

// ============================================================================
// TYPES
// ============================================================================

interface TestChunk {
	filePath: string;
	fileContent: string;
	chunkContent: string;
	chunkIndex: number;
	startLine: number;
	endLine: number;
}

interface ComparisonResult {
	llmName: string;
	context: string;
	tokenCount: number;
	generationTimeMs: number;
	keywordDensity: number;
	uniqueTerms: string[];
	qualityScore?: number; // LLM-as-a-judge score (1-10)
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

async function generateContext(llm: LLM, prompt: string, llmName: string): Promise<ComparisonResult> {
	const startTime = Date.now();
	const context = await llm.generateText(prompt, { id: `Context Generation: ${llmName}` });
	const generationTimeMs = Date.now() - startTime;

	// Rough token count estimation (1 token ≈ 4 chars)
	const tokenCount = Math.ceil(context.length / 4);

	// Extract technical terms (simple heuristic: capitalized words, camelCase, snake_case)
	const technicalTerms = context.match(/\b[A-Z][a-zA-Z]*|[a-z]+[A-Z][a-zA-Z]*|\w+_\w+/g) || [];
	const uniqueTerms = [...new Set(technicalTerms)];

	// Calculate keyword density (technical terms per 100 words)
	const wordCount = context.split(/\s+/).length;
	const keywordDensity = (uniqueTerms.length / wordCount) * 100;

	return {
		llmName,
		context: context.trim(),
		tokenCount,
		generationTimeMs,
		keywordDensity,
		uniqueTerms,
	};
}

// ============================================================================
// MAIN EVALUATION
// ============================================================================

async function compareLLMs() {
	console.log(`\n${'='.repeat(80)}`);
	console.log('LLM EVALUATION FOR CONTEXTUAL CHUNKING');
	console.log(`${'='.repeat(80)}\n`);

	// Get judge LLM instance
	const judgeLLM = CONFIG.judgeLLM();

	console.log(`Testing ${CONFIG.llmsToTest.length} LLMs`);
	if (CONFIG.enableQualityEvaluation) {
		console.log(`Judge LLM: ${judgeLLM.getId()}`);
	}
	console.log();

	// Prepare chunker and config
	const chunker = new ASTChunker();
	const vectorConfig: VectorStoreConfig = {
		chunking: {
			contextualChunking: false, // We just need raw chunks
			size: 1500,
			overlap: 200,
			dualEmbedding: false,
		},
	};

	// Load and chunk all test files
	console.log(`📝 Loading and chunking ${CONFIG.testFiles.length} test files...\n`);
	const testChunks: TestChunk[] = [];

	for (const filePath of CONFIG.testFiles) {
		const fullPath = path.join(process.cwd(), filePath);
		try {
			const fileContent = await fs.readFile(fullPath, 'utf-8');
			const language = path.extname(filePath).substring(1);

			console.log(`  ${filePath}`);

			// Chunk the file
			const rawChunks = await chunker.chunk(
				{
					filePath,
					relativePath: filePath,
					content: fileContent,
					language,
					size: fileContent.length,
					lastModified: new Date(),
				},
				vectorConfig,
			);

			console.log(`    ✓ Created ${rawChunks.length} chunks, using first ${CONFIG.chunksPerFile}`);

			// Take first N chunks from this file
			const chunksToUse = rawChunks.slice(0, CONFIG.chunksPerFile);
			for (let i = 0; i < chunksToUse.length; i++) {
				const chunk = chunksToUse[i];
				testChunks.push({
					filePath,
					fileContent,
					chunkContent: chunk.content,
					chunkIndex: i,
					startLine: chunk.sourceLocation.startLine,
					endLine: chunk.sourceLocation.endLine,
				});
			}
		} catch (error) {
			console.error(`    ❌ Error processing ${filePath}:`, error instanceof Error ? error.message : error);
		}
	}

	console.log(`\n✓ Total test chunks: ${testChunks.length}\n`);

	if (testChunks.length === 0) {
		console.error('❌ No chunks to test. Exiting.\n');
		return;
	}

	console.log(`\n🚀 Running ${CONFIG.llmsToTest.length} LLMs in parallel across ${testChunks.length} chunks...\n`);

	// Helper function to test one LLM across all chunks
	async function testLLM(llmFactory: () => LLM) {
		const llm = llmFactory();
		const llmName = llm.getId();

		console.log(`🤖 Starting ${llmName}...`);

		const chunkResults: ComparisonResult[] = [];

		for (const testChunk of testChunks) {
			const chunkLabel = `${testChunk.filePath} (chunk ${testChunk.chunkIndex}, lines ${testChunk.startLine}-${testChunk.endLine})`;

			try {
				// Use the best prompt (Query-Oriented)
				const prompt = QUERY_ORIENTED_PROMPT(testChunk.chunkContent, testChunk.fileContent, 'typescript', testChunk.filePath);

				const result = await generateContext(llm, prompt, llmName);

				// Evaluate quality with LLM-as-a-judge (if enabled)
				if (CONFIG.enableQualityEvaluation) {
					try {
						const qualityResult = await validateContextQuality(testChunk.chunkContent, result.context, testChunk.fileContent, 'typescript', judgeLLM);
						result.qualityScore = qualityResult.score;
						console.log(`  ✓ ${llmName} - ${chunkLabel}: ${result.generationTimeMs}ms (Quality: ${result.qualityScore}/10)`);
					} catch (judgeError) {
						console.log(`  ⚠️  ${llmName} - ${chunkLabel}: Quality evaluation failed (${result.generationTimeMs}ms)`);
					}
				} else {
					console.log(`  ✓ ${llmName} - ${chunkLabel}: ${result.generationTimeMs}ms`);
				}

				chunkResults.push(result);
			} catch (error) {
				console.error(`  ❌ ${llmName} - ${chunkLabel}: Failed - ${error instanceof Error ? error.message : error}`);
			}
		}

		console.log(`✅ Completed ${llmName} (${chunkResults.length}/${testChunks.length} chunks successful)`);
		return { llmName, results: chunkResults };
	}

	// Run all LLMs in parallel
	const llmTestPromises = CONFIG.llmsToTest.map((llmFactory) => testLLM(llmFactory));
	const llmTestResults = await Promise.all(llmTestPromises);

	// Build results map
	const llmResults = new Map<string, ComparisonResult[]>();
	for (const { llmName, results } of llmTestResults) {
		llmResults.set(llmName, results);
	}

	// Aggregate results per LLM
	const aggregatedResults: ComparisonResult[] = [];

	for (const llmFactory of CONFIG.llmsToTest) {
		const llm = llmFactory();
		const llmName = llm.getId();
		const chunkResults = llmResults.get(llmName) || [];

		if (chunkResults.length === 0) {
			console.warn(`⚠️  No results for ${llmName}`);
			continue;
		}

		// Calculate averages
		const avgQuality =
			chunkResults.filter((r) => r.qualityScore).length > 0
				? chunkResults.reduce((sum, r) => sum + (r.qualityScore || 0), 0) / chunkResults.filter((r) => r.qualityScore).length
				: undefined;

		const avgTime = chunkResults.reduce((sum, r) => sum + r.generationTimeMs, 0) / chunkResults.length;
		const avgTokens = Math.ceil(chunkResults.reduce((sum, r) => sum + r.tokenCount, 0) / chunkResults.length);

		// Collect unique technical terms across all chunks
		const allTerms = new Set<string>();
		chunkResults.forEach((r) => r.uniqueTerms.forEach((t) => allTerms.add(t)));

		const avgKeywordDensity = chunkResults.reduce((sum, r) => sum + r.keywordDensity, 0) / chunkResults.length;

		aggregatedResults.push({
			llmName,
			context: `Aggregated from ${chunkResults.length} chunks`, // Not showing individual contexts
			tokenCount: avgTokens,
			generationTimeMs: avgTime,
			keywordDensity: avgKeywordDensity,
			uniqueTerms: Array.from(allTerms),
			qualityScore: avgQuality,
		});
	}

	if (aggregatedResults.length === 0) {
		console.error('\n❌ No results generated. All LLMs failed.\n');
		return;
	}

	const results = aggregatedResults;

	// Display results
	console.log(`\n\n${'='.repeat(80)}`);
	console.log('AGGREGATED RESULTS (averaged across all test chunks)');
	console.log(`${'='.repeat(80)}\n`);

	for (const result of results) {
		console.log('─'.repeat(80));
		console.log(`🤖 ${result.llmName}`);
		console.log('─'.repeat(80));
		console.log(`\n${result.context}\n`);
		console.log('Average Metrics:');
		if (result.qualityScore) {
			console.log(`  - Quality score: ${result.qualityScore.toFixed(1)}/10`);
		}
		console.log(`  - Generation time: ${Math.round(result.generationTimeMs)}ms`);
		console.log(`  - Token count: ${result.tokenCount} tokens`);
		console.log(`  - Keyword density: ${result.keywordDensity.toFixed(1)}% (${result.uniqueTerms.length} unique terms total)`);
		console.log();
	}

	// Summary comparison
	console.log('='.repeat(80));
	console.log('SUMMARY');
	console.log(`${'='.repeat(80)}\n`);

	if (results.some((r) => r.qualityScore)) {
		console.log('Quality Score (Higher is Better):');
		const sortedByQuality = [...results].sort((a, b) => (b.qualityScore || 0) - (a.qualityScore || 0));
		for (const result of sortedByQuality) {
			if (result.qualityScore) {
				const bar = '█'.repeat(Math.ceil(result.qualityScore));
				console.log(`  ${result.llmName.padEnd(30)} ${bar} ${result.qualityScore.toFixed(1)}/10`);
			}
		}
		console.log();
	}

	console.log('Generation Speed (Lower is Better):');
	const sortedBySpeed = [...results].sort((a, b) => a.generationTimeMs - b.generationTimeMs);
	for (const result of sortedBySpeed) {
		const bar = '█'.repeat(Math.ceil(result.generationTimeMs / 100));
		console.log(`  ${result.llmName.padEnd(30)} ${bar} ${Math.round(result.generationTimeMs)}ms`);
	}

	console.log('\nKeyword Density (Higher is Better):');
	const sortedByKeywords = [...results].sort((a, b) => b.keywordDensity - a.keywordDensity);
	for (const result of sortedByKeywords) {
		const bar = '█'.repeat(Math.ceil(result.keywordDensity));
		console.log(`  ${result.llmName.padEnd(30)} ${bar} ${result.keywordDensity.toFixed(1)}%`);
	}

	console.log(`\n${'='.repeat(80)}`);
	console.log('RECOMMENDATIONS');
	console.log(`${'='.repeat(80)}\n`);

	// Find best overall
	const bestQuality = results.some((r) => r.qualityScore)
		? results.reduce((best, curr) => ((curr.qualityScore || 0) > (best.qualityScore || 0) ? curr : best))
		: null;

	if (bestQuality) {
		console.log(`⭐ Highest quality: ${bestQuality.llmName} (${bestQuality.qualityScore?.toFixed(1)}/10)`);
	}

	const fastest = results.reduce((best, curr) => (curr.generationTimeMs < best.generationTimeMs ? curr : best));
	console.log(`⚡ Fastest: ${fastest.llmName} (${Math.round(fastest.generationTimeMs)}ms)`);

	const bestKeywords = results.reduce((best, curr) => (curr.keywordDensity > best.keywordDensity ? curr : best));
	console.log(`🏆 Best keyword density: ${bestKeywords.llmName} (${bestKeywords.keywordDensity.toFixed(1)}%)`);

	// Generate report
	const reportDir = path.join(process.cwd(), '.typedai', 'evaluations');
	await fs.mkdir(reportDir, { recursive: true });

	const timestamp = new Date().toISOString().replace(/:/g, '-').split('.')[0];
	const reportPath = path.join(reportDir, `llm-evaluation-${timestamp}.json`);

	const report = {
		timestamp: new Date().toISOString(),
		evaluationType: 'llm-comparison',
		llmsTested: CONFIG.llmsToTest.map((factory) => factory().getId()),
		judgeLLM: CONFIG.enableQualityEvaluation ? judgeLLM.getId() : null,
		testFiles: CONFIG.testFiles,
		chunksPerFile: CONFIG.chunksPerFile,
		totalChunks: testChunks.length,
		results,
		summary: {
			highestQuality: bestQuality,
			fastest,
			bestKeywordDensity: bestKeywords,
		},
	};

	await fs.writeFile(reportPath, JSON.stringify(report, null, 2), 'utf-8');

	console.log(`\n📊 Report saved to: ${reportPath}`);
	console.log('\n✅ Evaluation complete!\n');
}

// ============================================================================
// MAIN EXECUTION
// ============================================================================

compareLLMs().catch((error) => {
	console.error('\n❌ Error during evaluation:', error);
	process.exit(1);
});
