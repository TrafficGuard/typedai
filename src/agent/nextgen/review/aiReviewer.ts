/**
 * AI Reviewer
 *
 * Reviews subtask branches using the knowledge base for code style
 * and design patterns. Acts as a first-pass reviewer before human review.
 */

import { logger } from '#o11y/logger';
import type { LLM } from '#shared/agent/agent.model';
import type { Learning } from '../core/types';
import type { KnowledgeBase } from '../learning/knowledgeBase';
import type { GitBranchingService } from '../subtask/gitBranching';

// ============================================================================
// Review Types
// ============================================================================

/**
 * Severity level for review issues
 */
export type IssueSeverity = 'error' | 'warning' | 'suggestion';

/**
 * A single issue found during review
 */
export interface ReviewIssue {
	/** Severity of the issue */
	severity: IssueSeverity;
	/** File path where issue was found */
	file: string;
	/** Line number (if applicable) */
	line?: number;
	/** Issue message */
	message: string;
	/** Reference to knowledge base learning that flagged this */
	learningRef?: string;
	/** Suggested fix */
	suggestion?: string;
}

/**
 * Result of an AI review
 */
export interface ReviewResult {
	/** Overall review decision */
	decision: 'approved' | 'changes_requested' | 'escalate_to_human';
	/** Confidence in the decision (0-1) */
	confidence: number;
	/** Issues found */
	issues: ReviewIssue[];
	/** General suggestions for improvement */
	suggestions: string[];
	/** Reasoning for the decision */
	reasoning: string;
	/** Learnings used in review */
	learningsUsed: Learning[];
	/** Summary of changes reviewed */
	changesSummary: string;
	/** Time taken for review (ms) */
	reviewTime: number;
}

/**
 * Input for reviewing a branch
 */
export interface BranchReviewInput {
	/** Branch name to review */
	branch: string;
	/** Base commit/branch to compare against */
	base: string;
	/** Description of the subtask */
	subtaskDescription: string;
	/** Files that were expected to change */
	expectedFiles?: string[];
	/** Scope restrictions */
	forbiddenPaths?: string[];
}

// ============================================================================
// AI Reviewer Configuration
// ============================================================================

/**
 * Configuration for AI Reviewer
 */
export interface AIReviewerConfig {
	/** LLM to use for review */
	llm: LLM;
	/** Knowledge base for code patterns */
	knowledgeBase: KnowledgeBase;
	/** Git service for diff retrieval */
	git: GitBranchingService;
	/** Minimum confidence to auto-approve */
	autoApproveThreshold: number;
	/** Maximum issues before escalating */
	maxIssuesBeforeEscalate: number;
	/** Whether to allow auto-approval */
	allowAutoApproval: boolean;
}

const DEFAULT_CONFIG: Partial<AIReviewerConfig> = {
	autoApproveThreshold: 0.85,
	maxIssuesBeforeEscalate: 5,
	allowAutoApproval: true,
};

// ============================================================================
// AI Reviewer Implementation
// ============================================================================

/**
 * AI-powered code reviewer using knowledge base
 */
export class AIReviewer {
	private config: AIReviewerConfig;

	constructor(config: AIReviewerConfig) {
		this.config = { ...DEFAULT_CONFIG, ...config };
	}

	/**
	 * Reviews a branch against base
	 */
	async reviewBranch(input: BranchReviewInput): Promise<ReviewResult> {
		const startTime = Date.now();
		logger.info({ branch: input.branch, base: input.base }, 'Starting AI review');

		try {
			// Step 1: Get the diff
			const diff = await this.config.git.getDiff(input.base);
			const diffStats = await this.config.git.getDiffStats(input.base);
			const diffSummary = await this.config.git.getDiffSummary(input.base);

			// Step 2: Extract changed files
			const changedFiles = this.extractChangedFiles(diff);

			// Step 3: Get relevant learnings from knowledge base
			const learnings = await this.getRelevantLearnings(changedFiles, input.subtaskDescription);

			// Step 4: Check scope violations
			const scopeIssues = this.checkScopeViolations(changedFiles, input.expectedFiles, input.forbiddenPaths);

			// Step 5: Build review prompt and get LLM analysis
			const llmReview = await this.getLLMReview(diff, diffSummary, learnings, input);

			// Step 6: Combine results
			const allIssues = [...scopeIssues, ...llmReview.issues];
			const decision = this.determineDecision(allIssues, llmReview.confidence);

			const result: ReviewResult = {
				decision,
				confidence: llmReview.confidence,
				issues: allIssues,
				suggestions: llmReview.suggestions,
				reasoning: llmReview.reasoning,
				learningsUsed: learnings,
				changesSummary: `${diffStats.filesChanged} files changed, +${diffStats.linesAdded}/-${diffStats.linesRemoved} lines`,
				reviewTime: Date.now() - startTime,
			};

			logger.info(
				{
					decision: result.decision,
					confidence: result.confidence,
					issueCount: result.issues.length,
					reviewTime: result.reviewTime,
				},
				'AI review complete',
			);

			return result;
		} catch (e) {
			logger.error(e, 'AI review failed');
			// On failure, escalate to human
			return {
				decision: 'escalate_to_human',
				confidence: 0,
				issues: [],
				suggestions: [],
				reasoning: `Review failed: ${e instanceof Error ? e.message : String(e)}`,
				learningsUsed: [],
				changesSummary: 'Unable to analyze',
				reviewTime: Date.now() - startTime,
			};
		}
	}

	/**
	 * Quick review to check for obvious issues only
	 */
	async quickCheck(input: BranchReviewInput): Promise<{ hasBlockingIssues: boolean; issues: ReviewIssue[] }> {
		const diff = await this.config.git.getDiff(input.base);
		const changedFiles = this.extractChangedFiles(diff);

		// Just check scope violations for quick check
		const scopeIssues = this.checkScopeViolations(changedFiles, input.expectedFiles, input.forbiddenPaths);
		const blockingIssues = scopeIssues.filter((i) => i.severity === 'error');

		return {
			hasBlockingIssues: blockingIssues.length > 0,
			issues: scopeIssues,
		};
	}

	// ========================================================================
	// Private Methods
	// ========================================================================

	/**
	 * Extracts file paths from diff
	 */
	private extractChangedFiles(diff: string): string[] {
		const files: string[] = [];
		const lines = diff.split('\n');

		for (const line of lines) {
			if (line.startsWith('diff --git')) {
				const match = line.match(/diff --git a\/(.+) b\//);
				if (match) {
					files.push(match[1]);
				}
			}
		}

		return [...new Set(files)];
	}

	/**
	 * Gets relevant learnings for the changed files
	 */
	private async getRelevantLearnings(changedFiles: string[], taskDescription: string): Promise<Learning[]> {
		const allLearnings: Learning[] = [];

		// Get learnings by file patterns
		for (const file of changedFiles) {
			const category = this.inferCategoryFromFile(file);
			if (category) {
				const learnings = await this.config.knowledgeBase.retrieve({
					categories: [category],
					types: ['pattern', 'pitfall', 'preference'],
					minConfidence: 0.6,
					limit: 5,
				});
				allLearnings.push(...learnings);
			}
		}

		// Get learnings by task description
		const taskLearnings = await this.config.knowledgeBase.retrieveRelevant(taskDescription);
		allLearnings.push(...taskLearnings);

		// Deduplicate
		const seen = new Set<string>();
		return allLearnings.filter((l) => {
			if (seen.has(l.id)) return false;
			seen.add(l.id);
			return true;
		});
	}

	/**
	 * Infers category from file path
	 */
	private inferCategoryFromFile(file: string): string | null {
		const ext = file.split('.').pop()?.toLowerCase();
		const pathLower = file.toLowerCase();

		// Map extensions and paths to categories
		if (ext === 'ts' || ext === 'tsx') return 'typescript';
		if (ext === 'js' || ext === 'jsx') return 'javascript';
		if (ext === 'py') return 'python';
		if (pathLower.includes('test') || pathLower.includes('spec')) return 'testing';
		if (pathLower.includes('api') || pathLower.includes('route')) return 'api';
		if (pathLower.includes('component')) return 'react';
		if (pathLower.includes('hook')) return 'react/hooks';
		if (pathLower.includes('model') || pathLower.includes('schema')) return 'database';

		return null;
	}

	/**
	 * Checks for scope violations
	 */
	private checkScopeViolations(changedFiles: string[], expectedFiles?: string[], forbiddenPaths?: string[]): ReviewIssue[] {
		const issues: ReviewIssue[] = [];

		// Check forbidden paths
		if (forbiddenPaths && forbiddenPaths.length > 0) {
			for (const file of changedFiles) {
				for (const forbidden of forbiddenPaths) {
					if (file.startsWith(forbidden) || file.includes(`/${forbidden}`)) {
						issues.push({
							severity: 'error',
							file,
							message: `File is in forbidden path: ${forbidden}`,
							suggestion: 'This file should not be modified in this subtask',
						});
					}
				}
			}
		}

		// Check unexpected files
		if (expectedFiles && expectedFiles.length > 0) {
			for (const file of changedFiles) {
				const isExpected = expectedFiles.some((expected) => file === expected || file.startsWith(expected) || new RegExp(expected).test(file));
				if (!isExpected) {
					issues.push({
						severity: 'warning',
						file,
						message: 'File was not in expected scope',
						suggestion: 'Verify this file modification is necessary for the subtask',
					});
				}
			}
		}

		return issues;
	}

	/**
	 * Gets LLM analysis of the diff
	 */
	private async getLLMReview(
		diff: string,
		diffSummary: string,
		learnings: Learning[],
		input: BranchReviewInput,
	): Promise<{
		issues: ReviewIssue[];
		suggestions: string[];
		confidence: number;
		reasoning: string;
	}> {
		const prompt = this.buildReviewPrompt(diff, diffSummary, learnings, input);

		try {
			const response = await this.config.llm.generateText([{ role: 'user', content: prompt }], {
				id: 'ai-review',
				temperature: 0.3,
			});

			return this.parseReviewResponse(response, learnings);
		} catch (e) {
			logger.error(e, 'Failed to get LLM review');
			return {
				issues: [],
				suggestions: [],
				confidence: 0.5,
				reasoning: 'LLM review failed',
			};
		}
	}

	/**
	 * Builds the review prompt
	 */
	private buildReviewPrompt(diff: string, diffSummary: string, learnings: Learning[], input: BranchReviewInput): string {
		const learningsStr =
			learnings.length > 0
				? learnings
						.map(
							(l) => `### [${l.type.toUpperCase()}] ${l.category}
${l.content}
(Confidence: ${(l.confidence * 100).toFixed(0)}%)`,
						)
						.join('\n\n')
				: 'No specific code style learnings available.';

		// Truncate diff if too long
		const maxDiffLength = 15000;
		const truncatedDiff = diff.length > maxDiffLength ? `${diff.slice(0, maxDiffLength)}\n... (truncated)` : diff;

		return `
# Code Review Request

## Subtask Description
${input.subtaskDescription}

## Changes Summary
${diffSummary}

## Code Style & Patterns (from Knowledge Base)
${learningsStr}

## Diff to Review
\`\`\`diff
${truncatedDiff}
\`\`\`

---

# Review Instructions

Please review this diff against the code style patterns and best practices above. Evaluate:

1. **Code Style Compliance**: Does the code follow the patterns in the knowledge base?
2. **Best Practices**: Are there any anti-patterns or pitfalls?
3. **Completeness**: Does the change fully address the subtask?
4. **Quality**: Is the code clean, readable, and maintainable?

## Response Format

Respond in JSON format:
\`\`\`json
{
  "issues": [
    {
      "severity": "error|warning|suggestion",
      "file": "path/to/file.ts",
      "line": 42,
      "message": "Issue description",
      "learningRef": "learning-id if applicable",
      "suggestion": "How to fix"
    }
  ],
  "suggestions": [
    "General improvement suggestion 1",
    "General improvement suggestion 2"
  ],
  "confidence": 0.85,
  "reasoning": "Overall assessment and reasoning for the review decision"
}
\`\`\`

If the code looks good with only minor suggestions, use high confidence (0.8+).
If there are significant issues, use lower confidence and list them clearly.
`;
	}

	/**
	 * Parses the LLM review response
	 */
	private parseReviewResponse(
		response: string,
		learnings: Learning[],
	): {
		issues: ReviewIssue[];
		suggestions: string[];
		confidence: number;
		reasoning: string;
	} {
		try {
			const jsonMatch = response.match(/```json\n?([\s\S]*?)\n?```/);
			if (!jsonMatch) {
				throw new Error('No JSON found in response');
			}

			const parsed = JSON.parse(jsonMatch[1]);

			// Validate and transform issues
			const issues: ReviewIssue[] = (parsed.issues || []).map((issue: any) => ({
				severity: this.validateSeverity(issue.severity),
				file: issue.file || 'unknown',
				line: issue.line,
				message: issue.message || 'Unknown issue',
				learningRef: issue.learningRef,
				suggestion: issue.suggestion,
			}));

			return {
				issues,
				suggestions: parsed.suggestions || [],
				confidence: Math.min(1, Math.max(0, parsed.confidence || 0.5)),
				reasoning: parsed.reasoning || 'No reasoning provided',
			};
		} catch (e) {
			logger.warn(e, 'Failed to parse LLM review response');
			return {
				issues: [],
				suggestions: [],
				confidence: 0.5,
				reasoning: 'Failed to parse review response',
			};
		}
	}

	/**
	 * Validates severity level
	 */
	private validateSeverity(severity: string): IssueSeverity {
		if (severity === 'error' || severity === 'warning' || severity === 'suggestion') {
			return severity;
		}
		return 'warning';
	}

	/**
	 * Determines the final review decision
	 */
	private determineDecision(issues: ReviewIssue[], confidence: number): 'approved' | 'changes_requested' | 'escalate_to_human' {
		const errorCount = issues.filter((i) => i.severity === 'error').length;
		const warningCount = issues.filter((i) => i.severity === 'warning').length;

		// Always escalate if there are errors
		if (errorCount > 0) {
			return 'changes_requested';
		}

		// Escalate if too many issues
		if (issues.length > this.config.maxIssuesBeforeEscalate) {
			return 'escalate_to_human';
		}

		// Auto-approve if allowed and confidence is high enough
		if (this.config.allowAutoApproval && confidence >= this.config.autoApproveThreshold && warningCount === 0) {
			return 'approved';
		}

		// Escalate for low confidence
		if (confidence < 0.6) {
			return 'escalate_to_human';
		}

		// Default: request changes if warnings, otherwise escalate
		if (warningCount > 0) {
			return 'changes_requested';
		}

		return 'escalate_to_human';
	}
}

// ============================================================================
// Factory Function
// ============================================================================

/**
 * Creates an AI reviewer
 */
export function createAIReviewer(config: AIReviewerConfig): AIReviewer {
	return new AIReviewer(config);
}

// ============================================================================
// Re-export Types
// ============================================================================

export type { Learning } from '../core/types';
