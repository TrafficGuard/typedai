/**
 * Status Manager
 *
 * Manages the test-verified status of features and milestones.
 * Status is stored in status.json and can ONLY be updated by:
 * 1. Test results (testRunner.ts)
 * 2. Review agent decisions (reviewAgent.ts)
 *
 * Agents CANNOT directly set status to 'passing'.
 */

import { getAllFeatures, getFeaturesInMilestone } from './goals';
import { loadStatus, saveStatus } from './store';
import type { DomainMemoryPaths, Feature, FeatureStatus, FeatureStatusValue, GoalTree, MilestoneStatus, TaskStatus, TestResult } from './types';

// =============================================================================
// Status Access
// =============================================================================

/**
 * Load the task status.
 */
export async function getTaskStatus(paths: DomainMemoryPaths): Promise<TaskStatus | null> {
	return loadStatus(paths.statusPath);
}

/**
 * Save the task status.
 */
export async function setTaskStatus(paths: DomainMemoryPaths, status: TaskStatus): Promise<void> {
	const updated: TaskStatus = {
		...status,
		lastUpdated: new Date().toISOString(),
	};
	await saveStatus(paths.statusPath, updated);
}

// =============================================================================
// Status Initialization
// =============================================================================

/**
 * Initialize status for a new task from goals.
 */
export function initializeStatus(taskId: string, goals: GoalTree): TaskStatus {
	const features: Record<string, FeatureStatus> = {};
	const milestones: Record<string, MilestoneStatus> = {};

	// Initialize all features as pending
	const allFeatures = getAllFeatures(goals);
	for (const feature of allFeatures) {
		features[feature.id] = createInitialFeatureStatus();
	}

	// Initialize all milestones
	for (const milestone of goals.milestones) {
		const total = getFeaturesInMilestone(milestone).length;
		milestones[milestone.id] = {
			status: 'pending',
			passing: 0,
			total,
		};
	}

	return {
		taskId,
		lastUpdated: new Date().toISOString(),
		features,
		milestones,
	};
}

/**
 * Create initial feature status.
 */
function createInitialFeatureStatus(): FeatureStatus {
	return {
		status: 'pending',
		attempts: 0,
		maxAttempts: 3,
		commits: [],
	};
}

// =============================================================================
// Status Updates (Test-Bound)
// =============================================================================

/**
 * Update feature status based on test result.
 * This is the ONLY way to transition to 'passing' status.
 */
export function updateFeatureStatusFromTest(status: TaskStatus, featureId: string, testResult: TestResult, commits: string[] = []): TaskStatus {
	const featureStatus = status.features[featureId];
	if (!featureStatus) {
		throw new Error(`Feature not found: ${featureId}`);
	}

	const newFeatureStatus: FeatureStatus = {
		...featureStatus,
		lastTest: new Date().toISOString(),
		lastTestDuration: testResult.duration,
		attempts: featureStatus.attempts + 1,
		commits: [...featureStatus.commits, ...commits],
	};

	if (testResult.passed) {
		// Tests passed, but still needs review to become 'passing'
		// For now, mark as 'in_progress' until review approves
		newFeatureStatus.status = 'in_progress';
		newFeatureStatus.lastError = undefined;
	} else {
		// Tests failed
		newFeatureStatus.status = 'failing';
		newFeatureStatus.lastError = testResult.error || testResult.output;
	}

	return {
		...status,
		lastUpdated: new Date().toISOString(),
		features: {
			...status.features,
			[featureId]: newFeatureStatus,
		},
	};
}

/**
 * Mark feature as passing after review approval.
 * This is the ONLY way to set status to 'passing'.
 */
export function approveFeature(status: TaskStatus, featureId: string): TaskStatus {
	const featureStatus = status.features[featureId];
	if (!featureStatus) {
		throw new Error(`Feature not found: ${featureId}`);
	}

	// Feature must have passed tests before approval
	if (featureStatus.status !== 'in_progress') {
		throw new Error(`Cannot approve feature ${featureId} in status '${featureStatus.status}'. Must be 'in_progress' (tests passed, awaiting review).`);
	}

	return {
		...status,
		lastUpdated: new Date().toISOString(),
		features: {
			...status.features,
			[featureId]: {
				...featureStatus,
				status: 'passing',
			},
		},
	};
}

/**
 * Mark feature as failing after review rejection.
 */
export function rejectFeature(status: TaskStatus, featureId: string, feedback: string): TaskStatus {
	const featureStatus = status.features[featureId];
	if (!featureStatus) {
		throw new Error(`Feature not found: ${featureId}`);
	}

	return {
		...status,
		lastUpdated: new Date().toISOString(),
		features: {
			...status.features,
			[featureId]: {
				...featureStatus,
				status: 'failing',
				lastError: feedback,
			},
		},
	};
}

/**
 * Mark feature as blocked.
 */
export function blockFeature(status: TaskStatus, featureId: string, reason: string): TaskStatus {
	const featureStatus = status.features[featureId];
	if (!featureStatus) {
		throw new Error(`Feature not found: ${featureId}`);
	}

	return {
		...status,
		lastUpdated: new Date().toISOString(),
		features: {
			...status.features,
			[featureId]: {
				...featureStatus,
				status: 'blocked',
				lastError: reason,
			},
		},
	};
}

/**
 * Mark feature as in_progress when work starts.
 */
export function startFeature(status: TaskStatus, featureId: string): TaskStatus {
	const featureStatus = status.features[featureId];
	if (!featureStatus) {
		throw new Error(`Feature not found: ${featureId}`);
	}

	// Only transition from pending or failing
	if (featureStatus.status !== 'pending' && featureStatus.status !== 'failing') {
		return status; // No change needed
	}

	return {
		...status,
		lastUpdated: new Date().toISOString(),
		features: {
			...status.features,
			[featureId]: {
				...featureStatus,
				status: 'in_progress',
			},
		},
	};
}

// =============================================================================
// Milestone Status Updates
// =============================================================================

/**
 * Recalculate milestone status based on feature statuses.
 */
export function recalculateMilestoneStatus(status: TaskStatus, goals: GoalTree): TaskStatus {
	const updatedMilestones: Record<string, MilestoneStatus> = {};

	for (const milestone of goals.milestones) {
		const features = getFeaturesInMilestone(milestone);
		let passing = 0;
		let blocked = 0;
		let inProgress = 0;

		for (const feature of features) {
			const fs = status.features[feature.id];
			if (fs?.status === 'passing') passing++;
			if (fs?.status === 'blocked') blocked++;
			if (fs?.status === 'in_progress') inProgress++;
		}

		let milestoneStatus: MilestoneStatus['status'];
		if (passing === features.length) {
			milestoneStatus = 'passing';
		} else if (blocked > 0 && passing + blocked === features.length) {
			milestoneStatus = 'blocked';
		} else if (inProgress > 0 || passing > 0) {
			milestoneStatus = 'in_progress';
		} else {
			milestoneStatus = 'pending';
		}

		updatedMilestones[milestone.id] = {
			status: milestoneStatus,
			passing,
			total: features.length,
		};
	}

	return {
		...status,
		lastUpdated: new Date().toISOString(),
		milestones: updatedMilestones,
	};
}

// =============================================================================
// Feature Selection
// =============================================================================

/**
 * Select the next feature to work on.
 * Returns null if all features are passing or blocked.
 */
export function selectNextFeature(goals: GoalTree, status: TaskStatus): Feature | null {
	const passingIds = new Set<string>();
	for (const [id, fs] of Object.entries(status.features)) {
		if (fs.status === 'passing') passingIds.add(id);
	}

	for (const milestone of goals.milestones) {
		// Check milestone dependencies
		let milestoneDepsmet = true;
		for (const depId of milestone.dependsOn) {
			const depMilestone = goals.milestones.find((m) => m.id === depId);
			if (depMilestone) {
				const depFeatures = getFeaturesInMilestone(depMilestone);
				if (!depFeatures.every((f) => passingIds.has(f.id))) {
					milestoneDepsmet = false;
					break;
				}
			}
		}
		if (!milestoneDepsmet) continue;

		for (const subtask of milestone.subtasks) {
			for (const feature of subtask.features) {
				const fs = status.features[feature.id];

				// Skip passing features
				if (fs?.status === 'passing') continue;

				// Skip blocked features
				if (fs?.status === 'blocked') continue;

				// Check feature dependencies
				const depsMet = feature.dependsOn.every((depId) => passingIds.has(depId));
				if (!depsMet) continue;

				// Return first eligible feature
				return feature;
			}
		}
	}

	return null;
}

/**
 * Check if a feature has exceeded its max attempts.
 */
export function hasExceededMaxAttempts(status: TaskStatus, featureId: string): boolean {
	const fs = status.features[featureId];
	if (!fs) return false;
	return fs.attempts >= fs.maxAttempts;
}

/**
 * Get all features that have exceeded max attempts.
 */
export function getBlockedFeatures(goals: GoalTree, status: TaskStatus): Feature[] {
	const blocked: Feature[] = [];
	const allFeatures = getAllFeatures(goals);

	for (const feature of allFeatures) {
		const fs = status.features[feature.id];
		if (fs?.status === 'blocked' || hasExceededMaxAttempts(status, feature.id)) {
			blocked.push(feature);
		}
	}

	return blocked;
}

// =============================================================================
// Progress Queries
// =============================================================================

/**
 * Get overall progress summary.
 */
export function getProgressSummary(
	goals: GoalTree,
	status: TaskStatus,
): {
	passingFeatures: number;
	totalFeatures: number;
	passingMilestones: number;
	totalMilestones: number;
	percentComplete: number;
} {
	const allFeatures = getAllFeatures(goals);
	let passingFeatures = 0;

	for (const feature of allFeatures) {
		if (status.features[feature.id]?.status === 'passing') {
			passingFeatures++;
		}
	}

	let passingMilestones = 0;
	for (const milestone of goals.milestones) {
		if (status.milestones[milestone.id]?.status === 'passing') {
			passingMilestones++;
		}
	}

	return {
		passingFeatures,
		totalFeatures: allFeatures.length,
		passingMilestones,
		totalMilestones: goals.milestones.length,
		percentComplete: allFeatures.length > 0 ? Math.round((passingFeatures / allFeatures.length) * 100) : 0,
	};
}

/**
 * Check if task is complete (all features passing).
 */
export function isTaskComplete(goals: GoalTree, status: TaskStatus): boolean {
	const allFeatures = getAllFeatures(goals);
	return allFeatures.every((f) => status.features[f.id]?.status === 'passing');
}

/**
 * Get features by status.
 */
export function getFeaturesByStatus(goals: GoalTree, status: TaskStatus, targetStatus: FeatureStatusValue): Feature[] {
	const allFeatures = getAllFeatures(goals);
	return allFeatures.filter((f) => status.features[f.id]?.status === targetStatus);
}
