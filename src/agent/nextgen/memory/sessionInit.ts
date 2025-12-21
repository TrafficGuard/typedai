/**
 * Session Initialization
 *
 * Initializes a worker session with context hydrated from domain memory.
 * This is the entry point for starting or resuming work on a task.
 */

import { extractPreviousAttempts, generateContextMarkdown, generateSessionContext, saveContext } from './context';
import { getAllFeatures } from './goals';
import { getFeatureProgress } from './progress';
import { projectToTodoWrite } from './projection';
import { hasExceededMaxAttempts, selectNextFeature } from './status';
import { loadDomainMemory } from './store';
import type {
	DecisionSummary,
	DesignDecisionSummary,
	DomainMemoryPaths,
	Feature,
	GoalTree,
	Learning,
	RelevantFile,
	ReviewHistorySummary,
	SessionInitBlocked,
	SessionInitComplete,
	SessionInitResult,
	SessionInitSuccess,
	TaskStatus,
	TodoItem,
} from './types';

// =============================================================================
// Session Initialization
// =============================================================================

/**
 * Initialize a worker session from domain memory.
 *
 * This function:
 * 1. Loads persistent state (goals.yaml, status.json, progress.md)
 * 2. Selects the next feature to work on
 * 3. Checks attempt limits (escalates if max reached)
 * 4. Generates context.md for the session
 * 5. Projects to TodoWrite for display
 */
export async function initializeWorkerSession(paths: DomainMemoryPaths, options: SessionInitOptions = {}): Promise<SessionInitResult> {
	// 1. Load domain memory
	const { goals, status, progress } = await loadDomainMemory(paths);

	if (!goals || !status) {
		return {
			type: 'blocked',
			reason: 'dependency_blocked',
			details: 'Domain memory not found. Run initializer agent first.',
		};
	}

	// 2. Select next feature
	const nextFeature = selectNextFeature(goals, status);

	if (!nextFeature) {
		// Check if all features are passing (task complete)
		const allFeatures = getAllFeatures(goals);
		const allPassing = allFeatures.every((f) => status.features[f.id]?.status === 'passing');

		if (allPassing) {
			return {
				type: 'complete',
				reason: 'all_features_passing',
			};
		}

		// Otherwise, blocked (all remaining features are blocked or dependencies not met)
		return {
			type: 'blocked',
			reason: 'dependency_blocked',
			details: 'No eligible features to work on. Check blocked features.',
		};
	}

	// 3. Check attempt limit
	if (hasExceededMaxAttempts(status, nextFeature.id)) {
		return {
			type: 'blocked',
			reason: 'max_attempts_reached',
			featureId: nextFeature.id,
			details: `Feature ${nextFeature.id} has exceeded maximum attempts. Requires human intervention.`,
		};
	}

	// 4. Check for human review requirements
	const milestone = findMilestoneForFeature(goals, nextFeature.id);
	if (milestone?.requiresHumanReview) {
		const milestoneStatus = status.milestones[milestone.id];
		if (milestoneStatus?.status === 'passing') {
			// Milestone complete but needs human review
			return {
				type: 'blocked',
				reason: 'human_review_required',
				milestoneId: milestone.id,
				details: `Milestone ${milestone.id} requires human review before continuing.`,
			};
		}
	}

	// 5. Extract previous attempts from progress
	const previousAttempts = progress ? extractPreviousAttempts(progress, nextFeature.id) : [];

	// 6. Get additional context (discovery, KB, decisions)
	const { relevantFiles, learnings, recentDecisions, bindingDesignDecisions } = await gatherAdditionalContext(goals, status, nextFeature, progress, options);

	// 7. Generate session context
	const context = generateSessionContext(goals, status, nextFeature, {
		previousAttempts,
		reviewHistory: options.reviewHistory || [],
		relevantFiles,
		learnings,
		recentDecisions,
		bindingDesignDecisions,
	});

	// 8. Generate and save context.md
	const contextMarkdown = generateContextMarkdown(context);
	await saveContext(paths, context);

	// 9. Project to TodoWrite
	const todoItems = projectToTodoWrite(goals, status, nextFeature);

	return {
		type: 'success',
		context,
		contextMarkdown,
		todoItems,
	};
}

export interface SessionInitOptions {
	/** Discover relevant files for the feature */
	discoverFiles?: (featureDescription: string) => Promise<RelevantFile[]>;
	/** Get KB learnings for the feature */
	getLearnings?: (featureDescription: string, filePaths: string[]) => Promise<Learning[]>;
	/** Recent decisions from orchestrator */
	recentDecisions?: DecisionSummary[];
	/** Review history for the feature */
	reviewHistory?: ReviewHistorySummary[];
	/** Binding design decisions from previous reviews */
	bindingDesignDecisions?: DesignDecisionSummary[];
}

// =============================================================================
// Additional Context Gathering
// =============================================================================

async function gatherAdditionalContext(
	goals: GoalTree,
	status: TaskStatus,
	feature: Feature,
	progress: string | null,
	options: SessionInitOptions,
): Promise<{
	relevantFiles: RelevantFile[];
	learnings: Learning[];
	recentDecisions: DecisionSummary[];
	bindingDesignDecisions: DesignDecisionSummary[];
}> {
	// Discover relevant files
	let relevantFiles: RelevantFile[] = [];
	if (options.discoverFiles) {
		try {
			relevantFiles = await options.discoverFiles(feature.description);
		} catch (error) {
			// Discovery failed, continue without files
			console.error('File discovery failed:', error);
		}
	}

	// Get KB learnings
	let learnings: Learning[] = [];
	if (options.getLearnings) {
		try {
			const filePaths = relevantFiles.map((f) => f.filePath);
			learnings = await options.getLearnings(feature.description, filePaths);
		} catch (error) {
			// KB lookup failed, continue without learnings
			console.error('Knowledge base lookup failed:', error);
		}
	}

	return {
		relevantFiles,
		learnings,
		recentDecisions: options.recentDecisions || [],
		bindingDesignDecisions: options.bindingDesignDecisions || [],
	};
}

// =============================================================================
// Helpers
// =============================================================================

function findMilestoneForFeature(goals: GoalTree, featureId: string): GoalTree['milestones'][0] | null {
	for (const milestone of goals.milestones) {
		for (const subtask of milestone.subtasks) {
			if (subtask.features.some((f) => f.id === featureId)) {
				return milestone;
			}
		}
	}
	return null;
}

// =============================================================================
// Session State Management
// =============================================================================

/**
 * Handle dirty git state before starting a session.
 * This should be called before selecting the next feature.
 */
export async function handleDirtyGitState(workingDir: string): Promise<DirtyStateResult> {
	// This would integrate with git to:
	// 1. Check for uncommitted changes
	// 2. Stash or commit them appropriately
	// 3. Return to a clean state

	// For now, return clean (implementation would use gitBranching.ts)
	return {
		wasDirty: false,
		action: 'none',
	};
}

export interface DirtyStateResult {
	wasDirty: boolean;
	action: 'none' | 'stashed' | 'committed' | 'reset';
	stashRef?: string;
	commitSha?: string;
}

/**
 * Resume from a previous session checkpoint.
 */
export async function resumeFromCheckpoint(
	paths: DomainMemoryPaths,
	checkpointFeatureId: string,
	options: SessionInitOptions = {},
): Promise<SessionInitResult> {
	// Load domain memory
	const { goals, status, progress } = await loadDomainMemory(paths);

	if (!goals || !status) {
		return {
			type: 'blocked',
			reason: 'dependency_blocked',
			details: 'Domain memory not found.',
		};
	}

	// Find the checkpoint feature
	const allFeatures = getAllFeatures(goals);
	const feature = allFeatures.find((f) => f.id === checkpointFeatureId);

	if (!feature) {
		// Feature not found, fall back to normal initialization
		return initializeWorkerSession(paths, options);
	}

	// Check if feature is still eligible
	const featureStatus = status.features[feature.id];
	if (featureStatus?.status === 'passing') {
		// Feature already complete, select next
		return initializeWorkerSession(paths, options);
	}

	// Resume with this feature
	const previousAttempts = progress ? extractPreviousAttempts(progress, feature.id) : [];

	const { relevantFiles, learnings, recentDecisions, bindingDesignDecisions } = await gatherAdditionalContext(goals, status, feature, progress, options);

	const context = generateSessionContext(goals, status, feature, {
		previousAttempts,
		reviewHistory: options.reviewHistory || [],
		relevantFiles,
		learnings,
		recentDecisions,
		bindingDesignDecisions,
	});

	const contextMarkdown = generateContextMarkdown(context);
	await saveContext(paths, context);

	const todoItems = projectToTodoWrite(goals, status, feature);

	return {
		type: 'success',
		context,
		contextMarkdown,
		todoItems,
	};
}

/**
 * Validate that domain memory is in a consistent state.
 */
export async function validateDomainMemory(paths: DomainMemoryPaths): Promise<ValidationResult> {
	const { goals, status } = await loadDomainMemory(paths);
	const errors: string[] = [];

	if (!goals) {
		errors.push('goals.yaml not found');
	}
	if (!status) {
		errors.push('status.json not found');
	}

	if (goals && status) {
		// Check that all features in goals have status entries
		const allFeatures = getAllFeatures(goals);
		for (const feature of allFeatures) {
			if (!status.features[feature.id]) {
				errors.push(`Missing status for feature: ${feature.id}`);
			}
		}

		// Check that all milestones have status entries
		for (const milestone of goals.milestones) {
			if (!status.milestones[milestone.id]) {
				errors.push(`Missing status for milestone: ${milestone.id}`);
			}
		}
	}

	return {
		valid: errors.length === 0,
		errors,
	};
}

interface ValidationResult {
	valid: boolean;
	errors: string[];
}
