/**
 * Context Generation
 *
 * Generates context.md for worker sessions from domain memory.
 * Context is regenerated each session from goals, status, and progress.
 */

import { getMilestoneForFeature, getSubtaskForFeature } from './goals';
import { getFeatureProgress, parseRecentProgress } from './progress';
import { getProgressSummary } from './status';
import { saveMarkdown } from './store';
import type {
	DecisionSummary,
	DesignDecisionSummary,
	DomainMemoryPaths,
	Feature,
	FeatureStatus,
	GoalTree,
	Learning,
	MilestoneGoal,
	ProgressSummary,
	RelevantFile,
	ReviewHistorySummary,
	SessionContext,
	SubtaskGoal,
	TaskStatus,
} from './types';

// =============================================================================
// Context Generation
// =============================================================================

/**
 * Generate session context from domain memory.
 */
export function generateSessionContext(goals: GoalTree, status: TaskStatus, currentFeature: Feature, options: ContextGenerationOptions): SessionContext {
	const milestone = getMilestoneForFeature(goals, currentFeature.id);
	const subtask = getSubtaskForFeature(goals, currentFeature.id);
	const featureStatus = status.features[currentFeature.id];
	const overallProgress = getProgressSummary(goals, status);

	if (!milestone || !subtask) {
		throw new Error(`Feature ${currentFeature.id} not found in goal tree`);
	}

	return {
		taskId: status.taskId,
		taskDescription: goals.description,
		currentFeature,
		currentMilestone: milestone,
		currentSubtask: subtask,
		featureStatus: featureStatus || {
			status: 'pending',
			attempts: 0,
			maxAttempts: 3,
			commits: [],
		},
		overallProgress,
		previousAttempts: options.previousAttempts || [],
		reviewHistory: options.reviewHistory || [],
		relevantFiles: options.relevantFiles || [],
		learnings: options.learnings || [],
		recentDecisions: options.recentDecisions || [],
		bindingDesignDecisions: options.bindingDesignDecisions || [],
	};
}

export interface ContextGenerationOptions {
	previousAttempts?: SessionContext['previousAttempts'];
	reviewHistory?: ReviewHistorySummary[];
	relevantFiles?: RelevantFile[];
	learnings?: Learning[];
	recentDecisions?: DecisionSummary[];
	bindingDesignDecisions?: DesignDecisionSummary[];
}

// =============================================================================
// Context Markdown Generation
// =============================================================================

/**
 * Generate context.md content from session context.
 */
export function generateContextMarkdown(context: SessionContext): string {
	const lines: string[] = [];

	// Header
	lines.push('# Session Context');
	lines.push('');

	// Task summary
	lines.push(`## Task: ${context.taskDescription}`);
	lines.push(
		`**Progress:** ${context.overallProgress.passingFeatures}/${context.overallProgress.totalFeatures} features passing (${context.overallProgress.percentComplete}%)`,
	);
	lines.push(`**Current Milestone:** ${context.currentMilestone.id} (${context.currentMilestone.name})`);
	lines.push('');

	// Status overview
	lines.push('## Status Overview');
	lines.push('');
	lines.push(formatStatusOverview(context));
	lines.push('');

	// Current feature details
	lines.push('## Current Feature');
	lines.push(`**ID:** ${context.currentFeature.id}`);
	lines.push(`**Description:** ${context.currentFeature.description}`);
	lines.push(`**Test Command:** \`${context.currentFeature.testCommand}\``);
	lines.push(`**Attempts:** ${context.featureStatus.attempts} of ${context.featureStatus.maxAttempts}`);
	if (context.featureStatus.lastError) {
		lines.push(`**Last Error:** ${context.featureStatus.lastError}`);
	}
	lines.push('');

	// Previous attempts
	if (context.previousAttempts.length > 0) {
		lines.push('## Previous Attempts');
		lines.push('');
		for (let i = 0; i < context.previousAttempts.length; i++) {
			const attempt = context.previousAttempts[i];
			lines.push(`${i + 1}. ${attempt.summary}`);
		}
		lines.push('');
	}

	// Review history (binding decisions)
	if (context.reviewHistory.length > 0) {
		lines.push('## Review History');
		lines.push('');
		for (const review of context.reviewHistory) {
			lines.push(`### Attempt ${review.attempt}: ${review.decision}`);
			lines.push(review.feedback);
			if (review.designDecisions.length > 0) {
				lines.push('**Design Decisions:**');
				for (const decision of review.designDecisions) {
					lines.push(`- ${decision}`);
				}
			}
			lines.push('');
		}
	}

	// Binding design decisions
	if (context.bindingDesignDecisions.length > 0) {
		lines.push('## Binding Design Decisions');
		lines.push('');
		lines.push('These decisions were made by previous reviewers and MUST be followed:');
		lines.push('');
		for (const decision of context.bindingDesignDecisions) {
			lines.push(`- **[${decision.id}] ${decision.category}:** ${decision.decision}`);
			if (decision.reasoning) {
				lines.push(`  *Reasoning:* ${decision.reasoning}`);
			}
		}
		lines.push('');
	}

	// Relevant files
	if (context.relevantFiles.length > 0) {
		lines.push('## Relevant Files');
		lines.push('');
		for (const file of context.relevantFiles) {
			lines.push(`- \`${file.filePath}\` - ${file.relevance}`);
		}
		lines.push('');
	}

	// Knowledge base learnings
	if (context.learnings.length > 0) {
		lines.push('## Code Style & Patterns');
		lines.push('');
		for (const learning of context.learnings) {
			lines.push(`### ${learning.category}`);
			lines.push(learning.content);
			lines.push('');
		}
	}

	// Recent decisions
	if (context.recentDecisions.length > 0) {
		lines.push('## Recent Decisions');
		lines.push('');
		for (const decision of context.recentDecisions) {
			lines.push(`- **${decision.question}**: ${decision.chosen}`);
			lines.push(`  *Made by:* ${decision.madeBy} - *Reason:* ${decision.reasoning}`);
		}
		lines.push('');
	}

	// Constraints
	lines.push('## Constraints');
	lines.push('');
	lines.push('- Run tests before marking complete');
	lines.push(`- Max ${context.featureStatus.maxAttempts} attempts before escalation`);
	if (context.bindingDesignDecisions.length > 0) {
		lines.push('- MUST maintain compliance with binding design decisions above');
	}
	lines.push('');

	return lines.join('\n');
}

function formatStatusOverview(context: SessionContext): string {
	const lines: string[] = [];

	// This would ideally show all features in the current milestone
	// For now, show the current feature status
	const status = context.featureStatus.status;
	const icon = status === 'passing' ? '✓' : status === 'failing' ? '✗' : status === 'in_progress' ? '→' : status === 'blocked' ? '⊘' : '○';

	lines.push(`${icon} ${context.currentFeature.id}: ${context.currentFeature.description}`);

	return lines.join('\n');
}

/**
 * Save context.md file.
 */
export async function saveContext(paths: DomainMemoryPaths, context: SessionContext): Promise<void> {
	const markdown = generateContextMarkdown(context);
	await saveMarkdown(paths.contextPath, markdown);
}

// =============================================================================
// Context Extraction from Progress
// =============================================================================

/**
 * Extract previous attempts for a feature from progress log.
 */
export function extractPreviousAttempts(progressContent: string, featureId: string): SessionContext['previousAttempts'] {
	const entries = getFeatureProgress(progressContent, featureId);

	return entries.map((entry) => ({
		timestamp: entry.timestamp,
		type: 'feature_attempt' as const,
		featureId,
		summary: entry.body.slice(0, 200),
		details: {},
	}));
}

/**
 * Extract suggested approach from progress log based on previous failures.
 */
export function generateSuggestedApproach(progressContent: string, featureId: string): string | null {
	const entries = getFeatureProgress(progressContent, featureId);
	const failures = entries.filter((e) => e.type === 'Feature Failed' || e.body.includes('✗'));

	if (failures.length === 0) return null;

	const suggestions: string[] = [];
	suggestions.push('Previous attempts failed:');

	for (const failure of failures.slice(-3)) {
		// Last 3 failures
		const errorMatch = failure.body.match(/\*\*Error:\*\*\s*(.+)/);
		if (errorMatch) {
			suggestions.push(`- ${errorMatch[1]}`);
		}
	}

	suggestions.push('');
	suggestions.push('Consider a different approach that avoids these issues.');

	return suggestions.join('\n');
}

// =============================================================================
// Context Summarization
// =============================================================================

/**
 * Create a compact context summary for system prompts.
 */
export function createCompactContext(context: SessionContext): string {
	const lines: string[] = [];

	lines.push(`Task: ${context.taskDescription}`);
	lines.push(`Progress: ${context.overallProgress.percentComplete}%`);
	lines.push(`Current: ${context.currentFeature.description}`);
	lines.push(`Test: ${context.currentFeature.testCommand}`);
	lines.push(`Attempts: ${context.featureStatus.attempts}/${context.featureStatus.maxAttempts}`);

	if (context.featureStatus.lastError) {
		lines.push(`Last Error: ${context.featureStatus.lastError.slice(0, 100)}...`);
	}

	if (context.bindingDesignDecisions.length > 0) {
		lines.push('');
		lines.push('BINDING DECISIONS:');
		for (const d of context.bindingDesignDecisions) {
			lines.push(`- [${d.id}] ${d.decision}`);
		}
	}

	return lines.join('\n');
}

/**
 * Create an initial prompt for a worker session.
 */
export function createWorkerInitialPrompt(context: SessionContext): string {
	const lines: string[] = [];

	lines.push(`# Task: ${context.taskDescription}`);
	lines.push('');
	lines.push('## Your Goal');
	lines.push('Implement the following feature and ensure tests pass:');
	lines.push('');
	lines.push(`**Feature:** ${context.currentFeature.description}`);
	lines.push(`**Test Command:** \`${context.currentFeature.testCommand}\``);
	lines.push('');

	if (context.featureStatus.attempts > 0) {
		lines.push(`## Previous Attempts: ${context.featureStatus.attempts}`);
		if (context.featureStatus.lastError) {
			lines.push(`Last error: ${context.featureStatus.lastError}`);
		}
		lines.push('');
	}

	if (context.bindingDesignDecisions.length > 0) {
		lines.push('## Required Design Decisions (MUST follow)');
		for (const d of context.bindingDesignDecisions) {
			lines.push(`- **${d.category}:** ${d.decision}`);
		}
		lines.push('');
	}

	if (context.relevantFiles.length > 0) {
		lines.push('## Relevant Files');
		for (const f of context.relevantFiles.slice(0, 10)) {
			lines.push(`- ${f.filePath}`);
		}
		lines.push('');
	}

	lines.push('## Instructions');
	lines.push('1. Implement the feature');
	lines.push('2. Run the test command to verify');
	lines.push('3. Fix any issues until tests pass');
	lines.push('');

	return lines.join('\n');
}
