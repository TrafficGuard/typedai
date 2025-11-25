/**
 * Evaluation script to test prompt variants for contextualizedChunker.ts
 *
 * Purpose: Compare the production GENERATE_CHUNK_CONTEXT_PROMPT (Anthropic baseline)
 * against experimental prompt variants to determine which generates the best contextual
 * information for semantic vector search.
 *
 * Based on Anthropic's Contextual Retrieval technique:
 * @see https://www.anthropic.com/news/contextual-retrieval
 * @see src/swe/vector/google/docs/contextual-retrieval.md
 *
 * Usage: pnpm eval:prompts
 *
 * Configure the test by editing the CONFIG object below
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { cerebrasGptOss_120b } from '#llm/services/cerebras';
import { claudeCodeDefault } from '#llm/services/claudeCode';
import type { LLM } from '#shared/llm/llm.model';
import { validateContextQuality } from '#swe/vector/test/llmJudge';
import { DEFAULT_VECTOR_CONFIG } from './core/config';
import { LLMContextualizer } from './core/contextualizer';

// ============================================================================
// CONFIGURATION
// ============================================================================

const CONFIG = {
	// LLM to use for generating contextual chunks
	generationLLM: cerebrasGptOss_120b,

	// Test files to use for evaluation - variety of languages and file types
	testFiles: [
		// Backend TypeScript
		'src/swe/vector/core/contextualizer.ts',
		// Frontend Angular service
		'frontend/src/app/core/auth/auth.service.ts',
		// Frontend Angular template (HTML)
		'frontend/src/app/layout/common/notifications/notifications.component.html',
		// Python
		'src/swe/vector/test/fixtures/python/data_processor.py',
		// Config file (JSON)
		'frontend/tsconfig.json',
	],

	// How many chunks to test per file (to limit API calls)
	chunksPerFile: 3,

	// Judge LLM for quality evaluation (evaluates generated context quality)
	judgeLLM: claudeCodeDefault,
};

const GENERATE_CHUNK_CONTEXT_PROMPT = (chunkContent: string, fullDocumentContent: string, language: string): string => `
<document lang="${language}">
${fullDocumentContent}
</document>
Here is the chunk we want to situate within the whole document. It is also in ${language}.
<chunk>
${chunkContent}
</chunk>
Please give a short succinct context to situate this chunk within the overall document for the purposes of improving search retrieval of the chunk.
Focus on the relationship of this chunk to the rest of the document, its purpose within the document, and any key interactions or dependencies it has with other parts of the document.
Answer only with the succinct context and nothing else.
`;

// ============================================================================
// PROMPT VARIANTS
// ============================================================================
// GENERATE_CHUNK_CONTEXT_PROMPT is imported from contextualizedChunker.ts
// It represents the Anthropic baseline currently used in production

// Experimental Variant 1: Chain-of-Thought V1
// Two-step reasoning: analyze → synthesize
const CHAIN_OF_THOUGHT_V1_PROMPT = (chunkContent: string, fullDocumentContent: string, language: string): string => `
<document lang="${language}">
${fullDocumentContent}
</document>

<chunk>
${chunkContent}
</chunk>

First, briefly analyze (1-2 sentences):
- What is the parent class/module/namespace?
- What other functions/classes does this interact with?
- What is its primary purpose?

Then, synthesize this analysis into a final concise context (2-3 sentences, max 70 words) that would help developers find this code through semantic search.

Format your response as:
Analysis: [your analysis]
Context: [final context for search]`;

// Experimental Variant 2: Chain-of-Thought V2
// Adds explicit format constraints to prevent full-file dumps
const CHAIN_OF_THOUGHT_V2_PROMPT = (chunkContent: string, fullDocumentContent: string, language: string): string => `
<document lang="${language}">
${fullDocumentContent}
</document>

<chunk>
${chunkContent}
</chunk>

CRITICAL: Your response must be EXACTLY in this format. Do NOT include the full document content in your response.

Step 1 - Analyze (1-2 sentences):
- Parent class/module?
- Interactions/dependencies?
- Primary purpose?

Step 2 - Context (2-3 sentences, MAXIMUM 70 words):
Write a concise description for semantic search.

Response format:
Analysis: [1-2 sentences]
Context: [2-3 sentences, max 70 words]`;

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
	promptName: string;
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

async function generateContext(llm: LLM, prompt: string, promptName: string): Promise<ComparisonResult> {
	const startTime = Date.now();
	const context = await llm.generateText(prompt, { id: `Context Generation: ${promptName}` });
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
		promptName,
		context: context.trim(),
		tokenCount,
		generationTimeMs,
		keywordDensity,
		uniqueTerms,
	};
}

async function comparePrompts() {
	console.log(`\n${'='.repeat(80)}`);
	console.log('CONTEXTUAL CHUNKING PROMPT EVALUATION');
	console.log(`${'='.repeat(80)}\n`);

	// Get LLM instances from factory functions
	const llm = CONFIG.generationLLM();
	const judgeLLM = CONFIG.judgeLLM();

	console.log(`Generation LLM: ${llm.getId()}`);
	console.log(`Judge LLM: ${judgeLLM.getId()}`);
	console.log();

	// Load and chunk all test files using LLM-based contextualized chunking
	console.log(`📝 Loading and chunking ${CONFIG.testFiles.length} test files using LLM chunker...\n`);
	const testChunks: TestChunk[] = [];

	const contextualConfig = { ...DEFAULT_VECTOR_CONFIG, contextualChunking: true };

	for (const filePath of CONFIG.testFiles) {
		const fullPath = path.join(process.cwd(), filePath);
		try {
			const fileContent = await fs.readFile(fullPath, 'utf-8');
			const language = path.extname(filePath).substring(1);

			console.log(`  ${filePath}`);

			// Use LLM-based chunker to identify logical chunks
			const contextualizer = new LLMContextualizer(llm);
			const contextualizedChunks = await contextualizer.contextualize(
				[],
				{
					filePath,
					relativePath: filePath,
					language,
					content: fileContent,
					size: Buffer.byteLength(fileContent, 'utf8'),
					lastModified: new Date(0),
				},
				contextualConfig,
			);

			console.log(`    ✓ LLM identified ${contextualizedChunks.length} chunks, using first ${CONFIG.chunksPerFile}`);

			const chunksToUse = contextualizedChunks.slice(0, CONFIG.chunksPerFile);
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

	// Test each prompt variant
	const prompts = [
		{ name: 'Anthropic Baseline (Production)', generator: GENERATE_CHUNK_CONTEXT_PROMPT },
		{ name: 'Chain-of-Thought V1', generator: CHAIN_OF_THOUGHT_V1_PROMPT },
		{ name: 'Chain-of-Thought V2', generator: CHAIN_OF_THOUGHT_V2_PROMPT },
	];

	console.log(`\n🚀 Running ${prompts.length} prompt variants in parallel across ${testChunks.length} chunks...\n`);

	// Helper function to test one prompt variant across all chunks
	type PromptGenerator = (chunkContent: string, fullDocumentContent: string, language: string) => string;
	async function testPromptVariant(prompt: { name: string; generator: PromptGenerator }) {
		console.log(`📝 Starting ${prompt.name}...`);

		const chunkResults: ComparisonResult[] = [];

		for (const testChunk of testChunks) {
			const chunkLabel = `${testChunk.filePath} (chunk ${testChunk.chunkIndex}, lines ${testChunk.startLine}-${testChunk.endLine})`;

			try {
				// All prompts now have the same signature: (chunkContent, fullDocumentContent, language)
				const promptText = (prompt.generator as any)(testChunk.chunkContent, testChunk.fileContent, 'typescript');

				const result = await generateContext(llm, promptText, prompt.name);

				// Evaluate quality with LLM-as-a-judge
				try {
					const qualityResult = await validateContextQuality(testChunk.chunkContent, result.context, testChunk.fileContent, 'typescript', judgeLLM);
					result.qualityScore = qualityResult.score;
					console.log(`  ✓ ${prompt.name} - ${chunkLabel}: ${result.generationTimeMs}ms (Quality: ${result.qualityScore}/10)`);
				} catch (judgeError) {
					console.log(`  ⚠️  ${prompt.name} - ${chunkLabel}: Quality evaluation failed (${result.generationTimeMs}ms)`);
				}

				chunkResults.push(result);
			} catch (error) {
				console.error(`  ❌ ${prompt.name} - ${chunkLabel}: Failed - ${error instanceof Error ? error.message : error}`);
			}
		}

		console.log(`✅ Completed ${prompt.name} (${chunkResults.length}/${testChunks.length} chunks successful)`);
		return { promptName: prompt.name, results: chunkResults };
	}

	// Run all prompt variants in parallel
	const promptTestPromises = prompts.map((prompt) => testPromptVariant(prompt));
	const promptTestResults = await Promise.all(promptTestPromises);

	// Build results map
	const promptResults = new Map<string, ComparisonResult[]>();
	for (const { promptName, results } of promptTestResults) {
		promptResults.set(promptName, results);
	}

	// Aggregate results per prompt
	const aggregatedResults: ComparisonResult[] = [];

	for (const prompt of prompts) {
		const chunkResults = promptResults.get(prompt.name) || [];

		if (chunkResults.length === 0) {
			console.warn(`⚠️  No results for ${prompt.name}`);
			continue;
		}

		const avgTime = chunkResults.reduce((sum, r) => sum + r.generationTimeMs, 0) / chunkResults.length;
		const avgTokens = Math.ceil(chunkResults.reduce((sum, r) => sum + r.tokenCount, 0) / chunkResults.length);

		const allTerms = new Set<string>();
		chunkResults.forEach((r) => r.uniqueTerms.forEach((t) => allTerms.add(t)));

		const avgKeywordDensity = chunkResults.reduce((sum, r) => sum + r.keywordDensity, 0) / chunkResults.length;

		// Calculate average quality score if available
		const avgQuality =
			chunkResults.filter((r) => r.qualityScore).length > 0
				? chunkResults.reduce((sum, r) => sum + (r.qualityScore || 0), 0) / chunkResults.filter((r) => r.qualityScore).length
				: undefined;

		aggregatedResults.push({
			promptName: prompt.name,
			context: `Aggregated from ${chunkResults.length} chunks`,
			tokenCount: avgTokens,
			generationTimeMs: avgTime,
			keywordDensity: avgKeywordDensity,
			uniqueTerms: Array.from(allTerms),
			qualityScore: avgQuality,
		});
	}

	const results = aggregatedResults;

	// Display results
	console.log(`\n\n${'='.repeat(80)}`);
	console.log('AGGREGATED RESULTS (averaged across all test chunks)');
	console.log(`${'='.repeat(80)}\n`);

	for (const result of results) {
		console.log('─'.repeat(80));
		console.log(`📝 ${result.promptName}`);
		console.log('─'.repeat(80));
		console.log(`\n${result.context}\n`);
		console.log('Average Metrics:');
		if (result.qualityScore) {
			console.log(`  - Quality score: ${result.qualityScore.toFixed(1)}/10`);
		}
		console.log(`  - Token count: ${result.tokenCount} tokens`);
		console.log(`  - Generation time: ${Math.round(result.generationTimeMs)}ms`);
		console.log(`  - Keyword density: ${result.keywordDensity.toFixed(1)}% (${result.uniqueTerms.length} unique terms total)`);
		console.log(`  - Technical terms: ${result.uniqueTerms.slice(0, 10).join(', ')}${result.uniqueTerms.length > 10 ? '...' : ''}`);
		console.log();
	}

	// Summary comparison
	console.log('='.repeat(80));
	console.log('SUMMARY');
	console.log(`${'='.repeat(80)}\n`);

	// Show quality scores if available
	if (results.some((r) => r.qualityScore)) {
		console.log('Quality Score (Higher is Better):');
		const sortedByQuality = [...results].sort((a, b) => (b.qualityScore || 0) - (a.qualityScore || 0));
		for (const result of sortedByQuality) {
			if (result.qualityScore) {
				const bar = '█'.repeat(Math.ceil(result.qualityScore));
				console.log(`  ${result.promptName.padEnd(40)} ${bar} ${result.qualityScore.toFixed(1)}/10`);
			}
		}
		console.log();
	}

	console.log('Token Count Comparison:');
	for (const result of results) {
		const bar = '█'.repeat(Math.ceil(result.tokenCount / 5));
		console.log(`  ${result.promptName.padEnd(40)} ${bar} ${result.tokenCount}`);
	}

	console.log('\nKeyword Density Comparison:');
	for (const result of results) {
		const bar = '█'.repeat(Math.ceil(result.keywordDensity));
		console.log(`  ${result.promptName.padEnd(40)} ${bar} ${result.keywordDensity.toFixed(1)}%`);
	}

	console.log('\nGeneration Time Comparison:');
	for (const result of results) {
		const bar = '█'.repeat(Math.ceil(result.generationTimeMs / 100));
		console.log(`  ${result.promptName.padEnd(40)} ${bar} ${Math.round(result.generationTimeMs)}ms`);
	}

	console.log(`\n${'='.repeat(80)}`);
	console.log('RECOMMENDATIONS');
	console.log(`${'='.repeat(80)}\n`);

	// Find best by quality score
	const bestQuality = results.some((r) => r.qualityScore)
		? results.reduce((best, curr) => ((curr.qualityScore || 0) > (best.qualityScore || 0) ? curr : best))
		: null;

	if (bestQuality) {
		console.log(`⭐ Highest quality: ${bestQuality.promptName} (${bestQuality.qualityScore?.toFixed(1)}/10)`);
	}

	// Find best by keyword density
	const bestKeywords = results.reduce((best, curr) => (curr.keywordDensity > best.keywordDensity ? curr : best));
	console.log(`🏆 Best keyword density: ${bestKeywords.promptName} (${bestKeywords.keywordDensity.toFixed(1)}%)`);

	// Find shortest generation time
	const fastest = results.reduce((best, curr) => (curr.generationTimeMs < best.generationTimeMs ? curr : best));
	console.log(`⚡ Fastest generation: ${fastest.promptName} (${Math.round(fastest.generationTimeMs)}ms)`);

	// Find most concise
	const mostConcise = results.reduce((best, curr) => (curr.tokenCount < best.tokenCount ? curr : best));
	console.log(`📏 Most concise: ${mostConcise.promptName} (${mostConcise.tokenCount} tokens)`);

	// Generate report
	const reportDir = path.join(process.cwd(), '.typedai', 'evaluations');
	await fs.mkdir(reportDir, { recursive: true });

	const timestamp = new Date().toISOString().replace(/:/g, '-').split('.')[0];
	const reportPath = path.join(reportDir, `prompt-evaluation-${timestamp}.json`);

	// Build detailed per-chunk results for report
	const detailedResults: Record<string, Array<{ chunkInfo: TestChunk; generatedContext: string; qualityScore?: number }>> = {};

	for (const { promptName, results: chunkResults } of promptTestResults) {
		detailedResults[promptName] = testChunks.map((testChunk, idx) => {
			const result = chunkResults[idx];
			return {
				chunkInfo: testChunk,
				generatedContext: result?.context || 'ERROR: Generation failed',
				qualityScore: result?.qualityScore,
			};
		});
	}

	const report = {
		timestamp: new Date().toISOString(),
		evaluationType: 'prompt-comparison',
		generationLLM: llm.getId(),
		judgeLLM: judgeLLM.getId(),
		testFiles: CONFIG.testFiles,
		chunksPerFile: CONFIG.chunksPerFile,
		totalChunks: testChunks.length,
		aggregatedResults: results,
		detailedResults,
		summary: {
			highestQuality: bestQuality,
			bestKeywordDensity: bestKeywords,
			fastest,
			mostConcise,
		},
	};

	await fs.writeFile(reportPath, JSON.stringify(report, null, 2), 'utf-8');

	// Generate human-readable markdown report
	const mdReportPath = reportPath.replace('.json', '.md');
	let mdReport = `# Contextual Chunking Prompt Evaluation Report

**Generated:** ${new Date().toISOString()}
**Generation LLM:** ${llm.getId()}
**Judge LLM:** ${judgeLLM.getId()}
**Test Files:** ${CONFIG.testFiles.length}
**Total Chunks:** ${testChunks.length}

---

## Summary

| Prompt | Quality Score | Token Count | Generation Time | Keyword Density |
|--------|--------------|-------------|-----------------|-----------------|
`;

	for (const result of results) {
		mdReport += `| ${result.promptName} | ${result.qualityScore?.toFixed(1) || 'N/A'}/10 | ${result.tokenCount} | ${Math.round(result.generationTimeMs)}ms | ${result.keywordDensity.toFixed(1)}% |\n`;
	}

	mdReport += `\n---\n\n## Recommendations

⭐ **Highest quality:** ${bestQuality?.promptName} (${bestQuality?.qualityScore?.toFixed(1)}/10)
🏆 **Best keyword density:** ${bestKeywords.promptName} (${bestKeywords.keywordDensity.toFixed(1)}%)
⚡ **Fastest generation:** ${fastest.promptName} (${Math.round(fastest.generationTimeMs)}ms)
📏 **Most concise:** ${mostConcise.promptName} (${mostConcise.tokenCount} tokens)

---

## Generated Chunks by Prompt

`;

	// Generate chunks section for each prompt
	for (const { promptName, results: chunkResults } of promptTestResults) {
		mdReport += `### ${promptName}\n\n`;

		for (let i = 0; i < testChunks.length; i++) {
			const testChunk = testChunks[i];
			const result = chunkResults[i];

			mdReport += `#### Chunk ${i + 1}: \`${testChunk.filePath}\` (lines ${testChunk.startLine}-${testChunk.endLine})\n\n`;

			if (result?.qualityScore) {
				mdReport += `**Quality Score:** ${result.qualityScore}/10 | `;
			}
			mdReport += `**Tokens:** ${result?.tokenCount || 'N/A'} | **Time:** ${result?.generationTimeMs || 'N/A'}ms\n\n`;

			mdReport += `**Original Chunk:**\n\`\`\`typescript\n${testChunk.chunkContent.substring(0, 500)}${testChunk.chunkContent.length > 500 ? '...' : ''}\n\`\`\`\n\n`;

			mdReport += `**Generated Context:**\n\n${result?.context || 'ERROR: Generation failed'}\n\n`;
			mdReport += '---\n\n';
		}
	}

	await fs.writeFile(mdReportPath, mdReport, 'utf-8');

	console.log('\n📊 Reports saved to:');
	console.log(`   JSON: ${reportPath}`);
	console.log(`   Markdown: ${mdReportPath}`);
	console.log('\n✅ Evaluation complete!\n');
}

// ============================================================================
// MAIN EXECUTION
// ============================================================================

comparePrompts().catch((error) => {
	console.error('\n❌ Error during evaluation:', error);
	process.exit(1);
});
