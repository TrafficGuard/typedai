/**
 * LLM-as-Judge Framework
 *
 * Evaluates agent outputs using an LLM judge with structured criteria.
 * Used for testing the quality of agent responses, not just correctness.
 *
 * Key features:
 * - Weighted scoring criteria
 * - Structured evaluation prompts
 * - JSON response parsing
 * - Minimum passing score threshold
 */

import { getLLM } from '#llm/llmFactory';
import type { LLM } from '#shared/llm/llm.model';

// =============================================================================
// Types
// =============================================================================

/**
 * Result from an LLM judge evaluation.
 */
export interface JudgeResult {
	/** Overall score from 1-10 */
	score: number;
	/** Detailed reasoning for the score */
	reasoning: string;
	/** Specific issues identified */
	issues?: string[];
	/** Specific strengths identified */
	strengths?: string[];
	/** Individual criterion scores */
	criterionScores?: Record<string, number>;
}

/**
 * A single evaluation criterion.
 */
export interface JudgeCriterion {
	/** Name of the criterion */
	name: string;
	/** Weight of this criterion (1-5, higher = more important) */
	weight: number;
	/** Description of what this criterion evaluates */
	description: string;
	/** Examples of good vs bad for this criterion */
	examples?: {
		good: string;
		bad: string;
	};
}

/**
 * Context provided to the judge for evaluation.
 */
export interface JudgeContext {
	/** Task or input that was given to the agent */
	input: string;
	/** Output produced by the agent */
	output: string;
	/** Additional context (e.g., codebase info, previous attempts) */
	additionalContext?: string;
}

// =============================================================================
// Constants
// =============================================================================

/** Minimum score required to pass an evaluation */
export const MINIMUM_PASSING_SCORE = 7;

/** Default LLM to use for judging */
const DEFAULT_JUDGE_LLM = 'anthropic:claude-sonnet-4-20250514';

// =============================================================================
// Predefined Criteria Sets
// =============================================================================

/**
 * Criteria for evaluating InitializerAgent outputs (goal generation).
 */
export const INITIALIZER_CRITERIA: JudgeCriterion[] = [
	{
		name: 'Feature Testability',
		weight: 3,
		description:
			'Each feature should have clear, verifiable acceptance criteria. Features should be small enough to test individually and have explicit test commands or conditions.',
		examples: {
			good: 'Feature with "Test: run `pnpm test auth` and verify login succeeds"',
			bad: 'Feature with vague "should work correctly" criteria',
		},
	},
	{
		name: 'Milestone Coherence',
		weight: 2,
		description:
			'Milestones should group related features logically. Each milestone should represent a meaningful stage of completion. Features within a milestone should be related.',
		examples: {
			good: 'Milestone "Authentication" with login, logout, session features',
			bad: 'Random features grouped together without logical connection',
		},
	},
	{
		name: 'Dependency Correctness',
		weight: 2,
		description:
			'Dependencies between features and milestones should be accurate. A feature should only depend on features that must be completed first. No circular dependencies.',
		examples: {
			good: '"Update user profile" depends on "Create user authentication"',
			bad: 'No dependencies specified when features clearly depend on each other',
		},
	},
	{
		name: 'Complexity Estimates',
		weight: 1,
		description: 'Complexity ratings (low/medium/high) should be reasonable given the feature scope. Complex features should be broken down appropriately.',
		examples: {
			good: 'Database migration rated as "medium", simple config change as "low"',
			bad: 'All features rated "low" regardless of actual complexity',
		},
	},
];

/**
 * Criteria for evaluating WorkerAgent outputs (implementation).
 */
export const WORKER_CRITERIA: JudgeCriterion[] = [
	{
		name: 'Test Passes',
		weight: 4,
		description:
			'The implementation should pass all relevant tests. If tests were run, they should succeed. If no tests exist, the implementation should be testable.',
	},
	{
		name: 'Code Quality',
		weight: 2,
		description: 'Code should follow project conventions, be readable, and avoid obvious anti-patterns. No security vulnerabilities or performance issues.',
	},
	{
		name: 'Follows Design Decisions',
		weight: 2,
		description: 'Implementation should respect established design decisions and patterns in the codebase. Should not introduce conflicting approaches.',
	},
	{
		name: 'Commit Clarity',
		weight: 1,
		description: 'Commit messages should clearly describe what was changed and why. Changes should be atomic and focused.',
	},
];

/**
 * Criteria for evaluating ReviewAgent outputs (code review).
 */
export const REVIEW_CRITERIA: JudgeCriterion[] = [
	{
		name: 'Contradiction Detection',
		weight: 3,
		description: 'Review should accurately identify contradictions between attempts (if any). Should not flag false contradictions or miss obvious ones.',
	},
	{
		name: 'Issue Severity Accuracy',
		weight: 2,
		description: 'Issues should be categorized by correct severity. Blocking issues should truly block progress, minor issues should not be escalated.',
	},
	{
		name: 'Actionable Feedback',
		weight: 2,
		description: 'Feedback should be specific and actionable. The developer should know exactly what to change based on the review.',
	},
	{
		name: 'Confidence Calibration',
		weight: 1,
		description: 'Confidence scores should be well-calibrated. High confidence should only be given when the review is thorough and certain.',
	},
];

/**
 * Criteria for evaluating ParallelExplorer outputs (approach comparison).
 */
export const PARALLEL_CRITERIA: JudgeCriterion[] = [
	{
		name: 'Winner Selection Accuracy',
		weight: 3,
		description: 'The selected approach should genuinely be the best option based on test results, code quality, and alignment with requirements.',
	},
	{
		name: 'Comparison Fairness',
		weight: 2,
		description: 'Each approach should be evaluated fairly without bias. Similar criteria should be applied to all approaches.',
	},
	{
		name: 'Reasoning Quality',
		weight: 2,
		description: 'The reasoning for selection should be clear, logical, and reference specific evidence from each approach.',
	},
];

// =============================================================================
// Evaluation Functions
// =============================================================================

/**
 * Build the evaluation prompt for the judge.
 */
function buildEvaluationPrompt(criteria: JudgeCriterion[], context: JudgeContext): string {
	const criteriaSection = criteria
		.map(
			(c, i) => `${i + 1}. **${c.name}** (weight: ${c.weight}/5)
   ${c.description}
   ${c.examples ? `\n   - Good example: ${c.examples.good}\n   - Bad example: ${c.examples.bad}` : ''}`,
		)
		.join('\n\n');

	return `You are an expert evaluator assessing the quality of an AI agent's output.

## Evaluation Criteria

${criteriaSection}

## Input (what the agent was asked to do)

${context.input}

## Output (what the agent produced)

${context.output}

${context.additionalContext ? `## Additional Context\n\n${context.additionalContext}` : ''}

## Your Task

Evaluate the output against each criterion and provide:
1. A score from 1-10 for each criterion
2. An overall weighted score from 1-10
3. Specific issues found (if any)
4. Specific strengths noted (if any)
5. Detailed reasoning for your evaluation

Respond with a JSON object in this exact format:
\`\`\`json
{
  "criterionScores": {
    "${criteria.map((c) => c.name).join('": <score>,\n    "')}"
  },
  "score": <overall_weighted_score>,
  "issues": ["<issue1>", "<issue2>"],
  "strengths": ["<strength1>", "<strength2>"],
  "reasoning": "<detailed_reasoning>"
}
\`\`\`

Be rigorous but fair. A score of 7 or above indicates acceptable quality.`;
}

/**
 * Parse the judge's response into a JudgeResult.
 */
function parseJudgeResponse(response: string): JudgeResult {
	// Extract JSON from markdown code block if present
	const jsonMatch = response.match(/```json\s*([\s\S]*?)\s*```/);
	const jsonStr = jsonMatch ? jsonMatch[1] : response;

	try {
		const parsed = JSON.parse(jsonStr.trim());
		return {
			score: parsed.score ?? 0,
			reasoning: parsed.reasoning ?? '',
			issues: parsed.issues ?? [],
			strengths: parsed.strengths ?? [],
			criterionScores: parsed.criterionScores ?? {},
		};
	} catch (error) {
		// If parsing fails, try to extract score from text
		const scoreMatch = response.match(/score[:\s]+(\d+(?:\.\d+)?)/i);
		return {
			score: scoreMatch ? Number.parseFloat(scoreMatch[1]) : 0,
			reasoning: response,
			issues: ['Failed to parse structured response'],
			strengths: [],
		};
	}
}

/**
 * Calculate weighted score from criterion scores.
 */
function calculateWeightedScore(criteria: JudgeCriterion[], criterionScores: Record<string, number>): number {
	let totalWeight = 0;
	let weightedSum = 0;

	for (const criterion of criteria) {
		const score = criterionScores[criterion.name] ?? 0;
		weightedSum += score * criterion.weight;
		totalWeight += criterion.weight;
	}

	return totalWeight > 0 ? weightedSum / totalWeight : 0;
}

/**
 * Evaluate an agent's output using an LLM judge.
 *
 * @param criteria - The criteria to evaluate against
 * @param context - The context (input, output, additional info)
 * @param llm - Optional LLM to use (defaults to Claude Sonnet)
 * @returns JudgeResult with scores and feedback
 */
export async function evaluateWithJudge(criteria: JudgeCriterion[], context: JudgeContext, llm?: LLM): Promise<JudgeResult> {
	const judgeLLM = llm ?? (await getLLM(DEFAULT_JUDGE_LLM));
	const prompt = buildEvaluationPrompt(criteria, context);

	const response = await judgeLLM.generateText(prompt, { temperature: 0.3 });
	const result = parseJudgeResponse(response);

	// Recalculate weighted score if criterion scores are available
	if (result.criterionScores && Object.keys(result.criterionScores).length > 0) {
		const calculatedScore = calculateWeightedScore(criteria, result.criterionScores);
		// Use calculated score if significantly different from reported score
		if (Math.abs(calculatedScore - result.score) > 1) {
			result.score = calculatedScore;
		}
	}

	return result;
}

/**
 * Check if a judge result passes the minimum threshold.
 */
export function passingScore(result: JudgeResult): boolean {
	return result.score >= MINIMUM_PASSING_SCORE;
}

/**
 * Format a JudgeResult for display.
 */
export function formatJudgeResult(result: JudgeResult): string {
	const lines: string[] = [];

	lines.push(`## Evaluation Result: ${result.score.toFixed(1)}/10 ${passingScore(result) ? '✓ PASS' : '✗ FAIL'}`);
	lines.push('');

	if (result.criterionScores && Object.keys(result.criterionScores).length > 0) {
		lines.push('### Criterion Scores');
		for (const [name, score] of Object.entries(result.criterionScores)) {
			lines.push(`- ${name}: ${score}/10`);
		}
		lines.push('');
	}

	if (result.strengths && result.strengths.length > 0) {
		lines.push('### Strengths');
		for (const strength of result.strengths) {
			lines.push(`- ${strength}`);
		}
		lines.push('');
	}

	if (result.issues && result.issues.length > 0) {
		lines.push('### Issues');
		for (const issue of result.issues) {
			lines.push(`- ${issue}`);
		}
		lines.push('');
	}

	lines.push('### Reasoning');
	lines.push(result.reasoning);

	return lines.join('\n');
}

// =============================================================================
// Test Helpers
// =============================================================================

/**
 * Create a mock judge result for testing.
 */
export function createMockJudgeResult(overrides: Partial<JudgeResult> = {}): JudgeResult {
	return {
		score: 8,
		reasoning: 'Good overall quality with minor improvements possible.',
		issues: [],
		strengths: ['Well structured', 'Clear implementation'],
		criterionScores: {},
		...overrides,
	};
}

/**
 * Assert that a judge result meets expectations.
 */
export function assertJudgeResultMeetsExpectations(
	result: JudgeResult,
	expectations: {
		minScore?: number;
		maxIssues?: number;
		requiredStrengths?: string[];
	},
): void {
	const { minScore = MINIMUM_PASSING_SCORE, maxIssues = Number.POSITIVE_INFINITY, requiredStrengths = [] } = expectations;

	if (result.score < minScore) {
		throw new Error(`Judge score ${result.score} is below minimum ${minScore}. Reasoning: ${result.reasoning}`);
	}

	if (result.issues && result.issues.length > maxIssues) {
		throw new Error(`Judge found ${result.issues.length} issues, exceeding maximum ${maxIssues}. Issues: ${result.issues.join(', ')}`);
	}

	for (const requiredStrength of requiredStrengths) {
		const hasStrength = result.strengths?.some((s) => s.toLowerCase().includes(requiredStrength.toLowerCase()));
		if (!hasStrength) {
			throw new Error(`Required strength "${requiredStrength}" not found. Strengths: ${result.strengths?.join(', ')}`);
		}
	}
}
