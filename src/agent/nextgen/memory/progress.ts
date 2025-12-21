/**
 * Progress Log
 *
 * Manages the append-only audit log stored in progress.md.
 * Each session appends entries documenting what happened.
 *
 * The progress log serves as:
 * 1. An audit trail of all actions taken
 * 2. Context for new sessions (what was tried before)
 * 3. A human-readable history of the task
 */

import { appendMarkdown, formatProgressEntry, loadMarkdown, saveMarkdown } from './store';
import type { DomainMemoryPaths, Feature, GoalTree, ParallelOptionDetails, ProgressDetails, ProgressEntry, ProgressEntryType, TestResult } from './types';

// =============================================================================
// Progress Log Access
// =============================================================================

/**
 * Load the progress log content.
 */
export async function getProgressLog(paths: DomainMemoryPaths): Promise<string | null> {
	return loadMarkdown(paths.progressPath);
}

/**
 * Initialize the progress log for a new task.
 */
export async function initializeProgressLog(paths: DomainMemoryPaths, taskId: string, taskDescription: string): Promise<void> {
	const header = `# Progress Log: ${taskId}

> ${taskDescription}

---

`;
	await saveMarkdown(paths.progressPath, header);
}

// =============================================================================
// Append Entries
// =============================================================================

/**
 * Append an entry to the progress log.
 */
export async function appendProgressEntry(paths: DomainMemoryPaths, entry: ProgressEntry): Promise<void> {
	const formatted = formatProgressEntry(entry);
	await appendMarkdown(paths.progressPath, formatted);
}

/**
 * Create and append a progress entry.
 */
async function appendEntry(
	paths: DomainMemoryPaths,
	type: ProgressEntryType,
	summary: string,
	details: ProgressDetails,
	featureId?: string,
	milestoneId?: string,
): Promise<void> {
	const entry: ProgressEntry = {
		timestamp: new Date().toISOString(),
		type,
		featureId,
		milestoneId,
		summary,
		details,
	};
	await appendProgressEntry(paths, entry);
}

// =============================================================================
// Initialization Entries
// =============================================================================

/**
 * Log task initialization.
 */
export async function logInitialization(
	paths: DomainMemoryPaths,
	goals: GoalTree,
	details: {
		milestonesCount: number;
		featuresCount: number;
	},
): Promise<void> {
	await appendEntry(paths, 'initialization', `Task initialized with ${details.milestonesCount} milestones and ${details.featuresCount} features`, {
		approach: `Goal tree created for: ${goals.task}`,
	});
}

// =============================================================================
// Feature Entries
// =============================================================================

/**
 * Log a feature attempt.
 */
export async function logFeatureAttempt(paths: DomainMemoryPaths, feature: Feature, approach: string, attempt: number): Promise<void> {
	await appendEntry(
		paths,
		'feature_attempt',
		`Starting attempt ${attempt} for feature: ${feature.description}`,
		{
			approach,
			attempt,
			testCommand: feature.testCommand,
		},
		feature.id,
	);
}

/**
 * Log a feature test pass.
 */
export async function logFeaturePassed(
	paths: DomainMemoryPaths,
	feature: Feature,
	testResult: TestResult,
	filesChanged: string[],
	commits: string[],
): Promise<void> {
	await appendEntry(
		paths,
		'feature_passed',
		`Tests passed for feature: ${feature.description}`,
		{
			testCommand: feature.testCommand,
			testOutput: testResult.output.slice(0, 500), // Truncate for readability
			filesChanged,
			commits,
		},
		feature.id,
	);
}

/**
 * Log a feature test failure.
 */
export async function logFeatureFailed(paths: DomainMemoryPaths, feature: Feature, testResult: TestResult, attempt: number): Promise<void> {
	await appendEntry(
		paths,
		'feature_failed',
		`Tests failed for feature: ${feature.description} (attempt ${attempt})`,
		{
			testCommand: feature.testCommand,
			error: testResult.error || testResult.output.slice(0, 500),
			attempt,
		},
		feature.id,
	);
}

// =============================================================================
// Review Entries
// =============================================================================

/**
 * Log a review approval.
 */
export async function logReviewApproved(paths: DomainMemoryPaths, featureId: string, feedback: string): Promise<void> {
	await appendEntry(
		paths,
		'review_approved',
		'Feature approved by review agent',
		{
			feedback,
		},
		featureId,
	);
}

/**
 * Log review changes requested.
 */
export async function logReviewChangesRequested(paths: DomainMemoryPaths, featureId: string, feedback: string, designDecisions: string[]): Promise<void> {
	await appendEntry(
		paths,
		'review_changes_requested',
		'Review agent requested changes',
		{
			feedback,
			designDecisions,
		},
		featureId,
	);
}

/**
 * Log review escalation to human.
 */
export async function logReviewEscalated(paths: DomainMemoryPaths, featureId: string, reason: string): Promise<void> {
	await appendEntry(
		paths,
		'review_escalated',
		'Review escalated to human',
		{
			feedback: reason,
		},
		featureId,
	);
}

// =============================================================================
// Milestone Entries
// =============================================================================

/**
 * Log milestone completion.
 */
export async function logMilestoneCompleted(paths: DomainMemoryPaths, milestoneId: string, milestoneName: string, featuresCompleted: number): Promise<void> {
	await appendEntry(paths, 'milestone_completed', `Milestone completed: ${milestoneName} (${featuresCompleted} features)`, {}, undefined, milestoneId);
}

// =============================================================================
// Parallel Exploration Entries
// =============================================================================

/**
 * Log parallel exploration result.
 */
export async function logParallelExploration(
	paths: DomainMemoryPaths,
	featureId: string,
	optionA: ParallelOptionDetails,
	optionB: ParallelOptionDetails,
	winner: 'a' | 'b' | null,
	reasoning?: string,
): Promise<void> {
	await appendEntry(
		paths,
		'parallel_exploration',
		winner ? `Parallel exploration complete: Option ${winner.toUpperCase()} selected` : 'Parallel exploration complete: No clear winner',
		{
			optionA,
			optionB,
			winner: winner ?? undefined,
			feedback: reasoning,
		},
		featureId,
	);
}

/**
 * Log the start of parallel exploration for a feature.
 */
export async function logParallelExplorationStarted(paths: DomainMemoryPaths, featureId: string, approachIds: string[]): Promise<void> {
	await appendEntry(
		paths,
		'parallel_exploration',
		`Parallel exploration started for feature with ${approachIds.length} approaches`,
		{
			approach: `Exploring approaches: ${approachIds.join(', ')}`,
		},
		featureId,
	);
}

/**
 * Log the completion of parallel exploration for a feature.
 */
export async function logParallelExplorationComplete(
	paths: DomainMemoryPaths,
	featureId: string,
	selectedApproachId: string,
	selectionMethod: string,
	reasoning: string,
): Promise<void> {
	await appendEntry(
		paths,
		'parallel_exploration',
		`Parallel exploration complete: ${selectedApproachId} selected via ${selectionMethod}`,
		{
			approach: selectedApproachId,
			feedback: reasoning,
		},
		featureId,
	);
}

// =============================================================================
// Human Intervention Entries
// =============================================================================

/**
 * Log human intervention.
 */
export async function logHumanIntervention(
	paths: DomainMemoryPaths,
	action: string,
	feedback: string,
	featureId?: string,
	milestoneId?: string,
): Promise<void> {
	await appendEntry(
		paths,
		'human_intervention',
		`Human intervention: ${action}`,
		{
			humanAction: action,
			humanFeedback: feedback,
		},
		featureId,
		milestoneId,
	);
}

// =============================================================================
// Error Entries
// =============================================================================

/**
 * Log an error.
 */
export async function logError(paths: DomainMemoryPaths, error: string, featureId?: string): Promise<void> {
	await appendEntry(
		paths,
		'error',
		`Error: ${error}`,
		{
			error,
		},
		featureId,
	);
}

// =============================================================================
// Progress Parsing
// =============================================================================

/**
 * Parse progress entries from markdown content.
 * Returns the most recent N entries.
 */
export function parseRecentProgress(content: string, limit = 10): ParsedProgressEntry[] {
	const entries: ParsedProgressEntry[] = [];

	// Split by entry headers (## timestamp - type)
	const entryPattern = /## (\d{4}-\d{2}-\d{2}T[\d:\.Z+-]+) - ([^\n]+)\n/g;
	const matches = [...content.matchAll(entryPattern)];

	for (let i = 0; i < matches.length; i++) {
		const match = matches[i];
		const nextMatch = matches[i + 1];

		const timestamp = match[1];
		const type = match[2];
		const startIndex = match.index! + match[0].length;
		const endIndex = nextMatch?.index ?? content.length;
		const body = content.slice(startIndex, endIndex).trim();

		entries.push({
			timestamp,
			type,
			body,
		});
	}

	// Return most recent entries
	return entries.slice(-limit);
}

interface ParsedProgressEntry {
	timestamp: string;
	type: string;
	body: string;
}

/**
 * Get progress entries for a specific feature.
 */
export function getFeatureProgress(content: string, featureId: string): ParsedProgressEntry[] {
	const allEntries = parseRecentProgress(content, 100);
	return allEntries.filter((e) => e.body.includes(`**Feature:** ${featureId}`));
}

/**
 * Get the number of attempts for a feature from progress log.
 */
export function countFeatureAttempts(content: string, featureId: string): number {
	const featureEntries = getFeatureProgress(content, featureId);
	return featureEntries.filter((e) => e.type === 'Feature Attempt' || e.type === 'Feature Failed' || e.type === 'Feature Passed').length;
}
