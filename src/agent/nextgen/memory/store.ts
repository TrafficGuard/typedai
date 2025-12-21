/**
 * Domain Memory Store
 *
 * File I/O operations for domain memory files:
 * - goals.yaml (YAML)
 * - status.json (JSON)
 * - progress.md (Markdown - append-only)
 * - context.md (Markdown - regenerated)
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import type { DomainMemoryPaths, GoalTree, ProgressEntry, ReviewPaths, TaskStatus } from './types';

// =============================================================================
// Directory Operations
// =============================================================================

/**
 * Ensure a directory exists, creating it if necessary.
 */
export async function ensureDir(dirPath: string): Promise<void> {
	await fs.mkdir(dirPath, { recursive: true });
}

/**
 * Check if a file exists.
 */
export async function fileExists(filePath: string): Promise<boolean> {
	try {
		await fs.access(filePath);
		return true;
	} catch {
		return false;
	}
}

// =============================================================================
// YAML Operations (goals.yaml)
// =============================================================================

/**
 * Load goals.yaml file.
 */
export async function loadGoals(goalsPath: string): Promise<GoalTree | null> {
	try {
		const content = await fs.readFile(goalsPath, 'utf-8');
		return parseYaml(content) as GoalTree;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
			return null;
		}
		throw error;
	}
}

/**
 * Save goals.yaml file.
 */
export async function saveGoals(goalsPath: string, goals: GoalTree): Promise<void> {
	await ensureDir(path.dirname(goalsPath));
	const content = stringifyYaml(goals, {
		indent: 2,
		lineWidth: 100,
		singleQuote: true,
	});
	await fs.writeFile(goalsPath, content, 'utf-8');
}

// =============================================================================
// JSON Operations (status.json, review files)
// =============================================================================

/**
 * Load a JSON file.
 */
export async function loadJson<T>(filePath: string): Promise<T | null> {
	try {
		const content = await fs.readFile(filePath, 'utf-8');
		return JSON.parse(content) as T;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
			return null;
		}
		throw error;
	}
}

/**
 * Save a JSON file.
 */
export async function saveJson<T>(filePath: string, data: T): Promise<void> {
	await ensureDir(path.dirname(filePath));
	const content = JSON.stringify(data, null, 2);
	await fs.writeFile(filePath, content, 'utf-8');
}

/**
 * Load status.json file.
 */
export async function loadStatus(statusPath: string): Promise<TaskStatus | null> {
	return loadJson<TaskStatus>(statusPath);
}

/**
 * Save status.json file.
 */
export async function saveStatus(statusPath: string, status: TaskStatus): Promise<void> {
	await saveJson(statusPath, status);
}

// =============================================================================
// Markdown Operations (progress.md, context.md)
// =============================================================================

/**
 * Load a markdown file.
 */
export async function loadMarkdown(filePath: string): Promise<string | null> {
	try {
		return await fs.readFile(filePath, 'utf-8');
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
			return null;
		}
		throw error;
	}
}

/**
 * Save a markdown file.
 */
export async function saveMarkdown(filePath: string, content: string): Promise<void> {
	await ensureDir(path.dirname(filePath));
	await fs.writeFile(filePath, content, 'utf-8');
}

/**
 * Append to a markdown file (for progress.md).
 */
export async function appendMarkdown(filePath: string, content: string): Promise<void> {
	await ensureDir(path.dirname(filePath));
	try {
		await fs.appendFile(filePath, content, 'utf-8');
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
			// File doesn't exist, create it
			await fs.writeFile(filePath, content, 'utf-8');
		} else {
			throw error;
		}
	}
}

// =============================================================================
// Progress Entry Formatting
// =============================================================================

/**
 * Format a progress entry as markdown.
 */
export function formatProgressEntry(entry: ProgressEntry): string {
	const lines: string[] = [];

	lines.push(`## ${entry.timestamp} - ${formatEntryType(entry.type)}`);
	lines.push('');

	if (entry.featureId) {
		lines.push(`**Feature:** ${entry.featureId}`);
	}
	if (entry.milestoneId) {
		lines.push(`**Milestone:** ${entry.milestoneId}`);
	}

	lines.push(`**Summary:** ${entry.summary}`);

	// Add details based on entry type
	const { details } = entry;

	if (details.approach) {
		lines.push(`**Approach:** ${details.approach}`);
	}

	if (details.testCommand) {
		const status = entry.type === 'feature_passed' ? '✓' : '✗';
		lines.push(`**Test:** \`${details.testCommand}\` ${status}`);
	}

	if (details.error) {
		lines.push(`**Error:** ${details.error}`);
	}

	if (details.attempt !== undefined) {
		lines.push(`**Attempt:** ${details.attempt}`);
	}

	if (details.filesChanged?.length) {
		lines.push(`**Files Changed:** ${details.filesChanged.join(', ')}`);
	}

	if (details.commits?.length) {
		lines.push(`**Commits:** ${details.commits.join(', ')}`);
	}

	if (details.feedback) {
		lines.push(`**Feedback:** ${details.feedback}`);
	}

	if (details.designDecisions?.length) {
		lines.push('**Design Decisions:**');
		for (const decision of details.designDecisions) {
			lines.push(`  - ${decision}`);
		}
	}

	if (details.optionA && details.optionB) {
		lines.push('**Parallel Exploration:**');
		lines.push(`  - Option A: ${details.optionA.approach} (${details.optionA.passed ? 'passed' : 'failed'})`);
		lines.push(`  - Option B: ${details.optionB.approach} (${details.optionB.passed ? 'passed' : 'failed'})`);
		if (details.winner) {
			lines.push(`  - Winner: Option ${details.winner.toUpperCase()}`);
		}
	}

	if (details.humanAction) {
		lines.push(`**Human Action:** ${details.humanAction}`);
	}

	if (details.humanFeedback) {
		lines.push(`**Human Feedback:** ${details.humanFeedback}`);
	}

	lines.push('');
	lines.push('---');
	lines.push('');

	return lines.join('\n');
}

function formatEntryType(type: ProgressEntry['type']): string {
	const typeLabels: Record<ProgressEntry['type'], string> = {
		initialization: 'Initialization',
		feature_attempt: 'Feature Attempt',
		feature_passed: 'Feature Passed',
		feature_failed: 'Feature Failed',
		review_approved: 'Review Approved',
		review_changes_requested: 'Review: Changes Requested',
		review_escalated: 'Review: Escalated to Human',
		milestone_completed: 'Milestone Completed',
		parallel_exploration: 'Parallel Exploration',
		human_intervention: 'Human Intervention',
		error: 'Error',
	};
	return typeLabels[type] || type;
}

// =============================================================================
// Domain Memory Operations
// =============================================================================

/**
 * Initialize domain memory for a new task.
 */
export async function initializeDomainMemory(paths: DomainMemoryPaths, goals: GoalTree, status: TaskStatus): Promise<void> {
	await ensureDir(paths.baseDir);
	await saveGoals(paths.goalsPath, goals);
	await saveStatus(paths.statusPath, status);

	// Initialize progress.md with header
	const progressHeader = `# Progress Log: ${status.taskId}\n\n`;
	await saveMarkdown(paths.progressPath, progressHeader);
}

/**
 * Check if domain memory exists for a task.
 */
export async function domainMemoryExists(paths: DomainMemoryPaths): Promise<boolean> {
	const [goalsExist, statusExists] = await Promise.all([fileExists(paths.goalsPath), fileExists(paths.statusPath)]);
	return goalsExist && statusExists;
}

/**
 * Load all domain memory files.
 */
export async function loadDomainMemory(paths: DomainMemoryPaths): Promise<{
	goals: GoalTree | null;
	status: TaskStatus | null;
	progress: string | null;
	context: string | null;
}> {
	const [goals, status, progress, context] = await Promise.all([
		loadGoals(paths.goalsPath),
		loadStatus(paths.statusPath),
		loadMarkdown(paths.progressPath),
		loadMarkdown(paths.contextPath),
	]);

	return { goals, status, progress, context };
}

// =============================================================================
// Review Storage Operations
// =============================================================================

/**
 * Initialize review storage for a task.
 */
export async function initializeReviewStorage(paths: ReviewPaths): Promise<void> {
	await ensureDir(paths.baseDir);
}

/**
 * Load feature review history.
 */
export async function loadFeatureReviews<T>(paths: ReviewPaths, featureId: string): Promise<T | null> {
	return loadJson<T>(paths.featureReviewPath(featureId));
}

/**
 * Save feature review history.
 */
export async function saveFeatureReviews<T>(paths: ReviewPaths, featureId: string, reviews: T): Promise<void> {
	await saveJson(paths.featureReviewPath(featureId), reviews);
}

/**
 * Load aggregated design decisions.
 */
export async function loadDesignDecisions<T>(paths: ReviewPaths): Promise<T | null> {
	return loadJson<T>(paths.designDecisionsPath);
}

/**
 * Save aggregated design decisions.
 */
export async function saveDesignDecisions<T>(paths: ReviewPaths, decisions: T): Promise<void> {
	await saveJson(paths.designDecisionsPath, decisions);
}
