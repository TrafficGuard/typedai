/**
 * Test Runner
 *
 * Executes feature test commands and returns verified results.
 * This is the ONLY way to change feature status to 'passing'.
 */

import { spawn } from 'node:child_process';
import type { Feature, TestResult } from './types';

/**
 * Run a feature's test command.
 */
export async function runFeatureTest(feature: Feature, workingDir: string, options: TestRunOptions = {}): Promise<TestResult> {
	const { timeout = 120000, env = {} } = options;
	const startTime = Date.now();

	return new Promise((resolve) => {
		let stdout = '';
		let stderr = '';
		let killed = false;

		const child = spawn('sh', ['-c', feature.testCommand], {
			cwd: workingDir,
			env: { ...process.env, ...env },
			stdio: ['ignore', 'pipe', 'pipe'],
		});

		const timeoutId = setTimeout(() => {
			killed = true;
			child.kill('SIGTERM');
			// Give it a moment to terminate gracefully
			setTimeout(() => {
				if (!child.killed) {
					child.kill('SIGKILL');
				}
			}, 5000);
		}, timeout);

		child.stdout?.on('data', (data) => {
			stdout += data.toString();
		});

		child.stderr?.on('data', (data) => {
			stderr += data.toString();
		});

		child.on('close', (code) => {
			clearTimeout(timeoutId);
			const duration = Date.now() - startTime;

			if (killed) {
				resolve({
					passed: false,
					duration,
					output: stdout,
					error: `Test timed out after ${timeout}ms`,
					exitCode: code ?? -1,
				});
				return;
			}

			const passed = code === 0;
			const output = stdout + (stderr ? `\n\nSTDERR:\n${stderr}` : '');

			resolve({
				passed,
				duration,
				output: truncateOutput(output),
				error: passed ? undefined : extractError(stdout, stderr),
				exitCode: code ?? -1,
			});
		});

		child.on('error', (err) => {
			clearTimeout(timeoutId);
			const duration = Date.now() - startTime;

			resolve({
				passed: false,
				duration,
				output: '',
				error: `Failed to execute test: ${err.message}`,
				exitCode: -1,
			});
		});
	});
}

export interface TestRunOptions {
	/** Timeout in milliseconds (default: 120000 = 2 minutes) */
	timeout?: number;
	/** Additional environment variables */
	env?: Record<string, string>;
}

interface TestRunOptionsWithStop extends TestRunOptions {
	/** Stop running tests after first failure */
	stopOnFirstFailure?: boolean;
}

/**
 * Run multiple feature tests in sequence.
 */
export async function runFeatureTests(features: Feature[], workingDir: string, options: TestRunOptionsWithStop = {}): Promise<Map<string, TestResult>> {
	const results = new Map<string, TestResult>();

	for (const feature of features) {
		const result = await runFeatureTest(feature, workingDir, options);
		results.set(feature.id, result);

		// Stop on first failure if requested
		if (options.stopOnFirstFailure && !result.passed) {
			break;
		}
	}

	return results;
}

/**
 * Run a test command string directly (for regression checking).
 */
export async function runTestCommand(testCommand: string, workingDir: string, options: TestRunOptions = {}): Promise<TestResult> {
	const fakeFeature: Feature = {
		id: 'direct-test',
		description: 'Direct test command',
		testCommand,
		dependsOn: [],
		estimatedComplexity: 'medium',
	};
	return runFeatureTest(fakeFeature, workingDir, options);
}

/**
 * Truncate output to a reasonable length.
 */
function truncateOutput(output: string, maxLength = 10000): string {
	if (output.length <= maxLength) {
		return output;
	}
	const halfLength = Math.floor((maxLength - 50) / 2);
	return `${output.slice(0, halfLength)}\n\n... [output truncated] ...\n\n${output.slice(-halfLength)}`;
}

/**
 * Extract a meaningful error message from test output.
 */
function extractError(stdout: string, stderr: string): string {
	const combined = stderr || stdout;

	// Look for common error patterns
	const patterns = [
		// Jest/Vitest failures
		/FAIL\s+(.+)/m,
		/●\s+(.+)/m,
		/Expected:.+\nReceived:.+/ms,
		// Node.js errors
		/Error:\s+(.+)/m,
		/TypeError:\s+(.+)/m,
		/ReferenceError:\s+(.+)/m,
		// Assertion errors
		/AssertionError:\s+(.+)/m,
		// Exit code errors
		/exited with code (\d+)/m,
		// Generic failure
		/failed/im,
	];

	for (const pattern of patterns) {
		const match = combined.match(pattern);
		if (match) {
			// Return the matched portion plus some context
			const startIndex = Math.max(0, (match.index ?? 0) - 100);
			const endIndex = Math.min(combined.length, (match.index ?? 0) + match[0].length + 200);
			return combined.slice(startIndex, endIndex).trim();
		}
	}

	// Fallback: return last portion of output
	const lastLines = combined.trim().split('\n').slice(-10).join('\n');
	return lastLines || 'Test failed with no error message';
}

/**
 * Parse test output to extract summary statistics.
 */
export function parseTestSummary(output: string): TestSummary | null {
	// Jest/Vitest format: "Tests: 10 passed, 2 failed, 12 total"
	const jestMatch = output.match(/Tests:\s*(\d+)\s*passed,\s*(\d+)\s*failed,\s*(\d+)\s*total/);
	if (jestMatch) {
		return {
			passed: Number.parseInt(jestMatch[1], 10),
			failed: Number.parseInt(jestMatch[2], 10),
			total: Number.parseInt(jestMatch[3], 10),
		};
	}

	// Mocha format: "10 passing, 2 failing"
	const mochaMatch = output.match(/(\d+)\s*passing.*?(\d+)\s*failing/);
	if (mochaMatch) {
		const passed = Number.parseInt(mochaMatch[1], 10);
		const failed = Number.parseInt(mochaMatch[2], 10);
		return {
			passed,
			failed,
			total: passed + failed,
		};
	}

	// pytest format: "10 passed, 2 failed"
	const pytestMatch = output.match(/(\d+)\s*passed.*?(\d+)\s*failed/);
	if (pytestMatch) {
		const passed = Number.parseInt(pytestMatch[1], 10);
		const failed = Number.parseInt(pytestMatch[2], 10);
		return {
			passed,
			failed,
			total: passed + failed,
		};
	}

	return null;
}

export interface TestSummary {
	passed: number;
	failed: number;
	total: number;
}
