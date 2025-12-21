/**
 * LLM-as-Judge Tests for WorkerAgent
 *
 * Tests the quality of feature implementation using an LLM judge.
 * Evaluates test passes, code quality, design decision adherence, and commit clarity.
 *
 * Run with: pnpm test:unit -- --grep "WorkerAgent LLM Judge"
 */

import { expect } from 'chai';
import type { Feature } from '../../memory/types';
import { type JudgeContext, MINIMUM_PASSING_SCORE, WORKER_CRITERIA, evaluateWithJudge, formatJudgeResult } from './judgeFramework';

// =============================================================================
// Test Data
// =============================================================================

// Local mock types for test data (not imported to avoid tight coupling)
interface MockTestResult {
	passed: boolean;
	output: string;
	duration: number;
}

interface WorkerOutput {
	feature: Feature;
	testResult: MockTestResult;
	filesChanged: string[];
	commits: string[];
	codeDiff?: string;
}

/**
 * Example good worker output for testing.
 */
const GOOD_WORKER_OUTPUT: WorkerOutput = {
	feature: {
		id: 'ms-1-st-1-ft-1',
		description: 'Create JWT utility module with sign and verify functions',
		testCommand: 'pnpm test:unit -- --grep "JWT utility"',
		dependsOn: [],
		estimatedComplexity: 'medium',
	},
	testResult: {
		passed: true,
		output: `
  JWT utility
    ✓ signs token with valid payload
    ✓ verifies valid token
    ✓ rejects expired token
    ✓ rejects tampered token
    ✓ handles invalid secret

  5 passing (42ms)
`,
		duration: 42,
	},
	filesChanged: ['src/auth/jwt.ts', 'src/auth/jwt.test.ts', 'src/auth/types.ts'],
	commits: ['feat(auth): add JWT utility module with sign and verify functions'],
	codeDiff: `
diff --git a/src/auth/jwt.ts b/src/auth/jwt.ts
new file mode 100644
--- /dev/null
+++ b/src/auth/jwt.ts
@@ -0,0 +1,45 @@
+import jwt from 'jsonwebtoken';
+import type { TokenPayload, JWTConfig } from './types';
+
+const DEFAULT_EXPIRY = '1h';
+
+/**
+ * Sign a JWT token with the given payload.
+ */
+export function signToken(
+  payload: TokenPayload,
+  secret: string,
+  options: { expiresIn?: string } = {}
+): string {
+  return jwt.sign(payload, secret, {
+    expiresIn: options.expiresIn || DEFAULT_EXPIRY,
+  });
+}
+
+/**
+ * Verify and decode a JWT token.
+ * @throws {JsonWebTokenError} if token is invalid
+ * @throws {TokenExpiredError} if token has expired
+ */
+export function verifyToken<T extends TokenPayload>(
+  token: string,
+  secret: string
+): T {
+  return jwt.verify(token, secret) as T;
+}
+
+/**
+ * Decode a token without verification (for debugging).
+ */
+export function decodeToken<T extends TokenPayload>(token: string): T | null {
+  return jwt.decode(token) as T | null;
+}
`,
};

/**
 * Example poor worker output for testing.
 */
const POOR_WORKER_OUTPUT: WorkerOutput = {
	feature: {
		id: 'ms-1-st-1-ft-1',
		description: 'Create JWT utility module with sign and verify functions',
		testCommand: 'pnpm test:unit -- --grep "JWT utility"',
		dependsOn: [],
		estimatedComplexity: 'medium',
	},
	testResult: {
		passed: false,
		output: `
  JWT utility
    ✓ signs token
    1) verifies token
    2) handles errors

  1 passing (12ms)
  2 failing

  1) JWT utility
       verifies token:
     Error: jwt malformed
      at verify (node_modules/jsonwebtoken/verify.js:123)

  2) JWT utility
       handles errors:
     AssertionError: expected undefined to equal 'TokenExpiredError'
`,
		duration: 12,
	},
	filesChanged: ['src/jwt.js'],
	commits: ['wip'], // Bad commit message
	codeDiff: `
diff --git a/src/jwt.js b/src/jwt.js
new file mode 100644
--- /dev/null
+++ b/src/jwt.js
@@ -0,0 +1,15 @@
+// jwt stuff
+const jwt = require('jsonwebtoken');
+
+function sign(data) {
+  return jwt.sign(data, 'secret123'); // Hardcoded secret!
+}
+
+function verify(token) {
+  return jwt.verify(token, 'secret123');
+}
+
+module.exports = { sign, verify };
`,
};

// =============================================================================
// Test Helpers
// =============================================================================

function formatWorkerOutputForJudge(output: WorkerOutput): string {
	return `
## Feature
${JSON.stringify(output.feature, null, 2)}

## Test Result
Passed: ${output.testResult.passed}
Duration: ${output.testResult.duration}ms
Output:
\`\`\`
${output.testResult.output}
\`\`\`

## Files Changed
${output.filesChanged.join('\n')}

## Commits
${output.commits.join('\n')}

## Code Diff
\`\`\`diff
${output.codeDiff || 'No diff available'}
\`\`\`
`;
}

function createWorkerContext(output: WorkerOutput, designDecisions?: string[]): JudgeContext {
	return {
		input: `Implement feature: ${output.feature.description}
Test command: ${output.feature.testCommand}`,
		output: formatWorkerOutputForJudge(output),
		additionalContext: designDecisions ? `Design decisions to follow:\n${designDecisions.map((d) => `- ${d}`).join('\n')}` : undefined,
	};
}

// =============================================================================
// Tests
// =============================================================================

describe('WorkerAgent LLM Judge', function () {
	this.timeout(60000);

	const runLLMTests = process.env.RUN_LLM_JUDGE_TESTS === 'true';

	(runLLMTests ? describe : describe.skip)('Implementation Quality', () => {
		it('evaluates good implementation positively', async () => {
			const context = createWorkerContext(GOOD_WORKER_OUTPUT);

			const result = await evaluateWithJudge(WORKER_CRITERIA, context);

			console.log('\n--- Good Worker Output Evaluation ---');
			console.log(formatJudgeResult(result));

			expect(result.score).to.be.at.least(MINIMUM_PASSING_SCORE);
			expect(result.strengths).to.have.length.at.least(1);
		});

		it('evaluates poor implementation negatively', async () => {
			const context = createWorkerContext(POOR_WORKER_OUTPUT);

			const result = await evaluateWithJudge(WORKER_CRITERIA, context);

			console.log('\n--- Poor Worker Output Evaluation ---');
			console.log(formatJudgeResult(result));

			expect(result.score).to.be.below(MINIMUM_PASSING_SCORE);
			expect(result.issues).to.have.length.at.least(1);
		});

		it('penalizes failing tests heavily', async () => {
			const context = createWorkerContext(POOR_WORKER_OUTPUT);

			const result = await evaluateWithJudge(WORKER_CRITERIA, context);

			// Test passes has highest weight (4), should score very low
			if (result.criterionScores?.['Test Passes']) {
				expect(result.criterionScores['Test Passes']).to.be.below(5);
			}
		});

		it('checks adherence to design decisions', async () => {
			const designDecisions = ['Use TypeScript for all new files', 'Follow functional programming patterns', 'Never hardcode secrets'];

			const context = createWorkerContext(POOR_WORKER_OUTPUT, designDecisions);

			const result = await evaluateWithJudge(WORKER_CRITERIA, context);

			console.log('\n--- Design Decision Adherence ---');
			console.log(formatJudgeResult(result));

			// Should score low on design decision adherence (uses JS, has hardcoded secret)
			if (result.criterionScores?.['Follows Design Decisions']) {
				expect(result.criterionScores['Follows Design Decisions']).to.be.below(5);
			}
		});
	});

	// Unit tests that don't require LLM
	describe('Judge Framework Integration', () => {
		it('creates proper context from worker output', () => {
			const context = createWorkerContext(GOOD_WORKER_OUTPUT);

			expect(context.input).to.include('JWT utility module');
			expect(context.output).to.include('5 passing');
			expect(context.output).to.include('feat(auth)');
		});

		it('includes design decisions in context when provided', () => {
			const context = createWorkerContext(GOOD_WORKER_OUTPUT, ['Use TypeScript', 'Write tests first']);

			expect(context.additionalContext).to.include('Use TypeScript');
			expect(context.additionalContext).to.include('Write tests first');
		});

		it('formats code diff properly', () => {
			const formatted = formatWorkerOutputForJudge(GOOD_WORKER_OUTPUT);

			expect(formatted).to.include('```diff');
			expect(formatted).to.include('signToken');
			expect(formatted).to.include('verifyToken');
		});
	});
});

// =============================================================================
// Evaluation Criteria Documentation Tests
// =============================================================================

describe('Worker Criteria Definitions', () => {
	it('has all required criteria', () => {
		const criterionNames = WORKER_CRITERIA.map((c) => c.name);

		expect(criterionNames).to.include('Test Passes');
		expect(criterionNames).to.include('Code Quality');
		expect(criterionNames).to.include('Follows Design Decisions');
		expect(criterionNames).to.include('Commit Clarity');
	});

	it('has valid weights (1-5)', () => {
		for (const criterion of WORKER_CRITERIA) {
			expect(criterion.weight).to.be.at.least(1);
			expect(criterion.weight).to.be.at.most(5);
		}
	});

	it('test passes has highest weight', () => {
		const testPassesCriterion = WORKER_CRITERIA.find((c) => c.name === 'Test Passes');
		const maxWeight = Math.max(...WORKER_CRITERIA.map((c) => c.weight));

		expect(testPassesCriterion?.weight).to.equal(maxWeight);
	});

	it('total weight is reasonable', () => {
		const totalWeight = WORKER_CRITERIA.reduce((sum, c) => sum + c.weight, 0);
		// As specified in plan: Total: 9
		expect(totalWeight).to.equal(9);
	});
});
