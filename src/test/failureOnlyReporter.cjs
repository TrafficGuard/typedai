/**
 * Failure-Only Mocha Reporter
 *
 * A custom Mocha reporter optimized for LLM consumption that:
 * - Only outputs when tests fail (no "✔ passed" lines)
 * - Includes error message, stack trace, and captured logs
 * - Produces clean, token-efficient plain text output
 *
 * Usage:
 *   mocha --reporter ./src/test/failureOnlyReporter.cjs
 *
 * For local development with full output:
 *   TEST_REPORTER=spec mocha ...
 */

'use strict';

const Mocha = require('mocha');
const { EVENT_RUN_END, EVENT_TEST_FAIL, EVENT_SUITE_BEGIN } = Mocha.Runner.constants;

const Base = Mocha.reporters.Base;
const color = Base.color;

/**
 * Constructs the full title path for a test (suite > subsuite > test name)
 */
function getFullTitle(test) {
	const titles = [];
	let current = test;
	while (current) {
		if (current.title) {
			titles.unshift(current.title);
		}
		current = current.parent;
	}
	return titles.join(' > ');
}

/**
 * Formats captured logs for output
 */
function formatLogs(logs) {
	if (!logs || logs.length === 0) {
		return '';
	}

	const lines = logs.map((log) => {
		const level = (log.level || 'LOG').toUpperCase();
		// Handle various argument formats
		const args = log.args || [];
		const message = args
			.map((arg) => {
				if (typeof arg === 'string') return arg;
				if (arg instanceof Error) return arg.message;
				try {
					return JSON.stringify(arg);
				} catch {
					return String(arg);
				}
			})
			.join(' ');
		return `    [${level}] ${message}`;
	});

	return `\n  Logs:\n${lines.join('\n')}`;
}

/**
 * Cleans up stack trace for readability
 */
function formatStack(stack) {
	if (!stack) return '';

	// Get first few lines of stack (skip internal mocha/node lines)
	const lines = stack.split('\n');
	const relevantLines = lines
		.slice(0, 6) // First 6 lines usually sufficient
		.filter((line) => !line.includes('node_modules/mocha'))
		.filter((line) => !line.includes('node:internal'));

	return relevantLines.join('\n');
}

/**
 * FailureOnly Reporter
 */
function FailureOnlyReporter(runner, options) {
	Base.call(this, runner, options);
	const failures = [];

	runner.on(EVENT_TEST_FAIL, (test, err) => {
		failures.push({ test, err });
	});

	runner.once(EVENT_RUN_END, () => {
		const stats = runner.stats;

		// Output failures
		if (failures.length > 0) {
			failures.forEach(({ test, err }, index) => {
				const fullTitle = getFullTitle(test);
				const capturedLogs = test.capturedLogs || [];

				console.log(`\nFAILED: ${fullTitle}`);
				console.log(`  Error: ${err.message}`);

				if (err.stack) {
					const stackLines = formatStack(err.stack)
						.split('\n')
						.slice(1) // Skip the error message line
						.map((line) => `  ${line.trim()}`)
						.join('\n');
					if (stackLines.trim()) {
						console.log(stackLines);
					}
				}

				const logsOutput = formatLogs(capturedLogs);
				if (logsOutput) {
					console.log(logsOutput);
				}
			});
			console.log('\n---');
		}

		// Summary line
		const total = stats.tests;
		const passed = stats.passes;
		const failed = stats.failures;
		const pending = stats.pending;

		let summary = `Summary: ${passed}/${total} passed`;
		if (failed > 0) {
			summary += `, ${failed} failed`;
		}
		if (pending > 0) {
			summary += `, ${pending} pending`;
		}
		console.log(summary);

		// Exit with appropriate code
		process.exitCode = failed > 0 ? 1 : 0;
	});
}

// Inherit from Base
FailureOnlyReporter.prototype = Object.create(Base.prototype);
FailureOnlyReporter.prototype.constructor = FailureOnlyReporter;

// Export the reporter
module.exports = FailureOnlyReporter;
