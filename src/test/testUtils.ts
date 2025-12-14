import sinon from 'sinon';
import { logger } from '#o11y/logger';

/**
 * Sets up Sinon stubs for the global logger to capture log messages during tests.
 * Only outputs the captured logs to the console if the test fails.
 *
 * Call this function once within the top-level describe block of your test suite.
 */
export function setupConditionalLoggerOutput(): void {
	let capturedLogs: { level: string; args: any[] }[] = [];
	let loggerStubs: sinon.SinonStub[] = [];

	beforeEach(() => {
		// Use 'function' notation to access Mocha's 'this.currentTest'
		capturedLogs = []; // Reset logs for the new test

		// Stub logger methods and capture calls
		// Ensure all relevant logger methods are stubbed
		const methodsToStub: (keyof typeof logger)[] = ['info', 'warn', 'error', 'debug', 'trace', 'fatal'];

		loggerStubs = methodsToStub
			.filter((method) => typeof logger[method] === 'function')
			.map((method) => {
				return sinon.stub(logger, method).callsFake((...args: any[]) => {
					capturedLogs.push({ level: method as string, args });
				});
			});
	});

	afterEach(function () {
		// Use 'function' notation to access Mocha's 'this.currentTest'

		// Restore the stubs FIRST, so console output works normally below
		loggerStubs.forEach((stub) => stub.restore());
		loggerStubs = []; // Clear the references

		// Check if the test failed
		if (this.currentTest?.state === 'failed') {
			// Attach logs to test object for custom reporter to access
			(this.currentTest as any).capturedLogs = [...capturedLogs];

			// If using spec reporter (or any reporter set via TEST_REPORTER),
			// also output to console for backward compatibility
			if (process.env.TEST_REPORTER) {
				console.error(`\n--- Logs captured from failed test: "${this.currentTest.title}" ---`);
				capturedLogs.forEach((log) => {
					// Attempt to use the corresponding console method, default to console.log
					// Map logger levels to console methods if necessary (e.g., trace/fatal might map to log/error)
					let consoleMethod: (...data: any[]) => void;
					switch (log.level) {
						case 'warn':
							consoleMethod = console.warn;
							break;
						case 'error':
						case 'fatal':
							consoleMethod = console.error;
							break;
						case 'debug':
							consoleMethod = console.debug;
							break;
						default:
							consoleMethod = console.log;
					}
					// Output level and arguments
					consoleMethod(`[LOGGER ${log.level.toUpperCase()}]`, ...log.args);
				});
				console.error(`--- End of logs for: "${this.currentTest.title}" ---\n`);
			}
		}
		capturedLogs = []; // Clear logs whether passed or failed
	});
}
