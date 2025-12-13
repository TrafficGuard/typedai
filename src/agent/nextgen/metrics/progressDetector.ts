/**
 * Progress Detection for NextGen Agent
 *
 * Calculates progress signals and detects when agent is stuck in loops.
 */

import type { AutonomousIteration, DecisionType, ProgressSignal } from '#shared/agent/agent.model';
import type { FunctionCallResult } from '#shared/llm/llm.model';

/**
 * Result of loop detection analysis
 */
export interface LoopDetectionResult {
	/** Whether a loop pattern was detected */
	isLooping: boolean;
	/** Confidence in the detection (0-1) */
	confidence: number;
	/** Description of the detected pattern */
	pattern?: string;
	/** Number of iterations in the potential loop */
	loopLength?: number;
	/** Suggested action to break the loop */
	suggestion?: string;
}

/**
 * Configuration for progress detection
 */
export interface ProgressDetectorConfig {
	/** Number of recent iterations to consider for loop detection */
	lookbackWindow: number;
	/** Similarity threshold above which iterations are considered similar (0-1) */
	similarityThreshold: number;
	/** Minimum consecutive similar iterations to consider as loop */
	minLoopLength: number;
}

const DEFAULT_CONFIG: ProgressDetectorConfig = {
	lookbackWindow: 5,
	similarityThreshold: 0.85,
	minLoopLength: 3,
};

/**
 * Calculates the progress signal for an iteration based on current and previous state
 */
export function calculateProgressSignal(
	current: Partial<AutonomousIteration>,
	previous?: Partial<AutonomousIteration>,
): { signal: ProgressSignal; confidence: number } {
	if (!previous) {
		// First iteration - assume forward progress
		return { signal: 'forward', confidence: 0.5 };
	}

	const forwardSignals: boolean[] = [];
	const backwardSignals: boolean[] = [];
	const stuckSignals: boolean[] = [];

	// Forward indicators
	if ((current.filesModified ?? 0) > 0) {
		forwardSignals.push(true);
	}
	if ((current.testsPassed ?? 0) > (previous.testsPassed ?? 0)) {
		forwardSignals.push(true);
	}
	if ((current.linesAdded ?? 0) > (current.linesRemoved ?? 0)) {
		forwardSignals.push(true);
	}
	if (!current.error && previous.error) {
		// Error was resolved
		forwardSignals.push(true);
	}
	if (current.compileSuccess && !previous.compileSuccess) {
		forwardSignals.push(true);
	}

	// Backward indicators
	if ((current.testsPassed ?? 0) < (previous.testsPassed ?? 0)) {
		backwardSignals.push(true);
	}
	if (current.error && !previous.error) {
		// New error introduced
		backwardSignals.push(true);
	}
	if (!current.compileSuccess && previous.compileSuccess) {
		backwardSignals.push(true);
	}

	// Stuck indicators
	if ((current.similarityToPrevious ?? 0) > 0.85) {
		stuckSignals.push(true);
	}
	if ((current.filesModified ?? 0) === 0 && (current.filesRead ?? 0) > 3) {
		// Reading lots but not changing anything
		stuckSignals.push(true);
	}
	if ((current.repeatedPatternCount ?? 0) >= 3) {
		stuckSignals.push(true);
	}

	const forwardScore = forwardSignals.length;
	const backwardScore = backwardSignals.length;
	const stuckScore = stuckSignals.length;

	// Determine signal based on scores
	if (stuckScore >= 2) {
		return { signal: 'stuck', confidence: Math.min(1, stuckScore * 0.4) };
	}
	if (backwardScore > forwardScore) {
		return { signal: 'backward', confidence: Math.min(1, backwardScore * 0.3) };
	}
	if (forwardScore >= 2) {
		return { signal: 'forward', confidence: Math.min(1, forwardScore * 0.25) };
	}
	return { signal: 'lateral', confidence: 0.5 };
}

/**
 * Computes a fingerprint of an iteration based on its actions
 */
export function computeActionFingerprint(iteration: Partial<AutonomousIteration>): string {
	const parts: string[] = [];

	// Include function call names
	if (iteration.functionCalls) {
		const funcNames = iteration.functionCalls.map((fc) => fc.function_name).sort();
		parts.push(`funcs:${funcNames.join(',')}`);
	}

	// Include key plan elements (simplified hash)
	if (iteration.agentPlan) {
		const planHash = simpleHash(iteration.agentPlan.slice(0, 500));
		parts.push(`plan:${planHash}`);
	}

	// Include decision type if available
	if (iteration.decisionType) {
		parts.push(`decision:${iteration.decisionType}`);
	}

	return parts.join('|');
}

/**
 * Calculates semantic similarity between two iterations (simplified)
 */
export function calculateIterationSimilarity(current: Partial<AutonomousIteration>, previous: Partial<AutonomousIteration>): number {
	let similarity = 0;
	let comparisons = 0;

	// Compare action fingerprints
	const currentFingerprint = computeActionFingerprint(current);
	const previousFingerprint = computeActionFingerprint(previous);
	if (currentFingerprint === previousFingerprint) {
		similarity += 1;
	} else {
		// Partial match based on common elements
		const currentParts = new Set(currentFingerprint.split('|'));
		const previousParts = new Set(previousFingerprint.split('|'));
		const intersection = [...currentParts].filter((x) => previousParts.has(x));
		similarity += intersection.length / Math.max(currentParts.size, previousParts.size);
	}
	comparisons++;

	// Compare function call patterns
	if (current.functionCalls && previous.functionCalls) {
		const currentFuncs = new Set(current.functionCalls.map((fc) => fc.function_name));
		const previousFuncs = new Set(previous.functionCalls.map((fc) => fc.function_name));
		const funcIntersection = [...currentFuncs].filter((x) => previousFuncs.has(x));
		const funcUnion = new Set([...currentFuncs, ...previousFuncs]);
		similarity += funcIntersection.length / funcUnion.size;
		comparisons++;
	}

	// Compare error patterns
	if (current.error && previous.error) {
		// Both have errors - check if same error
		const currentErrorPrefix = current.error.slice(0, 100);
		const previousErrorPrefix = previous.error.slice(0, 100);
		if (currentErrorPrefix === previousErrorPrefix) {
			similarity += 1;
		}
		comparisons++;
	} else if (!current.error && !previous.error) {
		// Neither has errors - slight similarity
		similarity += 0.5;
		comparisons++;
	}

	return comparisons > 0 ? similarity / comparisons : 0;
}

/**
 * Detects if the agent is stuck in a loop pattern
 */
export function detectLoop(recentIterations: Partial<AutonomousIteration>[], config: ProgressDetectorConfig = DEFAULT_CONFIG): LoopDetectionResult {
	if (recentIterations.length < 2) {
		return { isLooping: false, confidence: 0 };
	}

	const recent = recentIterations.slice(-config.lookbackWindow);

	// Calculate fingerprints
	const fingerprints = recent.map((i) => computeActionFingerprint(i));
	const uniqueFingerprints = new Set(fingerprints).size;
	const repetitionRatio = 1 - uniqueFingerprints / fingerprints.length;

	// Calculate average similarity between consecutive iterations
	let totalSimilarity = 0;
	for (let i = 1; i < recent.length; i++) {
		totalSimilarity += calculateIterationSimilarity(recent[i], recent[i - 1]);
	}
	const avgSimilarity = totalSimilarity / (recent.length - 1);

	// Check for recurring error patterns
	const errors = recent.filter((i) => i.error).map((i) => i.error!.slice(0, 100));
	const uniqueErrors = new Set(errors).size;
	const errorRepetition = errors.length > 1 ? 1 - uniqueErrors / errors.length : 0;

	// Combined loop score
	const loopScore = repetitionRatio * 0.4 + avgSimilarity * 0.4 + errorRepetition * 0.2;

	const isLooping = loopScore > 0.7;

	let pattern: string | undefined;
	let suggestion: string | undefined;

	if (isLooping) {
		if (errorRepetition > 0.5) {
			pattern = 'Recurring error pattern detected';
			suggestion = 'Try a different approach to resolve the error, or request human assistance';
		} else if (repetitionRatio > 0.7) {
			pattern = 'Repeated action sequence detected';
			suggestion = 'Break the pattern by trying an alternative strategy or gathering more information';
		} else {
			pattern = 'High similarity between recent iterations';
			suggestion = 'Consider stepping back to reassess the approach';
		}
	}

	return {
		isLooping,
		confidence: loopScore,
		pattern,
		loopLength: isLooping ? findLoopLength(fingerprints) : undefined,
		suggestion,
	};
}

/**
 * Infers the decision type from iteration content
 */
export function inferDecisionType(iteration: Partial<AutonomousIteration>): DecisionType {
	const functionCalls = iteration.functionCalls || [];
	const funcNames = functionCalls.map((fc) => fc.function_name.toLowerCase());

	// Check for exploration (reading, searching)
	const explorePatterns = ['read', 'search', 'find', 'grep', 'list', 'get'];
	const exploreCount = funcNames.filter((fn) => explorePatterns.some((p) => fn.includes(p))).length;

	// Check for implementation (writing, creating)
	const implementPatterns = ['write', 'create', 'edit', 'update', 'add'];
	const implementCount = funcNames.filter((fn) => implementPatterns.some((p) => fn.includes(p))).length;

	// Check for verification (testing, checking)
	const verifyPatterns = ['test', 'check', 'verify', 'validate', 'assert'];
	const verifyCount = funcNames.filter((fn) => verifyPatterns.some((p) => fn.includes(p))).length;

	// Check for fixing (based on error presence)
	if (iteration.error || iteration.agentPlan?.toLowerCase().includes('fix')) {
		return 'fix';
	}

	// Determine based on counts
	const maxCount = Math.max(exploreCount, implementCount, verifyCount);
	if (maxCount === 0) {
		return 'other';
	}

	if (exploreCount === maxCount) return 'explore';
	if (implementCount === maxCount) return 'implement';
	if (verifyCount === maxCount) return 'verify';

	return 'other';
}

/**
 * Counts file operations from function calls
 */
export function countFileOperations(functionCalls: FunctionCallResult[]): {
	filesRead: number;
	filesModified: number;
	linesAdded: number;
	linesRemoved: number;
} {
	let filesRead = 0;
	let filesModified = 0;
	let linesAdded = 0;
	let linesRemoved = 0;

	for (const fc of functionCalls) {
		const funcName = fc.function_name.toLowerCase();

		// Count file reads
		if (funcName.includes('read') || funcName.includes('get') || funcName.includes('load')) {
			filesRead++;
		}

		// Count file modifications
		if (funcName.includes('write') || funcName.includes('edit') || funcName.includes('create') || funcName.includes('update')) {
			filesModified++;

			// Estimate lines from stdout if available
			if (fc.stdout) {
				const addMatch = fc.stdout.match(/(\d+) insertion/);
				const removeMatch = fc.stdout.match(/(\d+) deletion/);
				if (addMatch) linesAdded += Number.parseInt(addMatch[1], 10);
				if (removeMatch) linesRemoved += Number.parseInt(removeMatch[1], 10);
			}
		}
	}

	return { filesRead, filesModified, linesAdded, linesRemoved };
}

// Helper functions

function simpleHash(str: string): string {
	let hash = 0;
	for (let i = 0; i < str.length; i++) {
		const char = str.charCodeAt(i);
		hash = (hash << 5) - hash + char;
		hash = hash & hash; // Convert to 32bit integer
	}
	return Math.abs(hash).toString(16).slice(0, 8);
}

function findLoopLength(fingerprints: string[]): number {
	// Find the shortest repeating pattern
	for (let len = 1; len <= fingerprints.length / 2; len++) {
		let isPattern = true;
		for (let i = len; i < fingerprints.length; i++) {
			if (fingerprints[i] !== fingerprints[i % len]) {
				isPattern = false;
				break;
			}
		}
		if (isPattern) return len;
	}
	return fingerprints.length;
}
