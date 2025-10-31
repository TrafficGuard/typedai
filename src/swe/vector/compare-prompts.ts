/**
 * A/B Testing script to compare different contextual chunking prompts
 * Usage: node --env-file=variables/test.env -r esbuild-register src/swe/vector/compare-prompts.ts
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { summaryLLM } from '#llm/services/defaultLlms';
import type { LLM } from '#shared/llm/llm.model';

// Import prompt variants
const CURRENT_PROMPT = (chunkContent: string, fullDocumentContent: string, language: string): string => `
<document lang="${language}">
${fullDocumentContent}
</document>

Here is the chunk we want to situate within the whole document. It is also in ${language}.
<chunk>
${chunkContent}
</chunk>

Please give a short succinct context to situate this chunk within the overall document for the purposes of improving search retrieval of the chunk.

Focus on:
1. The relationship of this chunk to the rest of the document
2. Its purpose within the document
3. Any key interactions or dependencies it has with other parts of the document

Answer only with the succinct context and nothing else.
`;

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

const KEYWORD_ENHANCED_PROMPT = (chunkContent: string, fullDocumentContent: string, language: string): string => `
<document lang="${language}">
${fullDocumentContent}
</document>

Here is the chunk we want to situate within the whole document. It is also in ${language}.
<chunk>
${chunkContent}
</chunk>

Please give a short succinct context to situate this chunk within the overall document for the purposes of improving search retrieval of the chunk.

Focus on:
1. The relationship of this chunk to the rest of the document
2. Its purpose within the document
3. Any key interactions or dependencies it has with other parts of the document
4. **Important technical terms, APIs, patterns, and searchable keywords that developers might use to find this code**

Answer only with the succinct context and nothing else.
`;

interface ComparisonResult {
	promptName: string;
	context: string;
	tokenCount: number;
	generationTimeMs: number;
	keywordDensity: number;
	uniqueTerms: string[];
}

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
	console.log('CONTEXTUAL CHUNKING PROMPT COMPARISON');
	console.log(`${'='.repeat(80)}\n`);

	const llm = summaryLLM();
	console.log(`Using LLM: ${llm.getId()}\n`);

	// Sample code to test
	const testFile = 'src/swe/vector/core/contextualizer.ts';
	const fullPath = path.join(process.cwd(), testFile);
	const fileContent = await fs.readFile(fullPath, 'utf-8');

	// Extract a sample chunk (the main contextualize method)
	const chunkStartMarker = 'async contextualize(chunks: RawChunk[]';
	const chunkStart = fileContent.indexOf(chunkStartMarker);
	const chunkEnd = fileContent.indexOf('\n\t}', chunkStart + 500) + 3; // Find method end
	const sampleChunk = fileContent.substring(chunkStart, chunkEnd);

	console.log('Sample Chunk to Contextualize:');
	console.log('─'.repeat(80));
	console.log(`${sampleChunk.substring(0, 200)}...\n`);

	// Test each prompt variant
	const prompts = [
		{
			name: 'Current (Anthropic-style)',
			generator: () => CURRENT_PROMPT(sampleChunk, fileContent, 'typescript'),
		},
		{
			name: 'Keyword-Enhanced (Minimal Change)',
			generator: () => KEYWORD_ENHANCED_PROMPT(sampleChunk, fileContent, 'typescript'),
		},
		{
			name: 'Query-Oriented (Recommended)',
			generator: () => QUERY_ORIENTED_PROMPT(sampleChunk, fileContent, 'typescript', testFile),
		},
	];

	const results: ComparisonResult[] = [];

	for (const prompt of prompts) {
		console.log(`\nGenerating context with: ${prompt.name}...`);
		const result = await generateContext(llm, prompt.generator(), prompt.name);
		results.push(result);
		console.log(`✓ Generated in ${result.generationTimeMs}ms`);
	}

	// Display results
	console.log(`\n\n${'='.repeat(80)}`);
	console.log('COMPARISON RESULTS');
	console.log(`${'='.repeat(80)}\n`);

	for (const result of results) {
		console.log('─'.repeat(80));
		console.log(`📝 ${result.promptName}`);
		console.log('─'.repeat(80));
		console.log(`\n${result.context}\n`);
		console.log('Metrics:');
		console.log(`  - Token count: ${result.tokenCount} tokens`);
		console.log(`  - Generation time: ${result.generationTimeMs}ms`);
		console.log(`  - Keyword density: ${result.keywordDensity.toFixed(1)}% (${result.uniqueTerms.length} unique terms)`);
		console.log(`  - Technical terms: ${result.uniqueTerms.slice(0, 10).join(', ')}${result.uniqueTerms.length > 10 ? '...' : ''}`);
		console.log();
	}

	// Summary comparison
	console.log('='.repeat(80));
	console.log('SUMMARY');
	console.log(`${'='.repeat(80)}\n`);

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
		console.log(`  ${result.promptName.padEnd(40)} ${bar} ${result.generationTimeMs}ms`);
	}

	console.log(`\n${'='.repeat(80)}`);
	console.log('RECOMMENDATIONS');
	console.log(`${'='.repeat(80)}\n`);

	// Find best by keyword density
	const bestKeywords = results.reduce((best, curr) => (curr.keywordDensity > best.keywordDensity ? curr : best));
	console.log(`🏆 Best keyword density: ${bestKeywords.promptName}`);

	// Find shortest generation time
	const fastest = results.reduce((best, curr) => (curr.generationTimeMs < best.generationTimeMs ? curr : best));
	console.log(`⚡ Fastest generation: ${fastest.promptName}`);

	// Find most concise
	const mostConcise = results.reduce((best, curr) => (curr.tokenCount < best.tokenCount ? curr : best));
	console.log(`📏 Most concise: ${mostConcise.promptName}`);

	console.log('\n✅ Comparison complete!\n');
}

comparePrompts().catch((error) => {
	console.error('\n❌ Error during comparison:', error);
	process.exit(1);
});
