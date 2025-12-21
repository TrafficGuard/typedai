/**
 * TodoWrite Projection
 *
 * Projects domain memory state to Claude's TodoWrite format for real-time display.
 *
 * Claude has been trained to use TodoWrite effectively, so we leverage this
 * for within-session display while using domain memory for cross-session state.
 */

import { getFeaturesInMilestone } from './goals';
import type { Feature, GoalTree, MilestoneGoal, TaskStatus, TodoItem } from './types';

/**
 * Project goals and status to TodoWrite format.
 *
 * This creates a hierarchical todo list showing:
 * 1. Milestone progress (e.g., "NextAuth Setup (2/3)")
 * 2. Current feature being worked on
 */
export function projectToTodoWrite(goals: GoalTree, status: TaskStatus, currentFeature?: Feature): TodoItem[] {
	const todos: TodoItem[] = [];

	// Add milestone entries
	for (const milestone of goals.milestones) {
		const ms = status.milestones[milestone.id];
		if (!ms) continue;

		const todoStatus = milestoneStatusToTodoStatus(ms.status);
		todos.push({
			content: `${milestone.name} (${ms.passing}/${ms.total})`,
			status: todoStatus,
			activeForm: `Working on ${milestone.name}`,
		});
	}

	// Add current feature if provided
	if (currentFeature) {
		const fs = status.features[currentFeature.id];
		const featureStatus = fs ? featureStatusToTodoStatus(fs.status) : 'in_progress';

		todos.push({
			content: currentFeature.description,
			status: featureStatus,
			activeForm: `Implementing: ${currentFeature.description}`,
		});
	}

	return todos;
}

/**
 * Project a single milestone to TodoWrite format with all its features.
 */
export function projectMilestoneToTodoWrite(milestone: MilestoneGoal, status: TaskStatus): TodoItem[] {
	const todos: TodoItem[] = [];

	// Add milestone header
	const ms = status.milestones[milestone.id];
	const milestoneStatus = ms ? milestoneStatusToTodoStatus(ms.status) : 'pending';

	todos.push({
		content: milestone.name,
		status: milestoneStatus,
		activeForm: `Working on ${milestone.name}`,
	});

	// Add all features in the milestone
	const features = getFeaturesInMilestone(milestone);
	for (const feature of features) {
		const fs = status.features[feature.id];
		const featureStatus = fs ? featureStatusToTodoStatus(fs.status) : 'pending';

		todos.push({
			content: feature.description,
			status: featureStatus,
			activeForm: `Implementing: ${feature.description}`,
		});
	}

	return todos;
}

/**
 * Project detailed progress for the current session.
 */
export function projectDetailedProgress(goals: GoalTree, status: TaskStatus, currentFeature?: Feature, options: ProjectionOptions = {}): TodoItem[] {
	const todos: TodoItem[] = [];
	const { showAllFeatures = false, showCompletedMilestones = true } = options;

	for (const milestone of goals.milestones) {
		const ms = status.milestones[milestone.id];
		if (!ms) continue;

		// Skip completed milestones if not showing them
		if (!showCompletedMilestones && ms.status === 'passing') continue;

		const milestoneStatus = milestoneStatusToTodoStatus(ms.status);

		// Add milestone
		todos.push({
			content: `${milestone.name} (${ms.passing}/${ms.total})`,
			status: milestoneStatus,
			activeForm: `Working on ${milestone.name}`,
		});

		// Add features if showing all or if this is the current milestone
		const isCurrentMilestone = ms.status === 'in_progress' || (currentFeature && milestoneContainsFeature(milestone, currentFeature.id));

		if (showAllFeatures || isCurrentMilestone) {
			const features = getFeaturesInMilestone(milestone);
			for (const feature of features) {
				const fs = status.features[feature.id];
				const featureStatus = fs ? featureStatusToTodoStatus(fs.status) : 'pending';
				const isCurrent = currentFeature?.id === feature.id;

				todos.push({
					content: isCurrent ? `→ ${feature.description}` : `  ${feature.description}`,
					status: featureStatus,
					activeForm: `Implementing: ${feature.description}`,
				});
			}
		}
	}

	return todos;
}

export interface ProjectionOptions {
	/** Show all features, not just current milestone */
	showAllFeatures?: boolean;
	/** Show completed milestones */
	showCompletedMilestones?: boolean;
}

/**
 * Create a summary todo list for display.
 */
export function projectSummary(goals: GoalTree, status: TaskStatus): TodoItem[] {
	const todos: TodoItem[] = [];

	// Overall progress
	let passingFeatures = 0;
	let totalFeatures = 0;
	for (const fs of Object.values(status.features)) {
		totalFeatures++;
		if (fs.status === 'passing') passingFeatures++;
	}

	todos.push({
		content: `Task: ${goals.task} (${passingFeatures}/${totalFeatures} features)`,
		status: passingFeatures === totalFeatures ? 'completed' : 'in_progress',
		activeForm: `Working on ${goals.task}`,
	});

	// Milestones summary
	for (const milestone of goals.milestones) {
		const ms = status.milestones[milestone.id];
		if (!ms) continue;

		const statusIcon = ms.status === 'passing' ? '✓' : ms.status === 'in_progress' ? '→' : ms.status === 'blocked' ? '✗' : '○';

		todos.push({
			content: `${statusIcon} ${milestone.name} (${ms.passing}/${ms.total})`,
			status: milestoneStatusToTodoStatus(ms.status),
			activeForm: `Working on ${milestone.name}`,
		});
	}

	return todos;
}

// =============================================================================
// Helpers
// =============================================================================

function milestoneStatusToTodoStatus(status: 'pending' | 'in_progress' | 'passing' | 'blocked'): TodoItem['status'] {
	switch (status) {
		case 'passing':
			return 'completed';
		case 'in_progress':
			return 'in_progress';
		default:
			return 'pending';
	}
}

function featureStatusToTodoStatus(status: 'pending' | 'in_progress' | 'passing' | 'failing' | 'blocked'): TodoItem['status'] {
	switch (status) {
		case 'passing':
			return 'completed';
		case 'in_progress':
		case 'failing':
			return 'in_progress';
		default:
			return 'pending';
	}
}

function milestoneContainsFeature(milestone: MilestoneGoal, featureId: string): boolean {
	for (const subtask of milestone.subtasks) {
		if (subtask.features.some((f) => f.id === featureId)) {
			return true;
		}
	}
	return false;
}

/**
 * Format todo items for display (for debugging/logging).
 */
export function formatTodoItems(todos: TodoItem[]): string {
	return todos
		.map((todo) => {
			const icon = todo.status === 'completed' ? '✓' : todo.status === 'in_progress' ? '→' : '○';
			return `${icon} ${todo.content}`;
		})
		.join('\n');
}
