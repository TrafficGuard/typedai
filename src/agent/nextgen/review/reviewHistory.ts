/**
 * Review History
 *
 * Manages the review history for features.
 * Stores review records and design decisions for oscillation prevention.
 */

import { type ReviewPaths, ensureDir, getReviewPaths, loadJson, saveJson } from '../memory/index';
import type { DesignDecision, DesignDecisionCategory, FeatureReviewHistory, ReviewRecord, TaskDesignDecisions } from './types';

// =============================================================================
// Review History Operations
// =============================================================================

/**
 * Load review history for a feature.
 */
export async function loadReviewHistory(paths: ReviewPaths, featureId: string): Promise<FeatureReviewHistory> {
	const filePath = paths.featureReviewPath(featureId);
	const existing = await loadJson<FeatureReviewHistory>(filePath);

	if (existing) {
		return existing;
	}

	// Return empty history if none exists
	return {
		featureId,
		reviews: [],
		bindingDecisions: [],
	};
}

/**
 * Save review history for a feature.
 */
export async function saveReviewHistory(paths: ReviewPaths, history: FeatureReviewHistory): Promise<void> {
	await ensureDir(paths.baseDir);
	const filePath = paths.featureReviewPath(history.featureId);
	await saveJson(filePath, history);
}

/**
 * Add a review record to a feature's history.
 */
export async function addReviewRecord(paths: ReviewPaths, featureId: string, record: ReviewRecord): Promise<FeatureReviewHistory> {
	const history = await loadReviewHistory(paths, featureId);

	// Add the review record
	history.reviews.push(record);

	// Add any new design decisions to binding decisions
	for (const decision of record.designDecisions) {
		if (!history.bindingDecisions.some((d) => d.id === decision.id)) {
			history.bindingDecisions.push(decision);
		}
	}

	await saveReviewHistory(paths, history);
	return history;
}

/**
 * Get the latest review for a feature.
 */
export async function getLatestReview(paths: ReviewPaths, featureId: string): Promise<ReviewRecord | null> {
	const history = await loadReviewHistory(paths, featureId);
	if (history.reviews.length === 0) {
		return null;
	}
	return history.reviews[history.reviews.length - 1];
}

/**
 * Get all binding decisions for a feature.
 */
export async function getBindingDecisions(paths: ReviewPaths, featureId: string): Promise<DesignDecision[]> {
	const history = await loadReviewHistory(paths, featureId);
	return history.bindingDecisions;
}

// =============================================================================
// Task-Level Design Decisions
// =============================================================================

/**
 * Load aggregated design decisions for a task.
 */
export async function loadTaskDesignDecisions(paths: ReviewPaths, taskId: string): Promise<TaskDesignDecisions> {
	const existing = await loadJson<TaskDesignDecisions>(paths.designDecisionsPath);

	if (existing) {
		return existing;
	}

	// Return empty if none exists
	return createEmptyTaskDesignDecisions(taskId);
}

/**
 * Save aggregated design decisions for a task.
 */
export async function saveTaskDesignDecisions(paths: ReviewPaths, decisions: TaskDesignDecisions): Promise<void> {
	await ensureDir(paths.baseDir);
	await saveJson(paths.designDecisionsPath, decisions);
}

/**
 * Add design decisions from a review to the task-level aggregation.
 */
export async function aggregateDesignDecisions(paths: ReviewPaths, taskId: string, newDecisions: DesignDecision[]): Promise<TaskDesignDecisions> {
	const taskDecisions = await loadTaskDesignDecisions(paths, taskId);

	for (const decision of newDecisions) {
		// Add to main list if not already present
		if (!taskDecisions.decisions.some((d) => d.id === decision.id)) {
			taskDecisions.decisions.push(decision);

			// Index by category
			if (!taskDecisions.byCategory[decision.category]) {
				taskDecisions.byCategory[decision.category] = [];
			}
			taskDecisions.byCategory[decision.category].push(decision);

			// Index by feature
			if (!taskDecisions.byFeature[decision.featureId]) {
				taskDecisions.byFeature[decision.featureId] = [];
			}
			taskDecisions.byFeature[decision.featureId].push(decision);
		}
	}

	await saveTaskDesignDecisions(paths, taskDecisions);
	return taskDecisions;
}

/**
 * Get all design decisions for a specific category.
 */
export async function getDecisionsByCategory(paths: ReviewPaths, taskId: string, category: DesignDecisionCategory): Promise<DesignDecision[]> {
	const taskDecisions = await loadTaskDesignDecisions(paths, taskId);
	return taskDecisions.byCategory[category] || [];
}

/**
 * Get all design decisions for a specific feature.
 */
export async function getDecisionsByFeature(paths: ReviewPaths, taskId: string, featureId: string): Promise<DesignDecision[]> {
	const taskDecisions = await loadTaskDesignDecisions(paths, taskId);
	return taskDecisions.byFeature[featureId] || [];
}

// =============================================================================
// Helpers
// =============================================================================

function createEmptyTaskDesignDecisions(taskId: string): TaskDesignDecisions {
	return {
		taskId,
		decisions: [],
		byCategory: {
			architecture: [],
			pattern: [],
			style: [],
			testing: [],
			naming: [],
			api: [],
			data: [],
			security: [],
		},
		byFeature: {},
	};
}

/**
 * Generate a unique review ID.
 */
export function generateReviewId(): string {
	const timestamp = Date.now().toString(36);
	const random = Math.random().toString(36).substring(2, 6);
	return `rev-${timestamp}-${random}`;
}

/**
 * Generate a unique design decision ID.
 */
export function generateDecisionId(category: DesignDecisionCategory): string {
	const timestamp = Date.now().toString(36);
	const random = Math.random().toString(36).substring(2, 4);
	return `dd-${category.slice(0, 3)}-${timestamp}-${random}`;
}

/**
 * Format review history for display in context.
 */
export function formatReviewHistoryForContext(history: FeatureReviewHistory): string {
	const lines: string[] = [];

	if (history.reviews.length === 0) {
		return 'No previous reviews.';
	}

	lines.push(`## Review History (${history.reviews.length} reviews)`);
	lines.push('');

	for (const review of history.reviews) {
		lines.push(`### Attempt ${review.attempt}: ${review.decision}`);
		lines.push(`*Confidence: ${Math.round(review.confidence * 100)}%*`);
		lines.push('');
		lines.push(review.feedback);

		if (review.designDecisions.length > 0) {
			lines.push('');
			lines.push('**Design Decisions Made:**');
			for (const decision of review.designDecisions) {
				lines.push(`- [${decision.id}] ${decision.category}: ${decision.decision}`);
			}
		}

		if (review.issues.length > 0) {
			lines.push('');
			lines.push('**Issues Found:**');
			for (const issue of review.issues) {
				lines.push(`- [${issue.severity}] ${issue.description}`);
			}
		}

		lines.push('');
	}

	if (history.bindingDecisions.length > 0) {
		lines.push('## Binding Decisions (MUST be followed)');
		lines.push('');
		for (const decision of history.bindingDecisions) {
			lines.push(`- **[${decision.id}] ${decision.category}:** ${decision.decision}`);
			lines.push(`  *Reason:* ${decision.reasoning}`);
		}
	}

	return lines.join('\n');
}
