/**
 * LLM Response Fixtures
 *
 * Provides pre-built LLM response templates for use with MockLLM in tests.
 */

// =============================================================================
// Initializer Agent Responses
// =============================================================================

/**
 * Discovery response for codebase exploration.
 */
export function discoveryResponse(
	options: {
		projectType?: string;
		testFramework?: string;
		keyFiles?: string[];
		patterns?: string[];
	} = {},
): string {
	const projectType = options.projectType ?? 'TypeScript';
	const testFramework = options.testFramework ?? 'Mocha + Chai';
	const keyFiles = options.keyFiles ?? ['src/index.ts', 'src/core/'];
	const patterns = options.patterns ?? ['Dependency injection', 'Async/await'];

	return `# Codebase Analysis

## Project Type
${projectType} project using pnpm as package manager.

## Test Framework
${testFramework} for testing.

## Key Files
${keyFiles.map((f) => `- ${f}`).join('\n')}

## Patterns & Conventions
${patterns.map((p) => `- ${p}`).join('\n')}
`;
}

/**
 * Goal generation response for initializer agent.
 */
export function goalGenerationResponse(
	options: {
		task?: string;
		milestoneCount?: number;
		featureCount?: number;
	} = {},
): string {
	const task = options.task ?? 'Implement Feature';
	const milestoneCount = options.milestoneCount ?? 1;
	const featureCount = options.featureCount ?? 2;

	const milestones = Array.from({ length: milestoneCount }, (_, mi) => ({
		id: `ms-${mi + 1}`,
		name: `Milestone ${mi + 1}`,
		description: `Description for milestone ${mi + 1}`,
		requiresHumanReview: false,
		dependsOn: mi > 0 ? [`ms-${mi}`] : [],
		subtasks: [
			{
				id: `ms-${mi + 1}-st-1`,
				name: 'Subtask 1',
				description: 'Subtask description',
				features: Array.from({ length: featureCount }, (_, fi) => ({
					id: `ms-${mi + 1}-st-1-ft-${fi + 1}`,
					description: `Feature ${fi + 1} for milestone ${mi + 1}`,
					testCommand: `pnpm test -- --grep "ms-${mi + 1}-st-1-ft-${fi + 1}"`,
					dependsOn: fi > 0 ? [`ms-${mi + 1}-st-1-ft-${fi}`] : [],
					estimatedComplexity: 'medium',
				})),
			},
		],
	}));

	return `\`\`\`json
{
  "task": "${task}",
  "description": "Implementation plan for ${task}",
  "milestones": ${JSON.stringify(milestones, null, 2)}
}
\`\`\``;
}

// =============================================================================
// Review Agent Responses
// =============================================================================

/**
 * Review approved response.
 */
export function reviewApprovedResponse(
	options: {
		feedback?: string;
		confidence?: number;
		designDecisions?: Array<{ category: string; decision: string; reasoning: string }>;
	} = {},
): string {
	const result = {
		decision: 'approved',
		confidence: options.confidence ?? 0.9,
		feedback: options.feedback ?? 'Code looks good. Well-structured implementation.',
		reasoning: 'Tests pass and code follows established patterns.',
		issues: [],
		suggestions: ['Consider adding more edge case tests.'],
		newDecisions: options.designDecisions ?? [],
	};

	return `\`\`\`json
${JSON.stringify(result, null, 2)}
\`\`\``;
}

/**
 * Review changes requested response.
 */
export function reviewChangesRequestedResponse(
	options: {
		feedback?: string;
		confidence?: number;
		issues?: Array<{
			id: string;
			severity: string;
			category: string;
			description: string;
			suggestion?: string;
		}>;
	} = {},
): string {
	const result = {
		decision: 'changes_requested',
		confidence: options.confidence ?? 0.85,
		feedback: options.feedback ?? 'Some improvements needed.',
		reasoning: 'Found issues that should be addressed.',
		issues: options.issues ?? [
			{
				id: 'issue-1',
				severity: 'major',
				category: 'correctness',
				description: 'Edge case not handled',
				suggestion: 'Add null check',
			},
		],
		suggestions: ['Fix the identified issues before re-review.'],
		newDecisions: [],
	};

	return `\`\`\`json
${JSON.stringify(result, null, 2)}
\`\`\``;
}

/**
 * Review escalate to human response.
 */
export function reviewEscalateResponse(reason = 'Contradicts previous decision'): string {
	const result = {
		decision: 'escalate_to_human',
		confidence: 0.5,
		feedback: `Escalating: ${reason}`,
		reasoning: 'Unable to make decision autonomously.',
		issues: [],
		suggestions: [],
		newDecisions: [],
	};

	return `\`\`\`json
${JSON.stringify(result, null, 2)}
\`\`\``;
}

// =============================================================================
// Parallel Explorer Responses
// =============================================================================

/**
 * Approach comparison response.
 */
export function approachComparisonResponse(
	options: {
		winnerId: string;
		reasoning?: string;
	} = { winnerId: 'approach-a' },
): string {
	const result = {
		winnerId: options.winnerId,
		reasoning: options.reasoning ?? `${options.winnerId} is preferred due to simpler implementation and better performance characteristics.`,
	};

	return `\`\`\`json
${JSON.stringify(result, null, 2)}
\`\`\``;
}

// =============================================================================
// Worker Agent Responses
// =============================================================================

/**
 * Implementation plan response.
 */
export function implementationPlanResponse(steps: string[]): string {
	return `# Implementation Plan

${steps.map((s, i) => `${i + 1}. ${s}`).join('\n')}

Let me start implementing this step by step.`;
}

/**
 * Implementation complete response.
 */
export function implementationCompleteResponse(summary: string): string {
	return `# Implementation Complete

${summary}

All changes have been committed. Ready for testing.`;
}

// =============================================================================
// Error Responses
// =============================================================================

/**
 * JSON parse error (malformed response).
 */
export function malformedJsonResponse(): string {
	return `Here's my analysis:
{
  "decision": "approved",
  "feedback": "looks good
}
Note: Missing closing quote and brace`;
}

/**
 * Non-JSON response.
 */
export function nonJsonResponse(): string {
	return `I think the code looks good.
Here's my summary:
- Tests pass
- Code is clean
- No issues found

I approve this change.`;
}

// =============================================================================
// Context Quality Evaluation (LLM Judge)
// =============================================================================

/**
 * LLM Judge context quality evaluation response.
 */
export function llmJudgeContextResponse(
	options: {
		score?: number;
		reasoning?: string;
		issues?: string[];
		strengths?: string[];
	} = {},
): string {
	const result = {
		score: options.score ?? 8,
		reasoning: options.reasoning ?? 'Good context coverage with clear relevance.',
		issues: options.issues ?? [],
		strengths: options.strengths ?? ['Clear description', 'Accurate dependencies'],
	};

	return JSON.stringify(result, null, 2);
}

/**
 * LLM Judge goal evaluation response.
 */
export function llmJudgeGoalResponse(
	options: {
		score?: number;
		issues?: string[];
		strengths?: string[];
	} = {},
): string {
	const result = {
		score: options.score ?? 8,
		reasoning: 'Goals are well-structured with clear test commands.',
		issues: options.issues ?? [],
		strengths: options.strengths ?? ['All features have test commands', 'Dependencies correctly specified', 'Complexity estimates reasonable'],
	};

	return JSON.stringify(result, null, 2);
}
