/**
 * LLM-as-Judge Tests for InitializerAgent
 *
 * Tests the quality of goal generation using an LLM judge.
 * These tests use a real LLM to evaluate the outputs.
 *
 * Run with: pnpm test:unit -- --grep "InitializerAgent LLM Judge"
 */

import { expect } from 'chai';
import type { GoalTree } from '../../memory/types';
import { INITIALIZER_CRITERIA, type JudgeContext, type JudgeResult, MINIMUM_PASSING_SCORE, evaluateWithJudge, formatJudgeResult } from './judgeFramework';

// =============================================================================
// Test Data
// =============================================================================

/**
 * Example good goal tree for testing.
 */
const GOOD_GOAL_TREE: GoalTree = {
	task: 'Add user authentication',
	description: 'Implement JWT-based authentication with login, logout, and session management',
	createdAt: '2024-01-15T10:00:00Z',
	milestones: [
		{
			id: 'ms-1',
			name: 'Authentication Foundation',
			description: 'Set up authentication infrastructure and basic login flow',
			requiresHumanReview: false,
			dependsOn: [],
			completionCriteria: ['All auth tests pass', 'Login flow works end-to-end'],
			subtasks: [
				{
					id: 'ms-1-st-1',
					name: 'JWT Setup',
					description: 'Configure JWT token generation and validation',
					features: [
						{
							id: 'ms-1-st-1-ft-1',
							description: 'Create JWT utility module with sign and verify functions',
							testCommand: 'pnpm test:unit -- --grep "JWT utility"',
							dependsOn: [],
							estimatedComplexity: 'low',
						},
						{
							id: 'ms-1-st-1-ft-2',
							description: 'Add token refresh endpoint with rotation',
							testCommand: 'pnpm test:unit -- --grep "token refresh"',
							dependsOn: ['ms-1-st-1-ft-1'],
							estimatedComplexity: 'medium',
						},
					],
				},
				{
					id: 'ms-1-st-2',
					name: 'Login Implementation',
					description: 'Implement login endpoint with password validation',
					features: [
						{
							id: 'ms-1-st-2-ft-1',
							description: 'Create POST /auth/login endpoint with email/password',
							testCommand: 'pnpm test:integration -- --grep "login endpoint"',
							dependsOn: ['ms-1-st-1-ft-1'],
							estimatedComplexity: 'medium',
						},
					],
				},
			],
		},
		{
			id: 'ms-2',
			name: 'Session Management',
			description: 'Implement session tracking and logout functionality',
			requiresHumanReview: true,
			dependsOn: ['ms-1'],
			completionCriteria: ['Session persistence works', 'Logout invalidates session'],
			subtasks: [
				{
					id: 'ms-2-st-1',
					name: 'Session Store',
					description: 'Create session storage with Redis backend',
					features: [
						{
							id: 'ms-2-st-1-ft-1',
							description: 'Implement session store with Redis',
							testCommand: 'pnpm test:integration -- --grep "session store"',
							dependsOn: [],
							estimatedComplexity: 'medium',
						},
						{
							id: 'ms-2-st-1-ft-2',
							description: 'Add logout endpoint that invalidates session',
							testCommand: 'pnpm test:integration -- --grep "logout"',
							dependsOn: ['ms-2-st-1-ft-1', 'ms-1-st-2-ft-1'],
							estimatedComplexity: 'low',
						},
					],
				},
			],
		},
	],
};

/**
 * Example poor goal tree for testing (should score lower).
 */
const POOR_GOAL_TREE: GoalTree = {
	task: 'Auth',
	description: 'Add auth',
	createdAt: '2024-01-15T10:00:00Z',
	milestones: [
		{
			id: 'm1',
			name: 'Do auth stuff',
			description: 'Make auth work',
			requiresHumanReview: false,
			dependsOn: [],
			completionCriteria: [],
			subtasks: [
				{
					id: 's1',
					name: 'Auth',
					description: 'Auth',
					features: [
						{
							id: 'f1',
							description: 'Add login',
							testCommand: 'npm test', // Vague test command
							dependsOn: [],
							estimatedComplexity: 'low', // All low complexity
						},
						{
							id: 'f2',
							description: 'Add logout',
							testCommand: 'npm test',
							dependsOn: [], // Missing obvious dependency on login
							estimatedComplexity: 'low',
						},
						{
							id: 'f3',
							description: 'Add session management',
							testCommand: 'npm test',
							dependsOn: [],
							estimatedComplexity: 'low',
						},
						{
							id: 'f4',
							description: 'Add password reset',
							testCommand: 'npm test',
							dependsOn: [],
							estimatedComplexity: 'low',
						},
						{
							id: 'f5',
							description: 'Add 2FA',
							testCommand: 'npm test',
							dependsOn: [],
							estimatedComplexity: 'low',
						},
					],
				},
			],
		},
	],
};

// =============================================================================
// Test Helpers
// =============================================================================

function formatGoalsForJudge(goals: GoalTree): string {
	return JSON.stringify(goals, null, 2);
}

function createInitializerContext(taskDescription: string, goals: GoalTree, additionalContext?: string): JudgeContext {
	return {
		input: `Task: ${taskDescription}`,
		output: formatGoalsForJudge(goals),
		additionalContext,
	};
}

// =============================================================================
// Tests
// =============================================================================

describe('InitializerAgent LLM Judge', function () {
	// These tests use real LLMs so they need longer timeout
	this.timeout(60000);

	// Skip these tests in CI unless explicitly enabled
	const runLLMTests = process.env.RUN_LLM_JUDGE_TESTS === 'true';

	(runLLMTests ? describe : describe.skip)('Goal Generation Quality', () => {
		it('evaluates good goal tree positively', async () => {
			const context = createInitializerContext('Add user authentication with JWT tokens, including login, logout, and session management', GOOD_GOAL_TREE);

			const result = await evaluateWithJudge(INITIALIZER_CRITERIA, context);

			console.log('\n--- Good Goal Tree Evaluation ---');
			console.log(formatJudgeResult(result));

			expect(result.score).to.be.at.least(MINIMUM_PASSING_SCORE);
			expect(result.strengths).to.have.length.at.least(1);
		});

		it('evaluates poor goal tree negatively', async () => {
			const context = createInitializerContext('Add user authentication with JWT tokens, including login, logout, and session management', POOR_GOAL_TREE);

			const result = await evaluateWithJudge(INITIALIZER_CRITERIA, context);

			console.log('\n--- Poor Goal Tree Evaluation ---');
			console.log(formatJudgeResult(result));

			// Should score lower than the good goal tree
			expect(result.score).to.be.below(MINIMUM_PASSING_SCORE);
			expect(result.issues).to.have.length.at.least(1);
		});

		it('identifies specific criterion weaknesses', async () => {
			const context = createInitializerContext('Add user authentication', POOR_GOAL_TREE);

			const result = await evaluateWithJudge(INITIALIZER_CRITERIA, context);

			// Should have individual criterion scores
			expect(result.criterionScores).to.exist;

			// Feature testability should score low for vague test commands
			if (result.criterionScores?.['Feature Testability']) {
				expect(result.criterionScores['Feature Testability']).to.be.below(7);
			}

			// Dependency correctness should score low for missing dependencies
			if (result.criterionScores?.['Dependency Correctness']) {
				expect(result.criterionScores['Dependency Correctness']).to.be.below(7);
			}
		});
	});

	// Unit tests that don't require LLM
	describe('Judge Framework Integration', () => {
		it('creates proper context from goal tree', () => {
			const context = createInitializerContext('Test task', GOOD_GOAL_TREE, 'Some context');

			expect(context.input).to.include('Test task');
			expect(context.output).to.include('Add user authentication');
			expect(context.additionalContext).to.equal('Some context');
		});

		it('formats goals as readable JSON', () => {
			const formatted = formatGoalsForJudge(GOOD_GOAL_TREE);

			expect(formatted).to.include('milestones');
			expect(formatted).to.include('features');
			expect(formatted).to.include('testCommand');
			// Should be pretty-printed
			expect(formatted).to.include('\n');
		});
	});
});

// =============================================================================
// Evaluation Criteria Documentation Tests
// =============================================================================

describe('Initializer Criteria Definitions', () => {
	it('has all required criteria', () => {
		const criterionNames = INITIALIZER_CRITERIA.map((c) => c.name);

		expect(criterionNames).to.include('Feature Testability');
		expect(criterionNames).to.include('Milestone Coherence');
		expect(criterionNames).to.include('Dependency Correctness');
		expect(criterionNames).to.include('Complexity Estimates');
	});

	it('has valid weights (1-5)', () => {
		for (const criterion of INITIALIZER_CRITERIA) {
			expect(criterion.weight).to.be.at.least(1);
			expect(criterion.weight).to.be.at.most(5);
		}
	});

	it('has descriptive content', () => {
		for (const criterion of INITIALIZER_CRITERIA) {
			expect(criterion.name).to.have.length.at.least(5);
			expect(criterion.description).to.have.length.at.least(20);
		}
	});

	it('total weight is reasonable', () => {
		const totalWeight = INITIALIZER_CRITERIA.reduce((sum, c) => sum + c.weight, 0);
		// As specified in plan: Total: 8
		expect(totalWeight).to.equal(8);
	});
});
