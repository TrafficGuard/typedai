/**
 * CLI Checkpoint Review Interface
 *
 * Provides interactive CLI prompts for checkpoint review during agent execution.
 */

import readline from 'node:readline';
import { logger } from '#o11y/logger';
import type { CheckpointDecision, CheckpointProgressSummary, CheckpointReviewRequest, CheckpointReviewResponse } from '#shared/evaluation/checkpoint.model';
import type { CheckpointResult, CriterionResult } from '#shared/evaluation/taskEvaluation.model';
import { beep } from '#utils/beep';

// ANSI color codes for terminal output
const colors = {
	reset: '\x1b[0m',
	bold: '\x1b[1m',
	dim: '\x1b[2m',
	red: '\x1b[31m',
	green: '\x1b[32m',
	yellow: '\x1b[33m',
	blue: '\x1b[34m',
	magenta: '\x1b[35m',
	cyan: '\x1b[36m',
	white: '\x1b[37m',
	bgRed: '\x1b[41m',
	bgGreen: '\x1b[42m',
	bgYellow: '\x1b[43m',
};

/**
 * Formats a duration in milliseconds to human-readable string
 */
function formatDuration(ms: number): string {
	const seconds = Math.floor(ms / 1000);
	const minutes = Math.floor(seconds / 60);
	const hours = Math.floor(minutes / 60);

	if (hours > 0) {
		return `${hours}h ${minutes % 60}m`;
	}
	if (minutes > 0) {
		return `${minutes}m ${seconds % 60}s`;
	}
	return `${seconds}s`;
}

/**
 * Formats cost in USD
 */
function formatCost(cost: number): string {
	return `$${cost.toFixed(4)}`;
}

/**
 * Displays a checkpoint review in the terminal
 */
function displayCheckpointReview(request: CheckpointReviewRequest): void {
	const { checkpoint, result, progressSummary } = request;

	console.log('\n');
	console.log(`${colors.bold}${colors.cyan}════════════════════════════════════════════════════════════════${colors.reset}`);
	console.log(`${colors.bold}${colors.cyan}                    CHECKPOINT REVIEW                           ${colors.reset}`);
	console.log(`${colors.bold}${colors.cyan}════════════════════════════════════════════════════════════════${colors.reset}`);
	console.log();

	// Checkpoint info
	console.log(`${colors.bold}Checkpoint:${colors.reset} ${checkpoint.name}`);
	console.log(`${colors.dim}${checkpoint.description}${colors.reset}`);
	console.log();

	// Status
	const statusColor = result.status === 'passed' ? colors.green : colors.red;
	const statusIcon = result.status === 'passed' ? '✓' : '✗';
	console.log(`${colors.bold}Status:${colors.reset} ${statusColor}${statusIcon} ${result.status.toUpperCase()}${colors.reset}`);
	console.log();

	// Progress summary
	console.log(`${colors.bold}${colors.blue}── Progress Summary ──${colors.reset}`);
	console.log(`  Iterations: ${progressSummary.iterationsCompleted}`);
	console.log(`  Time: ${formatDuration(progressSummary.timeElapsedMs)}`);
	console.log(`  Cost: ${formatCost(progressSummary.costSoFar)}`);
	console.log(`  Files modified: ${progressSummary.filesModified}`);
	console.log(`  Agent state: ${progressSummary.agentState}`);
	if (progressSummary.isStuck) {
		console.log(`  ${colors.yellow}⚠ Agent appears to be stuck${colors.reset}`);
	}
	if (progressSummary.lastError) {
		console.log(`  ${colors.red}Last error: ${progressSummary.lastError.substring(0, 100)}${colors.reset}`);
	}
	console.log();

	// Checkpoints summary
	console.log(`${colors.bold}${colors.blue}── Checkpoints ──${colors.reset}`);
	console.log(`  ${colors.green}✓ Passed: ${progressSummary.checkpointsPassed}${colors.reset}`);
	console.log(`  ${colors.red}✗ Failed: ${progressSummary.checkpointsFailed}${colors.reset}`);
	console.log();

	// Criteria results
	console.log(`${colors.bold}${colors.blue}── Criteria Results ──${colors.reset}`);
	for (const criterion of result.criteriaResults) {
		const icon = criterion.passed ? `${colors.green}✓${colors.reset}` : `${colors.red}✗${colors.reset}`;
		console.log(`  ${icon} ${criterion.name} (${criterion.type})`);
		if (criterion.durationMs) {
			console.log(`    ${colors.dim}Duration: ${criterion.durationMs}ms${colors.reset}`);
		}
		if (!criterion.passed && criterion.output) {
			const outputLines = criterion.output.split('\n').slice(0, 5);
			for (const line of outputLines) {
				console.log(`    ${colors.red}${line}${colors.reset}`);
			}
			if (criterion.output.split('\n').length > 5) {
				console.log(`    ${colors.dim}... (output truncated)${colors.reset}`);
			}
		}
	}
	console.log();

	// Recent progress
	if (progressSummary.recentProgress.length > 0) {
		console.log(`${colors.bold}${colors.blue}── Recent Progress Signals ──${colors.reset}`);
		const progressColors: Record<string, string> = {
			forward: colors.green,
			lateral: colors.yellow,
			backward: colors.red,
			stuck: colors.magenta,
		};
		const signals = progressSummary.recentProgress.map((s) => {
			const color = progressColors[s] || colors.white;
			return `${color}${s}${colors.reset}`;
		});
		console.log(`  ${signals.join(' → ')}`);
		console.log();
	}

	console.log(`${colors.cyan}────────────────────────────────────────────────────────────────${colors.reset}`);
}

/**
 * Displays the decision options
 */
function displayOptions(): void {
	console.log(`${colors.bold}Options:${colors.reset}`);
	console.log(`  ${colors.green}[c]${colors.reset} Continue - Keep running the agent`);
	console.log(`  ${colors.yellow}[a]${colors.reset} Adjust - Continue with new instructions`);
	console.log(`  ${colors.blue}[p]${colors.reset} Pause - Save state and pause for later`);
	console.log(`  ${colors.red}[x]${colors.reset} Abort - Stop execution entirely`);
	console.log();
}

/**
 * Creates a readline interface for user input
 */
function createReadlineInterface(): readline.Interface {
	return readline.createInterface({
		input: process.stdin,
		output: process.stdout,
	});
}

/**
 * Prompts user for a single character input
 */
async function promptChoice(rl: readline.Interface, prompt: string): Promise<string> {
	return new Promise((resolve) => {
		rl.question(prompt, (answer) => {
			resolve(answer.trim().toLowerCase());
		});
	});
}

/**
 * Prompts user for multi-line text input
 */
async function promptText(rl: readline.Interface, prompt: string): Promise<string> {
	console.log(prompt);
	console.log(`${colors.dim}(Enter your instructions, then type 'done' on a new line to finish)${colors.reset}`);

	const lines: string[] = [];

	return new Promise((resolve) => {
		const lineHandler = (line: string) => {
			if (line.toLowerCase() === 'done') {
				rl.removeListener('line', lineHandler);
				resolve(lines.join('\n'));
			} else {
				lines.push(line);
			}
		};
		rl.on('line', lineHandler);
	});
}

/**
 * CLI implementation of checkpoint review
 */
export async function cliCheckpointReview(request: CheckpointReviewRequest): Promise<CheckpointReviewResponse> {
	// Alert user with beeps
	let beepIntervalId: NodeJS.Timeout | undefined;
	try {
		await beep();
		beepIntervalId = setInterval(async () => {
			try {
				await beep();
			} catch (_) {}
		}, 2000);

		// Flush any pending logs
		logger.flush();

		// Display the review
		displayCheckpointReview(request);
		displayOptions();

		const rl = createReadlineInterface();

		try {
			let decision: CheckpointDecision | null = null;
			let instructions: string | undefined;
			let notes: string | undefined;

			while (!decision) {
				const choice = await promptChoice(rl, `${colors.bold}Your choice: ${colors.reset}`);

				switch (choice) {
					case 'c':
					case 'continue':
						decision = 'continue';
						break;

					case 'a':
					case 'adjust':
						instructions = await promptText(rl, `\n${colors.yellow}Enter adjustment instructions:${colors.reset}`);
						decision = 'adjust';
						break;

					case 'p':
					case 'pause':
						decision = 'pause';
						break;

					case 'x':
					case 'abort': {
						const confirm = await promptChoice(rl, `${colors.red}Are you sure you want to abort? (y/n): ${colors.reset}`);
						if (confirm === 'y' || confirm === 'yes') {
							decision = 'abort';
						} else {
							console.log('Abort cancelled.\n');
							displayOptions();
						}
						break;
					}

					case 'n':
					case 'notes':
						notes = await promptText(rl, `\n${colors.blue}Enter notes for this checkpoint:${colors.reset}`);
						console.log('Notes saved. Please choose an action.\n');
						displayOptions();
						break;

					default:
						console.log(`${colors.red}Invalid choice. Please enter c, a, p, or x.${colors.reset}\n`);
						displayOptions();
				}
			}

			console.log(`\n${colors.green}Decision: ${decision}${colors.reset}\n`);

			return {
				decision,
				instructions,
				notes,
				respondedAt: Date.now(),
			};
		} finally {
			rl.close();
		}
	} finally {
		if (beepIntervalId) {
			clearInterval(beepIntervalId);
		}
	}
}

/**
 * Non-interactive checkpoint review (for CI/automated environments)
 */
export function autoCheckpointReview(request: CheckpointReviewRequest, defaultDecision: CheckpointDecision = 'continue'): CheckpointReviewResponse {
	logger.info(
		{
			checkpointId: request.checkpoint.id,
			status: request.result.status,
			decision: defaultDecision,
		},
		'Auto-reviewing checkpoint (non-interactive mode)',
	);

	return {
		decision: defaultDecision,
		respondedAt: Date.now(),
	};
}

/**
 * Factory for creating the appropriate review callback based on environment
 */
export function createCheckpointReviewCallback(
	options: {
		interactive?: boolean;
		defaultDecision?: CheckpointDecision;
	} = {},
): (request: CheckpointReviewRequest) => Promise<CheckpointReviewResponse> {
	const { interactive = process.stdout.isTTY, defaultDecision = 'pause' } = options;

	if (interactive) {
		return cliCheckpointReview;
	}

	return async (request) => autoCheckpointReview(request, defaultDecision);
}
