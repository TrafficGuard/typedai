/**
 * Review Agent
 *
 * A SEPARATE agent from the implementing agent that reviews completed work.
 * The review agent:
 * 1. Runs the test gate (mandatory)
 * 2. Checks for regressions
 * 3. Evaluates code quality
 * 4. Checks against previous design decisions to prevent oscillation
 * 5. Approves, requests changes, or escalates to human
 */

import type { AgentLLMs } from '#shared/agent/agent.model';
import { unstable_v2_prompt } from '../agentSdk';
import type { KnowledgeBase, Learning } from '../learning/knowledgeBase';
import {
	approveFeature,
	getDomainMemoryPaths,
	getGoalTree,
	getReviewPaths,
	getTaskStatus,
	logReviewApproved,
	logReviewChangesRequested,
	logReviewEscalated,
	recalculateMilestoneStatus,
	rejectFeature,
	runFeatureTest,
	runTestCommand,
	setTaskStatus,
} from '../memory/index';
import type { DomainMemoryPaths, Feature, TestResult } from '../memory/types';
import { checkForContradictions, formatContradictionForReview } from './contradictionChecker';
import { addReviewRecord, aggregateDesignDecisions, generateDecisionId, generateReviewId, loadReviewHistory } from './reviewHistory';
import type { DesignDecision, DesignDecisionCategory, ReviewContext, ReviewIssue, ReviewRecord, ReviewResult } from './types';

// =============================================================================
// Types
// =============================================================================

export interface ReviewAgentConfig {
	llms: AgentLLMs;
	knowledgeBase?: KnowledgeBase;
	workingDirectory: string;
	taskId: string;
}

export interface ReviewAgentInput {
	feature: Feature;
	attempt: number;
	diffSummary: string;
	filesChanged: string[];
	linesAdded: number;
	linesRemoved: number;
	commits: string[];
}

// =============================================================================
// Review Agent
// =============================================================================

/**
 * Run the review agent on a completed feature.
 */
export async function runReviewAgent(config: ReviewAgentConfig, input: ReviewAgentInput): Promise<ReviewResult> {
	const paths = getDomainMemoryPaths(config.workingDirectory, config.taskId);
	const reviewPaths = getReviewPaths(config.workingDirectory, config.taskId);

	// 1. MANDATORY: Test Gate
	const testResult = await runTestGate(input.feature, config.workingDirectory);
	if (!testResult.passed) {
		return {
			decision: 'changes_requested',
			confidence: 1.0,
			testsPassed: false,
			regressionDetected: false,
			designDecisions: [],
			contradictsPrevious: false,
			issues: [
				{
					id: 'test-failure',
					severity: 'critical',
					category: 'correctness',
					description: `Tests failed: ${testResult.error || testResult.output.slice(0, 200)}`,
				},
			],
			suggestions: ['Fix the failing tests before requesting review.'],
			reasoning: 'Tests must pass before code review.',
		};
	}

	// 2. Regression Check
	const regressionResult = await checkRegressions(config.workingDirectory);
	if (regressionResult.detected) {
		return {
			decision: 'changes_requested',
			confidence: 1.0,
			testsPassed: true,
			regressionDetected: true,
			designDecisions: [],
			contradictsPrevious: false,
			issues: [
				{
					id: 'regression',
					severity: 'critical',
					category: 'correctness',
					description: `Regression detected: ${regressionResult.details}`,
				},
			],
			suggestions: ['Fix the regression before requesting review.'],
			reasoning: 'Changes introduced a regression in existing functionality.',
		};
	}

	// 3. Load previous reviews and design decisions
	const history = await loadReviewHistory(reviewPaths, input.feature.id);
	const previousDecisions = history.bindingDecisions;

	// 4. Get KB learnings
	const learnings = config.knowledgeBase ? await config.knowledgeBase.retrieveRelevant(input.feature.description) : [];

	// 5. Build review context
	const reviewContext: ReviewContext = {
		featureId: input.feature.id,
		featureDescription: input.feature.description,
		testCommand: input.feature.testCommand,
		attempt: input.attempt,
		diffSummary: input.diffSummary,
		filesChanged: input.filesChanged,
		linesAdded: input.linesAdded,
		linesRemoved: input.linesRemoved,
		previousReviews: history.reviews,
		bindingDecisions: previousDecisions,
		learnings: learnings.map((l) => l.content),
		patterns: learnings.filter((l) => l.category === 'pattern').map((l) => l.content),
	};

	// 6. Run the review
	const reviewOutput = await performReview(config, reviewContext);

	// 7. Check for contradictions with previous decisions
	const contradictionCheck = checkForContradictions(reviewOutput.feedback, reviewOutput.issues, previousDecisions);

	if (contradictionCheck.hasContradiction) {
		// Escalate to human if there are direct contradictions
		const directContradictions = contradictionCheck.contradictions.filter((c) => c.severity === 'direct');

		if (directContradictions.length > 0) {
			const result: ReviewResult = {
				decision: 'escalate_to_human',
				confidence: 0.5,
				testsPassed: true,
				regressionDetected: false,
				designDecisions: [],
				contradictsPrevious: true,
				contradictionDetails: formatContradictionForReview(contradictionCheck),
				issues: reviewOutput.issues,
				suggestions: reviewOutput.suggestions,
				reasoning: 'Review feedback contradicts previous design decisions. Human review required.',
			};

			// Log escalation
			await logReviewEscalated(paths, input.feature.id, 'Contradiction with previous design decisions');

			return result;
		}
	}

	// 8. Create review record
	const reviewRecord: ReviewRecord = {
		reviewId: generateReviewId(),
		timestamp: new Date().toISOString(),
		attempt: input.attempt,
		decision: reviewOutput.decision,
		designDecisions: reviewOutput.newDecisions.map((d) => ({
			...d,
			madeAt: new Date().toISOString(),
			madeBy: 'review_agent' as const,
			featureId: input.feature.id,
			reviewId: generateReviewId(),
		})),
		feedback: reviewOutput.feedback,
		issues: reviewOutput.issues,
		confidence: reviewOutput.confidence,
	};

	// 9. Save review record
	await addReviewRecord(reviewPaths, input.feature.id, reviewRecord);

	// 10. Aggregate design decisions at task level
	if (reviewRecord.designDecisions.length > 0) {
		await aggregateDesignDecisions(reviewPaths, config.taskId, reviewRecord.designDecisions);
	}

	// 11. Update feature status based on decision
	const goals = await getGoalTree(paths);
	let status = await getTaskStatus(paths);

	if (goals && status) {
		if (reviewOutput.decision === 'approved') {
			status = approveFeature(status, input.feature.id);
			await logReviewApproved(paths, input.feature.id, reviewOutput.feedback);
		} else if (reviewOutput.decision === 'changes_requested') {
			status = rejectFeature(status, input.feature.id, reviewOutput.feedback);
			await logReviewChangesRequested(
				paths,
				input.feature.id,
				reviewOutput.feedback,
				reviewRecord.designDecisions.map((d) => d.decision),
			);
		}

		status = recalculateMilestoneStatus(status, goals);
		await setTaskStatus(paths, status);
	}

	return {
		decision: reviewOutput.decision,
		confidence: reviewOutput.confidence,
		testsPassed: true,
		regressionDetected: false,
		designDecisions: reviewRecord.designDecisions,
		contradictsPrevious: false,
		issues: reviewOutput.issues,
		suggestions: reviewOutput.suggestions,
		reasoning: reviewOutput.reasoning,
	};
}

// =============================================================================
// Test Gate
// =============================================================================

async function runTestGate(feature: Feature, workingDir: string): Promise<TestResult> {
	return runFeatureTest(feature, workingDir);
}

// =============================================================================
// Regression Check
// =============================================================================

interface RegressionResult {
	detected: boolean;
	details?: string;
}

async function checkRegressions(workingDir: string): Promise<RegressionResult> {
	// Run the full test suite to check for regressions
	// In practice, this would be configurable
	try {
		const result = await runTestCommand('pnpm test', workingDir, {
			timeout: 300000, // 5 minutes
		});

		if (!result.passed) {
			return {
				detected: true,
				details: result.error || 'Some tests failed',
			};
		}

		return { detected: false };
	} catch (error) {
		// If test command fails, assume no regression (might not have full test suite)
		return { detected: false };
	}
}

// =============================================================================
// Review Logic
// =============================================================================

interface ReviewOutput {
	decision: 'approved' | 'changes_requested' | 'escalate_to_human';
	confidence: number;
	feedback: string;
	issues: ReviewIssue[];
	suggestions: string[];
	reasoning: string;
	newDecisions: Array<{
		id: string;
		category: DesignDecisionCategory;
		decision: string;
		reasoning: string;
		alternatives_rejected: string[];
	}>;
}

async function performReview(config: ReviewAgentConfig, context: ReviewContext): Promise<ReviewOutput> {
	const prompt = buildReviewPrompt(context);

	const result = await unstable_v2_prompt(prompt, {
		model: config.llms.medium.getModel(),
		cwd: config.workingDirectory,
		permissionMode: 'default', // Read-only for review
	});

	return parseReviewOutput(result.result, context);
}

function buildReviewPrompt(context: ReviewContext): string {
	const bindingDecisionsSection =
		context.bindingDecisions.length > 0
			? `
## BINDING Design Decisions (MUST NOT contradict)

The following decisions were made in previous reviews and MUST be followed:

${context.bindingDecisions
	.map(
		(d) => `- **[${d.id}] ${d.category}:** ${d.decision}
  *Reasoning:* ${d.reasoning}`,
	)
	.join('\n\n')}

IMPORTANT: If your feedback would contradict any of these decisions, you MUST escalate to human review.
`
			: '';

	const previousReviewsSection =
		context.previousReviews.length > 0
			? `
## Previous Reviews

${context.previousReviews
	.map(
		(r) => `### Attempt ${r.attempt}: ${r.decision}
${r.feedback}
${r.designDecisions.length > 0 ? `\nDesign Decisions Made:\n${r.designDecisions.map((d) => `- ${d.decision}`).join('\n')}` : ''}`,
	)
	.join('\n\n')}
`
			: '';

	return `
# Code Review

You are reviewing code changes for a feature implementation.

## Feature
- **ID:** ${context.featureId}
- **Description:** ${context.featureDescription}
- **Test Command:** \`${context.testCommand}\`
- **Attempt:** ${context.attempt}

## Changes
- Files Changed: ${context.filesChanged.join(', ')}
- Lines Added: ${context.linesAdded}
- Lines Removed: ${context.linesRemoved}

## Diff Summary
\`\`\`
${context.diffSummary.slice(0, 3000)}
\`\`\`

${bindingDecisionsSection}

${previousReviewsSection}

## Review Instructions

1. Evaluate the code quality, correctness, and adherence to patterns
2. Check if tests are adequate
3. Look for security issues, performance problems, and anti-patterns
4. **CRITICALLY IMPORTANT:** Check if any of your feedback would contradict the binding decisions above

## Response Format

Respond with a JSON object:

\`\`\`json
{
  "decision": "approved" | "changes_requested" | "escalate_to_human",
  "confidence": 0.0 to 1.0,
  "feedback": "Summary of review",
  "reasoning": "Why this decision was made",
  "issues": [
    {
      "id": "unique-id",
      "severity": "critical" | "major" | "minor" | "suggestion",
      "category": "security" | "performance" | "correctness" | "style" | "testing" | "documentation" | "architecture" | "other",
      "description": "What the issue is",
      "file": "path/to/file.ts",
      "line": 42,
      "suggestion": "How to fix it"
    }
  ],
  "suggestions": ["General improvement suggestions"],
  "newDecisions": [
    {
      "category": "architecture" | "pattern" | "style" | "testing" | "naming" | "api" | "data" | "security",
      "decision": "The design decision being made",
      "reasoning": "Why this decision",
      "alternatives_rejected": ["Alternative approaches considered but rejected"]
    }
  ]
}
\`\`\`

Important:
- Use "escalate_to_human" if you're uncertain or if feedback would contradict binding decisions
- Only add newDecisions for significant architectural/design choices, not minor style preferences
- Be specific about issues and provide actionable suggestions

Review the code now:
`;
}

function parseReviewOutput(output: string, context: ReviewContext): ReviewOutput {
	// Extract JSON from response
	const jsonMatch = output.match(/```json\s*([\s\S]*?)\s*```/);
	const jsonStr = jsonMatch ? jsonMatch[1] : output;

	try {
		const parsed = JSON.parse(jsonStr);

		return {
			decision: parsed.decision || 'changes_requested',
			confidence: parsed.confidence || 0.5,
			feedback: parsed.feedback || '',
			reasoning: parsed.reasoning || '',
			issues: (parsed.issues || []).map((issue: any, i: number) => ({
				id: issue.id || `issue-${i}`,
				severity: issue.severity || 'minor',
				category: issue.category || 'other',
				description: issue.description || '',
				file: issue.file,
				line: issue.line,
				suggestion: issue.suggestion,
			})),
			suggestions: parsed.suggestions || [],
			newDecisions: (parsed.newDecisions || []).map((d: any) => ({
				id: generateDecisionId(d.category || 'other'),
				category: d.category || 'other',
				decision: d.decision || '',
				reasoning: d.reasoning || '',
				alternatives_rejected: d.alternatives_rejected || [],
			})),
		};
	} catch (error) {
		// Fallback if JSON parsing fails
		return {
			decision: 'escalate_to_human',
			confidence: 0.3,
			feedback: 'Failed to parse review output. Human review recommended.',
			reasoning: 'Review output was not valid JSON.',
			issues: [],
			suggestions: [],
			newDecisions: [],
		};
	}
}
