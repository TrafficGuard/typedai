import { anthropicClaude4_5_Sonnet } from '#llm/services/anthropic';
import { logger } from '#o11y/logger';
import type { LLM } from '#shared/llm/llm.model';
import { ContextualizedChunk, RawChunk, SearchResult } from '../core/interfaces';

/**
 * Result from LLM-as-a-judge evaluation
 */
export interface JudgeResult {
	score: number; // 1-10
	reasoning: string;
	issues?: string[];
	strengths?: string[];
}

/**
 * Validates the quality of contextual information for a code chunk
 * Uses LLM to evaluate if the context is helpful for search
 */
export async function validateContextQuality(
	originalCode: string,
	fullFile: string,
	generatedContext: string,
	language: string,
	llm?: LLM,
): Promise<JudgeResult> {
	const judgeLL = llm || anthropicClaude4_5_Sonnet();

	const prompt = `You are evaluating the quality of contextual information generated for a code chunk to improve semantic search.

**Full File Content:**
\`\`\`${language}
${fullFile}
\`\`\`

**Code Chunk:**
\`\`\`${language}
${originalCode}
\`\`\`

**Generated Context:**
${generatedContext}

**Evaluation Criteria:**

Rate the context quality on a scale of 1-10 based on:

1. **Relevance** (3 points): Does it explain the chunk's role within the file?
2. **Dependencies** (2 points): Does it mention key interactions with other parts of the file?
3. **Conciseness** (2 points): Is it brief and to the point (ideally under 100 words)?
4. **Accuracy** (2 points): Is the description factually correct?
5. **Search Value** (1 point): Would this context improve semantic search results?

**Output Format:**

Respond with ONLY valid JSON (no markdown, no code blocks):
{
  "score": <number between 1-10>,
  "reasoning": "<2-3 sentence explanation of the score>",
  "issues": ["<issue 1>", "<issue 2>"],
  "strengths": ["<strength 1>", "<strength 2>"]
}`;

	logger.debug('Requesting context quality evaluation from LLM');

	try {
		const response = await judgeLL.generateText(prompt, { temperature: 0 });

		// Clean response (remove markdown code blocks if present)
		const cleaned = response.replace(/```json\s*|\s*```/g, '').trim();

		const result = JSON.parse(cleaned) as JudgeResult;

		logger.info(
			{
				score: result.score,
				reasoning: result.reasoning,
			},
			'Context quality evaluation complete',
		);

		return result;
	} catch (error) {
		logger.error({ error }, 'Failed to parse LLM judge response');
		throw new Error(`LLM judge evaluation failed: ${error}`);
	}
}

/**
 * Validates the quality of code-to-English translation
 * Checks if the natural language description accurately represents the code
 */
export async function validateCodeTranslation(originalCode: string, translation: string, language: string, llm?: LLM): Promise<JudgeResult> {
	const judgeLLM = llm || anthropicClaude4_5_Sonnet();

	const prompt = `You are evaluating the quality of a code-to-English translation for semantic search.

**Original Code:**
\`\`\`${language}
${originalCode}
\`\`\`

**Natural Language Translation:**
${translation}

**Evaluation Criteria:**

Rate the translation quality on a scale of 1-10 based on:

1. **Accuracy** (4 points): Does it correctly describe what the code does?
2. **Completeness** (3 points): Does it cover all major functionality?
3. **Clarity** (2 points): Is it easy to understand for someone searching?
4. **Searchability** (1 point): Would this help match natural language queries to the code?

**Output Format:**

Respond with ONLY valid JSON (no markdown, no code blocks):
{
  "score": <number between 1-10>,
  "reasoning": "<2-3 sentence explanation>",
  "issues": ["<issue 1>", "<issue 2>"],
  "strengths": ["<strength 1>", "<strength 2>"]
}`;

	logger.debug('Requesting code translation evaluation from LLM');

	try {
		const response = await judgeLLM.generateText(prompt, { temperature: 0 });
		const cleaned = response.replace(/```json\s*|\s*```/g, '').trim();
		const result = JSON.parse(cleaned) as JudgeResult;

		logger.info(
			{
				score: result.score,
				reasoning: result.reasoning,
			},
			'Code translation evaluation complete',
		);

		return result;
	} catch (error) {
		logger.error({ error }, 'Failed to parse LLM judge response for translation');
		throw new Error(`Code translation evaluation failed: ${error}`);
	}
}

/**
 * Evaluates search result relevance for a given query
 * Uses LLM to judge if the top results are actually relevant
 */
export async function evaluateSearchRelevance(
	query: string,
	results: SearchResult[],
	topK = 5,
	llm?: LLM,
): Promise<{
	overallScore: number;
	individualScores: number[];
	reasoning: string;
}> {
	const judgeLLM = llm || anthropicClaude4_5_Sonnet();

	const topResults = results.slice(0, topK);

	const resultsText = topResults
		.map(
			(r, i) => `
**Result ${i + 1}:**
- File: ${r.document.filePath}
- Code:
\`\`\`
${r.document.originalCode}
\`\`\`
${r.document.naturalLanguageDescription ? `- Description: ${r.document.naturalLanguageDescription}` : ''}
`,
		)
		.join('\n');

	const prompt = `You are evaluating the relevance of code search results for a user's query.

**Search Query:**
"${query}"

**Search Results:**
${resultsText}

**Evaluation Task:**

For each result, rate its relevance to the query on a scale of 0-10:
- 10 = Perfect match, exactly what the user is looking for
- 7-9 = Highly relevant, addresses the query well
- 4-6 = Somewhat relevant, related but not ideal
- 1-3 = Barely relevant, loosely connected
- 0 = Not relevant at all

Then provide an overall score (0-10) for the quality of the search results as a whole.

**Output Format:**

Respond with ONLY valid JSON (no markdown, no code blocks):
{
  "overallScore": <number 0-10>,
  "individualScores": [<score for result 1>, <score for result 2>, ...],
  "reasoning": "<explanation of why you gave these scores>"
}`;

	logger.debug({ query, resultCount: topResults.length }, 'Requesting search relevance evaluation');

	try {
		const response = await judgeLLM.generateText(prompt, { temperature: 0 });
		const cleaned = response.replace(/```json\s*|\s*```/g, '').trim();
		const result = JSON.parse(cleaned) as {
			overallScore: number;
			individualScores: number[];
			reasoning: string;
		};

		logger.info(
			{
				query,
				overallScore: result.overallScore,
				avgIndividualScore: result.individualScores.reduce((a, b) => a + b, 0) / result.individualScores.length,
			},
			'Search relevance evaluation complete',
		);

		return result;
	} catch (error) {
		logger.error({ error }, 'Failed to parse LLM judge response for search relevance');
		throw new Error(`Search relevance evaluation failed: ${error}`);
	}
}

/**
 * Compares two sets of search results and determines which is better
 * Used for A/B testing different configurations
 */
export async function compareSearchResults(
	query: string,
	baselineResults: SearchResult[],
	enhancedResults: SearchResult[],
	topK = 5,
	llm?: LLM,
): Promise<{
	winner: 'baseline' | 'enhanced' | 'tie';
	baselineScore: number;
	enhancedScore: number;
	reasoning: string;
}> {
	const judgeLLM = llm || anthropicClaude4_5_Sonnet();

	const formatResults = (results: SearchResult[], label: string) => {
		return results
			.slice(0, topK)
			.map(
				(r, i) => `
**${label} Result ${i + 1}:**
- File: ${r.document.filePath}
- Code:
\`\`\`
${r.document.originalCode.substring(0, 500)}${r.document.originalCode.length > 500 ? '...' : ''}
\`\`\`
`,
			)
			.join('\n');
	};

	const prompt = `You are comparing two sets of search results for the same query to determine which is better.

**Search Query:**
"${query}"

**Baseline Results:**
${formatResults(baselineResults, 'Baseline')}

**Enhanced Results:**
${formatResults(enhancedResults, 'Enhanced')}

**Evaluation Task:**

Compare the two result sets and determine which provides better answers to the query.
Consider:
1. Relevance of top results
2. Overall quality of the result set
3. Ranking (are the most relevant results at the top?)

**Output Format:**

Respond with ONLY valid JSON (no markdown, no code blocks):
{
  "winner": "<baseline|enhanced|tie>",
  "baselineScore": <number 0-10>,
  "enhancedScore": <number 0-10>,
  "reasoning": "<2-3 sentence explanation of your decision>"
}`;

	logger.debug({ query }, 'Requesting search comparison evaluation');

	try {
		const response = await judgeLLM.generateText(prompt, { temperature: 0 });
		const cleaned = response.replace(/```json\s*|\s*```/g, '').trim();
		const result = JSON.parse(cleaned) as {
			winner: 'baseline' | 'enhanced' | 'tie';
			baselineScore: number;
			enhancedScore: number;
			reasoning: string;
		};

		logger.info(
			{
				query,
				winner: result.winner,
				baselineScore: result.baselineScore,
				enhancedScore: result.enhancedScore,
			},
			'Search comparison complete',
		);

		return result;
	} catch (error) {
		logger.error({ error }, 'Failed to parse LLM judge response for search comparison');
		throw new Error(`Search comparison evaluation failed: ${error}`);
	}
}

/**
 * Batch evaluates multiple contextual chunks
 * Returns aggregate statistics
 */
export async function batchValidateContextQuality(
	chunks: Array<{
		originalCode: string;
		fullFile: string;
		generatedContext: string;
		language: string;
	}>,
	llm?: LLM,
): Promise<{
	avgScore: number;
	minScore: number;
	maxScore: number;
	belowThreshold: number;
	results: JudgeResult[];
}> {
	logger.info({ chunkCount: chunks.length }, 'Starting batch context validation');

	const results: JudgeResult[] = [];

	for (const chunk of chunks) {
		const result = await validateContextQuality(chunk.originalCode, chunk.fullFile, chunk.generatedContext, chunk.language, llm);
		results.push(result);
	}

	const scores = results.map((r) => r.score);
	const avgScore = scores.reduce((a, b) => a + b, 0) / scores.length;
	const minScore = Math.min(...scores);
	const maxScore = Math.max(...scores);
	const belowThreshold = scores.filter((s) => s < 7).length;

	logger.info(
		{
			avgScore: avgScore.toFixed(2),
			minScore,
			maxScore,
			belowThreshold,
		},
		'Batch context validation complete',
	);

	return {
		avgScore,
		minScore,
		maxScore,
		belowThreshold,
		results,
	};
}
