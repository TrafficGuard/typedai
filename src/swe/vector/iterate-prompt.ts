/**
 * Quick iteration script for testing contextual chunking prompts
 * Tests a single file to rapidly iterate on prompt design
 *
 * Usage: node --env-file=variables/test.env -r esbuild-register src/swe/vector/iterate-prompt.ts
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { cerebrasGptOss_120b } from '#llm/services/cerebras';
import type { LLM } from '#shared/llm/llm.model';
import { ASTChunker } from './chunking/astChunker';
import { VectorStoreConfig } from './core/config';

// ============================================================================
// TEST CONFIGURATION
// ============================================================================

const TEST_FILE = 'src/swe/vector/core/contextualizer.ts';
const CHUNK_INDEX = 0; // Which chunk to test (0 = first chunk)
const MAX_CONTEXT_WORDS = 70; // Expected maximum

// ============================================================================
// PROMPT VARIANTS TO TEST
// ============================================================================

const CHAIN_OF_THOUGHT_V1 = (chunkContent: string, fullDocumentContent: string, language: string, filePath: string): string => `
<document path="${filePath}">
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

const CHAIN_OF_THOUGHT_V2 = (chunkContent: string, fullDocumentContent: string, language: string, filePath: string): string => `
<document path="${filePath}">
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
// MAIN TEST FUNCTION
// ============================================================================

type PromptGenerator = (chunkContent: string, fullDocumentContent: string, language: string, filePath: string) => string;

async function testPrompt(promptName: string, promptGenerator: PromptGenerator) {
	console.log(`\n${'='.repeat(80)}`);
	console.log(`Testing: ${promptName}`);
	console.log(`${'='.repeat(80)}\n`);

	// Load and chunk the test file
	const fullPath = path.join(process.cwd(), TEST_FILE);
	const fileContent = await fs.readFile(fullPath, 'utf-8');
	const language = path.extname(TEST_FILE).substring(1);

	const chunker = new ASTChunker();
	const vectorConfig: VectorStoreConfig = {
		chunking: {
			contextualChunking: false,
			size: 1500,
			overlap: 200,
			dualEmbedding: false,
		},
	};

	const rawChunks = await chunker.chunk(
		{
			filePath: TEST_FILE,
			relativePath: TEST_FILE,
			content: fileContent,
			language,
			size: fileContent.length,
			lastModified: new Date(),
		},
		vectorConfig,
	);

	console.log(`File: ${TEST_FILE}`);
	console.log(`Total chunks: ${rawChunks.length}`);
	console.log(`Testing chunk ${CHUNK_INDEX} (lines ${rawChunks[CHUNK_INDEX].sourceLocation.startLine}-${rawChunks[CHUNK_INDEX].sourceLocation.endLine})\n`);

	// Get the chunk to test
	const chunk = rawChunks[CHUNK_INDEX];
	const chunkContent = chunk.content;

	// Generate prompt and get response
	const prompt = promptGenerator(chunkContent, fileContent, language, TEST_FILE);

	console.log('Chunk content preview (first 200 chars):');
	console.log(`${chunkContent.substring(0, 200)}...\n`);

	const llm: LLM = cerebrasGptOss_120b();
	console.log(`Calling LLM: ${llm.getId()}...\n`);

	const startTime = Date.now();
	const response = await llm.generateText(prompt, { id: `Iterate: ${promptName}` });
	const duration = Date.now() - startTime;

	// Analyze response
	const wordCount = response.split(/\s+/).length;
	const charCount = response.length;
	const lineCount = response.split('\n').length;

	console.log(`${'─'.repeat(80)}`);
	console.log(`RESPONSE (${duration}ms):`);
	console.log(`${'─'.repeat(80)}`);
	console.log(response);
	console.log(`\n${'─'.repeat(80)}`);
	console.log('ANALYSIS:');
	console.log(`${'─'.repeat(80)}`);
	console.log(`Words: ${wordCount}`);
	console.log(`Characters: ${charCount}`);
	console.log(`Lines: ${lineCount}`);

	// Check if response looks like full file dump
	const looksLikeFullFile = charCount > 2000 || lineCount > 50;
	console.log(`\nLooks like full file dump: ${looksLikeFullFile ? '❌ YES' : '✅ NO'}`);

	if (wordCount > MAX_CONTEXT_WORDS) {
		console.log(`⚠️  Exceeds ${MAX_CONTEXT_WORDS} word limit`);
	} else {
		console.log(`✅ Within ${MAX_CONTEXT_WORDS} word limit`);
	}

	// Extract just the Context line if formatted correctly
	const contextMatch = response.match(/Context:\s*([\s\S]+?)(?:\n\n|\n$|$)/);
	if (contextMatch) {
		const contextOnly = contextMatch[1].trim();
		const contextWords = contextOnly.split(/\s+/).length;
		console.log(`\nExtracted Context (${contextWords} words):`);
		console.log(`"${contextOnly}"`);
	}

	return {
		promptName,
		wordCount,
		charCount,
		lineCount,
		looksLikeFullFile,
		duration,
	};
}

async function main() {
	console.log(`\n${'='.repeat(80)}`);
	console.log('PROMPT ITERATION TEST');
	console.log(`${'='.repeat(80)}\n`);

	const prompts = [
		{ name: 'Chain-of-Thought V1 (baseline)', generator: CHAIN_OF_THOUGHT_V1 },
		{ name: 'Chain-of-Thought V2 (explicit format)', generator: CHAIN_OF_THOUGHT_V2 },
	];

	const results: Array<{
		promptName: string;
		wordCount: number;
		charCount: number;
		lineCount: number;
		looksLikeFullFile: boolean;
		duration: number;
	}> = [];

	for (const prompt of prompts) {
		const result = await testPrompt(prompt.name, prompt.generator);
		results.push(result);
	}

	// Summary
	console.log(`\n\n${'='.repeat(80)}`);
	console.log('SUMMARY');
	console.log(`${'='.repeat(80)}\n`);

	for (const result of results) {
		const status = result.looksLikeFullFile ? '❌' : '✅';
		console.log(`${status} ${result.promptName}`);
		console.log(`   Words: ${result.wordCount}, Chars: ${result.charCount}, Time: ${result.duration}ms`);
	}
}

main().catch((error) => {
	console.error('\n❌ Error:', error);
	process.exit(1);
});
