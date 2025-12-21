/**
 * LLM-as-Judge Tests for ReviewAgent
 *
 * Tests the quality of code review using an LLM judge.
 * Evaluates contradiction detection, issue severity, actionable feedback, and confidence.
 *
 * Run with: pnpm test:unit -- --grep "ReviewAgent LLM Judge"
 */

import { expect } from 'chai';
import type { ReviewResult } from '../../review/types';
import { type JudgeContext, MINIMUM_PASSING_SCORE, REVIEW_CRITERIA, evaluateWithJudge, formatJudgeResult } from './judgeFramework';

// =============================================================================
// Test Data
// =============================================================================

interface ReviewScenario {
	description: string;
	previousAttempts: Array<{
		approach: string;
		outcome: string;
	}>;
	currentAttempt: {
		diff: string;
		testsPassed: boolean;
	};
}

interface MockReviewResult {
	decision: 'approved' | 'changes_requested' | 'escalate';
	confidence: number;
	testsPassed: boolean;
	regressionDetected: boolean;
	contradictsPrevious: boolean;
	issues: Array<{
		severity: 'critical' | 'major' | 'minor' | 'suggestion';
		category: string;
		description: string;
	}>;
	suggestions: string[];
	reasoning: string;
}

/**
 * Good review output - correctly identifies issues with appropriate severity.
 */
const GOOD_REVIEW_OUTPUT: MockReviewResult = {
	decision: 'changes_requested',
	confidence: 0.85,
	testsPassed: true,
	regressionDetected: false,
	contradictsPrevious: false,
	issues: [
		{
			severity: 'major',
			category: 'security',
			description: 'SQL query uses string interpolation instead of parameterized queries, creating SQL injection vulnerability in getUserById function.',
		},
		{
			severity: 'minor',
			category: 'style',
			description: 'Missing JSDoc comments on exported functions.',
		},
		{
			severity: 'suggestion',
			category: 'performance',
			description: 'Consider adding an index on the email column if frequent lookups are expected.',
		},
	],
	suggestions: [
		'Replace string interpolation with parameterized query: `db.query("SELECT * FROM users WHERE id = ?", [userId])`',
		'Add JSDoc comments to getUserById and createUser functions',
	],
	reasoning:
		'The implementation is functionally correct and tests pass. However, the SQL injection vulnerability is a security risk that should be addressed before merge. The severity is major because it exposes user data but requires authenticated access. The styling issues are minor and can be addressed in a follow-up.',
};

/**
 * Poor review output - misses obvious issues, wrong severity, vague feedback.
 */
const POOR_REVIEW_OUTPUT: MockReviewResult = {
	decision: 'approved',
	confidence: 0.95,
	testsPassed: true,
	regressionDetected: false,
	contradictsPrevious: false,
	issues: [], // Missed the SQL injection!
	suggestions: ['Looks good'],
	reasoning: 'Code works and tests pass.',
};

/**
 * Review with contradiction detection.
 */
const CONTRADICTION_SCENARIO: ReviewScenario = {
	description: 'Implement caching for user lookups',
	previousAttempts: [
		{
			approach: 'Used in-memory cache with Map',
			outcome: 'Rejected: memory leak issues with unbounded cache',
		},
		{
			approach: 'Used Redis cache',
			outcome: 'Approved',
		},
	],
	currentAttempt: {
		diff: `
+const userCache = new Map();
+
+function getUser(id) {
+  if (userCache.has(id)) {
+    return userCache.get(id);
+  }
+  const user = db.getUser(id);
+  userCache.set(id, user);
+  return user;
+}
`,
		testsPassed: true,
	},
};

const GOOD_CONTRADICTION_REVIEW: MockReviewResult = {
	decision: 'changes_requested',
	confidence: 0.9,
	testsPassed: true,
	regressionDetected: false,
	contradictsPrevious: true,
	issues: [
		{
			severity: 'critical',
			category: 'design',
			description:
				'This approach (in-memory Map cache) was previously rejected due to memory leak issues with unbounded cache. The current implementation has the same problem.',
		},
	],
	suggestions: [
		'Use Redis cache as established in the previous approved approach',
		'If in-memory caching is preferred, implement LRU eviction with a maximum size limit',
	],
	reasoning:
		'This implementation contradicts the previously established design decision to use Redis for caching. The in-memory Map approach was rejected because it creates unbounded memory growth. Either use Redis or implement proper cache eviction.',
};

const POOR_CONTRADICTION_REVIEW: MockReviewResult = {
	decision: 'approved',
	confidence: 0.8,
	testsPassed: true,
	regressionDetected: false,
	contradictsPrevious: false, // Missed the contradiction!
	issues: [],
	suggestions: [],
	reasoning: 'Implementation looks correct and tests pass.',
};

// =============================================================================
// Test Helpers
// =============================================================================

function formatReviewOutputForJudge(review: MockReviewResult, scenario?: ReviewScenario): string {
	return `
## Review Decision
Decision: ${review.decision}
Confidence: ${review.confidence}

## Test Results
Tests Passed: ${review.testsPassed}
Regression Detected: ${review.regressionDetected}

## Contradiction Check
Contradicts Previous: ${review.contradictsPrevious}

## Issues Found
${review.issues.length === 0 ? 'No issues found' : review.issues.map((i) => `- [${i.severity}] ${i.category}: ${i.description}`).join('\n')}

## Suggestions
${review.suggestions.join('\n')}

## Reasoning
${review.reasoning}
`;
}

function formatScenarioForJudge(scenario: ReviewScenario): string {
	return `
## Task
${scenario.description}

## Previous Attempts
${scenario.previousAttempts.map((a, i) => `${i + 1}. Approach: ${a.approach}\n   Outcome: ${a.outcome}`).join('\n\n')}

## Current Attempt
Tests Passed: ${scenario.currentAttempt.testsPassed}

Code Changes:
\`\`\`diff
${scenario.currentAttempt.diff}
\`\`\`
`;
}

function createReviewContext(review: MockReviewResult, scenario?: ReviewScenario): JudgeContext {
	return {
		input: scenario ? formatScenarioForJudge(scenario) : 'Review the code changes for quality, security, and correctness.',
		output: formatReviewOutputForJudge(review, scenario),
		additionalContext: scenario ? 'The review should detect if the current attempt contradicts previously rejected approaches.' : undefined,
	};
}

// =============================================================================
// Tests
// =============================================================================

describe('ReviewAgent LLM Judge', function () {
	this.timeout(60000);

	const runLLMTests = process.env.RUN_LLM_JUDGE_TESTS === 'true';

	(runLLMTests ? describe : describe.skip)('Review Quality', () => {
		it('evaluates good review positively', async () => {
			const context = createReviewContext(GOOD_REVIEW_OUTPUT);

			const result = await evaluateWithJudge(REVIEW_CRITERIA, context);

			console.log('\n--- Good Review Output Evaluation ---');
			console.log(formatJudgeResult(result));

			expect(result.score).to.be.at.least(MINIMUM_PASSING_SCORE);
			expect(result.strengths).to.have.length.at.least(1);
		});

		it('evaluates poor review negatively', async () => {
			const context = createReviewContext(POOR_REVIEW_OUTPUT);

			const result = await evaluateWithJudge(REVIEW_CRITERIA, context);

			console.log('\n--- Poor Review Output Evaluation ---');
			console.log(formatJudgeResult(result));

			expect(result.score).to.be.below(MINIMUM_PASSING_SCORE);
			expect(result.issues).to.have.length.at.least(1);
		});

		it('rewards good contradiction detection', async () => {
			const context = createReviewContext(GOOD_CONTRADICTION_REVIEW, CONTRADICTION_SCENARIO);

			const result = await evaluateWithJudge(REVIEW_CRITERIA, context);

			console.log('\n--- Good Contradiction Detection ---');
			console.log(formatJudgeResult(result));

			expect(result.score).to.be.at.least(MINIMUM_PASSING_SCORE);

			// Contradiction detection should score high
			if (result.criterionScores?.['Contradiction Detection']) {
				expect(result.criterionScores['Contradiction Detection']).to.be.at.least(7);
			}
		});

		it('penalizes missed contradiction', async () => {
			const context = createReviewContext(POOR_CONTRADICTION_REVIEW, CONTRADICTION_SCENARIO);

			const result = await evaluateWithJudge(REVIEW_CRITERIA, context);

			console.log('\n--- Missed Contradiction Evaluation ---');
			console.log(formatJudgeResult(result));

			// Should score low for missing the contradiction
			if (result.criterionScores?.['Contradiction Detection']) {
				expect(result.criterionScores['Contradiction Detection']).to.be.below(5);
			}
		});

		it('evaluates actionable feedback quality', async () => {
			const context = createReviewContext(GOOD_REVIEW_OUTPUT);

			const result = await evaluateWithJudge(REVIEW_CRITERIA, context);

			// Good review has specific, actionable suggestions
			if (result.criterionScores?.['Actionable Feedback']) {
				expect(result.criterionScores['Actionable Feedback']).to.be.at.least(7);
			}
		});
	});

	// Unit tests that don't require LLM
	describe('Judge Framework Integration', () => {
		it('creates proper context from review output', () => {
			const context = createReviewContext(GOOD_REVIEW_OUTPUT);

			expect(context.output).to.include('changes_requested');
			expect(context.output).to.include('SQL injection');
			expect(context.output).to.include('0.85');
		});

		it('includes scenario context when provided', () => {
			const context = createReviewContext(GOOD_CONTRADICTION_REVIEW, CONTRADICTION_SCENARIO);

			expect(context.input).to.include('Previous Attempts');
			expect(context.input).to.include('memory leak');
			expect(context.additionalContext).to.include('contradiction');
		});

		it('formats issues by severity', () => {
			const formatted = formatReviewOutputForJudge(GOOD_REVIEW_OUTPUT);

			expect(formatted).to.include('[major]');
			expect(formatted).to.include('[minor]');
			expect(formatted).to.include('[suggestion]');
		});
	});
});

// =============================================================================
// Evaluation Criteria Documentation Tests
// =============================================================================

describe('Review Criteria Definitions', () => {
	it('has all required criteria', () => {
		const criterionNames = REVIEW_CRITERIA.map((c) => c.name);

		expect(criterionNames).to.include('Contradiction Detection');
		expect(criterionNames).to.include('Issue Severity Accuracy');
		expect(criterionNames).to.include('Actionable Feedback');
		expect(criterionNames).to.include('Confidence Calibration');
	});

	it('has valid weights (1-5)', () => {
		for (const criterion of REVIEW_CRITERIA) {
			expect(criterion.weight).to.be.at.least(1);
			expect(criterion.weight).to.be.at.most(5);
		}
	});

	it('contradiction detection has highest weight', () => {
		const contradictionCriterion = REVIEW_CRITERIA.find((c) => c.name === 'Contradiction Detection');
		const maxWeight = Math.max(...REVIEW_CRITERIA.map((c) => c.weight));

		expect(contradictionCriterion?.weight).to.equal(maxWeight);
	});

	it('total weight is reasonable', () => {
		const totalWeight = REVIEW_CRITERIA.reduce((sum, c) => sum + c.weight, 0);
		// As specified in plan: Total: 8
		expect(totalWeight).to.equal(8);
	});
});
