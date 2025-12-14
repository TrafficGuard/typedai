/**
 * Mocha Configuration
 *
 * Dynamically selects reporter based on TEST_REPORTER environment variable:
 * - Default (unset): failure-only reporter for CI/LLM consumption
 * - TEST_REPORTER=spec: standard spec reporter for local development
 *
 * Usage:
 *   pnpm test                      # Uses failure-only reporter
 *   TEST_REPORTER=spec pnpm test   # Uses standard spec reporter
 */

'use strict';

module.exports = {
	reporter: process.env.TEST_REPORTER || './src/test/failureOnlyReporter.cjs',
};
