/**
 * Goal Tree Operations
 *
 * Operations for managing the hierarchical goal structure:
 * Task -> Milestone -> Subtask -> Feature
 *
 * Goals are stored in goals.yaml and are:
 * - Human-editable
 * - Stable (rarely changes after initialization)
 * - The source of truth for what needs to be done
 */

import { loadGoals, saveGoals } from './store';
import type { DomainMemoryPaths, Feature, GoalTree, MilestoneGoal, SubtaskGoal } from './types';

// =============================================================================
// Goal Tree Access
// =============================================================================

/**
 * Load the goal tree for a task.
 */
export async function getGoalTree(paths: DomainMemoryPaths): Promise<GoalTree | null> {
	return loadGoals(paths.goalsPath);
}

/**
 * Save the goal tree for a task.
 */
export async function setGoalTree(paths: DomainMemoryPaths, goals: GoalTree): Promise<void> {
	const updated: GoalTree = {
		...goals,
		updatedAt: new Date().toISOString(),
	};
	await saveGoals(paths.goalsPath, updated);
}

// =============================================================================
// Feature Traversal
// =============================================================================

/**
 * Get all features from the goal tree in dependency order.
 */
export function getAllFeatures(goals: GoalTree): Feature[] {
	const features: Feature[] = [];
	for (const milestone of goals.milestones) {
		for (const subtask of milestone.subtasks) {
			features.push(...subtask.features);
		}
	}
	return features;
}

/**
 * Get a feature by ID.
 */
export function getFeatureById(goals: GoalTree, featureId: string): Feature | null {
	for (const milestone of goals.milestones) {
		for (const subtask of milestone.subtasks) {
			const feature = subtask.features.find((f) => f.id === featureId);
			if (feature) return feature;
		}
	}
	return null;
}

/**
 * Get the milestone containing a feature.
 */
export function getMilestoneForFeature(goals: GoalTree, featureId: string): MilestoneGoal | null {
	for (const milestone of goals.milestones) {
		for (const subtask of milestone.subtasks) {
			if (subtask.features.some((f) => f.id === featureId)) {
				return milestone;
			}
		}
	}
	return null;
}

/**
 * Get the subtask containing a feature.
 */
export function getSubtaskForFeature(goals: GoalTree, featureId: string): SubtaskGoal | null {
	for (const milestone of goals.milestones) {
		for (const subtask of milestone.subtasks) {
			if (subtask.features.some((f) => f.id === featureId)) {
				return subtask;
			}
		}
	}
	return null;
}

/**
 * Get all features in a milestone.
 */
export function getFeaturesInMilestone(milestone: MilestoneGoal): Feature[] {
	const features: Feature[] = [];
	for (const subtask of milestone.subtasks) {
		features.push(...subtask.features);
	}
	return features;
}

/**
 * Get milestone by ID.
 */
export function getMilestoneById(goals: GoalTree, milestoneId: string): MilestoneGoal | null {
	return goals.milestones.find((m) => m.id === milestoneId) ?? null;
}

/**
 * Get subtask by ID.
 */
export function getSubtaskById(goals: GoalTree, subtaskId: string): SubtaskGoal | null {
	for (const milestone of goals.milestones) {
		const subtask = milestone.subtasks.find((s) => s.id === subtaskId);
		if (subtask) return subtask;
	}
	return null;
}

// =============================================================================
// Dependency Checking
// =============================================================================

/**
 * Check if all milestone dependencies are met (all features passing).
 */
export function checkMilestoneDependencies(goals: GoalTree, milestone: MilestoneGoal, passingFeatureIds: Set<string>): boolean {
	for (const depMilestoneId of milestone.dependsOn) {
		const depMilestone = getMilestoneById(goals, depMilestoneId);
		if (!depMilestone) continue;

		const depFeatures = getFeaturesInMilestone(depMilestone);
		const allPassing = depFeatures.every((f) => passingFeatureIds.has(f.id));
		if (!allPassing) return false;
	}
	return true;
}

/**
 * Check if all feature dependencies are met.
 */
export function checkFeatureDependencies(feature: Feature, passingFeatureIds: Set<string>): boolean {
	return feature.dependsOn.every((depId) => passingFeatureIds.has(depId));
}

// =============================================================================
// Goal Tree Validation
// =============================================================================

/**
 * Validate the goal tree structure.
 */
export function validateGoalTree(goals: GoalTree): ValidationResult {
	const errors: string[] = [];
	const warnings: string[] = [];

	// Check required fields
	if (!goals.task) errors.push('Missing task name');
	if (!goals.description) errors.push('Missing task description');
	if (!goals.milestones?.length) errors.push('No milestones defined');

	// Collect all IDs for reference checking
	const milestoneIds = new Set<string>();
	const featureIds = new Set<string>();

	for (const milestone of goals.milestones || []) {
		// Check for duplicate milestone IDs
		if (milestoneIds.has(milestone.id)) {
			errors.push(`Duplicate milestone ID: ${milestone.id}`);
		}
		milestoneIds.add(milestone.id);

		// Check milestone structure
		if (!milestone.name) warnings.push(`Milestone ${milestone.id} has no name`);
		if (!milestone.subtasks?.length) {
			errors.push(`Milestone ${milestone.id} has no subtasks`);
		}

		for (const subtask of milestone.subtasks || []) {
			if (!subtask.features?.length) {
				errors.push(`Subtask ${subtask.id} has no features`);
			}

			for (const feature of subtask.features || []) {
				// Check for duplicate feature IDs
				if (featureIds.has(feature.id)) {
					errors.push(`Duplicate feature ID: ${feature.id}`);
				}
				featureIds.add(feature.id);

				// Check feature structure
				if (!feature.testCommand) {
					errors.push(`Feature ${feature.id} has no testCommand`);
				}
			}
		}
	}

	// Check milestone dependencies reference valid milestones
	for (const milestone of goals.milestones || []) {
		for (const depId of milestone.dependsOn || []) {
			if (!milestoneIds.has(depId)) {
				errors.push(`Milestone ${milestone.id} depends on unknown milestone: ${depId}`);
			}
		}
	}

	// Check feature dependencies reference valid features
	for (const milestone of goals.milestones || []) {
		for (const subtask of milestone.subtasks || []) {
			for (const feature of subtask.features || []) {
				for (const depId of feature.dependsOn || []) {
					if (!featureIds.has(depId)) {
						errors.push(`Feature ${feature.id} depends on unknown feature: ${depId}`);
					}
				}
			}
		}
	}

	// Check for circular dependencies
	const circularMilestones = detectCircularDependencies(
		goals.milestones || [],
		(m) => m.id,
		(m) => m.dependsOn || [],
	);
	if (circularMilestones.length > 0) {
		errors.push(`Circular milestone dependencies: ${circularMilestones.join(' -> ')}`);
	}

	const allFeatures = getAllFeatures(goals);
	const circularFeatures = detectCircularDependencies(
		allFeatures,
		(f) => f.id,
		(f) => f.dependsOn || [],
	);
	if (circularFeatures.length > 0) {
		errors.push(`Circular feature dependencies: ${circularFeatures.join(' -> ')}`);
	}

	return {
		valid: errors.length === 0,
		errors,
		warnings,
	};
}

interface ValidationResult {
	valid: boolean;
	errors: string[];
	warnings: string[];
}

/**
 * Detect circular dependencies using DFS.
 */
function detectCircularDependencies<T>(items: T[], getId: (item: T) => string, getDeps: (item: T) => string[]): string[] {
	const itemMap = new Map<string, T>();
	for (const item of items) {
		itemMap.set(getId(item), item);
	}

	const visited = new Set<string>();
	const recursionStack = new Set<string>();
	const path: string[] = [];

	function dfs(id: string): string[] | null {
		if (recursionStack.has(id)) {
			// Found cycle
			const cycleStart = path.indexOf(id);
			return [...path.slice(cycleStart), id];
		}

		if (visited.has(id)) return null;

		const item = itemMap.get(id);
		if (!item) return null;

		visited.add(id);
		recursionStack.add(id);
		path.push(id);

		for (const depId of getDeps(item)) {
			const cycle = dfs(depId);
			if (cycle) return cycle;
		}

		path.pop();
		recursionStack.delete(id);
		return null;
	}

	for (const item of items) {
		const cycle = dfs(getId(item));
		if (cycle) return cycle;
	}

	return [];
}

// =============================================================================
// Goal Tree Creation
// =============================================================================

/**
 * Create a new goal tree.
 */
export function createGoalTree(task: string, description: string, milestones: MilestoneGoal[]): GoalTree {
	return {
		task,
		description,
		createdAt: new Date().toISOString(),
		milestones,
	};
}

/**
 * Create a new milestone.
 */
export function createMilestone(
	id: string,
	name: string,
	description: string,
	subtasks: SubtaskGoal[],
	options: {
		requiresHumanReview?: boolean;
		dependsOn?: string[];
		completionCriteria?: string[];
	} = {},
): MilestoneGoal {
	return {
		id,
		name,
		description,
		subtasks,
		requiresHumanReview: options.requiresHumanReview ?? false,
		dependsOn: options.dependsOn ?? [],
		completionCriteria: options.completionCriteria ?? [],
	};
}

/**
 * Create a new subtask.
 */
export function createSubtask(id: string, name: string, description: string, features: Feature[]): SubtaskGoal {
	return {
		id,
		name,
		description,
		features,
	};
}

/**
 * Create a new feature.
 */
export function createFeature(
	id: string,
	description: string,
	testCommand: string,
	options: {
		dependsOn?: string[];
		estimatedComplexity?: 'low' | 'medium' | 'high';
	} = {},
): Feature {
	return {
		id,
		description,
		testCommand,
		dependsOn: options.dependsOn ?? [],
		estimatedComplexity: options.estimatedComplexity ?? 'medium',
	};
}

// =============================================================================
// Goal Tree Statistics
// =============================================================================

/**
 * Get statistics about the goal tree.
 */
export function getGoalTreeStats(goals: GoalTree): GoalTreeStats {
	let totalFeatures = 0;
	let totalSubtasks = 0;
	const complexityCounts = { low: 0, medium: 0, high: 0 };

	for (const milestone of goals.milestones) {
		totalSubtasks += milestone.subtasks.length;
		for (const subtask of milestone.subtasks) {
			totalFeatures += subtask.features.length;
			for (const feature of subtask.features) {
				complexityCounts[feature.estimatedComplexity]++;
			}
		}
	}

	return {
		milestones: goals.milestones.length,
		subtasks: totalSubtasks,
		features: totalFeatures,
		complexity: complexityCounts,
		hasHumanReviewMilestones: goals.milestones.some((m) => m.requiresHumanReview),
	};
}

interface GoalTreeStats {
	milestones: number;
	subtasks: number;
	features: number;
	complexity: {
		low: number;
		medium: number;
		high: number;
	};
	hasHumanReviewMilestones: boolean;
}
