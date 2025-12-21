/**
 * LLM-as-Judge Tests for ParallelExplorer
 *
 * Tests the quality of approach comparison and selection using an LLM judge.
 * Evaluates winner selection accuracy, comparison fairness, and reasoning quality.
 *
 * Run with: pnpm test:unit -- --grep "ParallelExplorer LLM Judge"
 */

import { expect } from 'chai';
import type { Feature } from '../../memory/types';
import { type JudgeContext, MINIMUM_PASSING_SCORE, PARALLEL_CRITERIA, evaluateWithJudge, formatJudgeResult } from './judgeFramework';

// =============================================================================
// Test Data
// =============================================================================

// Local mock types for test data (not imported to avoid tight coupling)
interface MockTestResult {
	passed: boolean;
	output: string;
	duration: number;
}

interface ApproachResult {
	id: string;
	name: string;
	summary: string;
	diff: string;
	testResult: MockTestResult;
	linesAdded: number;
	linesRemoved: number;
	filesChanged: number;
}

interface ComparisonScenario {
	feature: Feature;
	approach1: ApproachResult;
	approach2: ApproachResult;
	/** The objectively better approach based on the scenario */
	objectivelyBetter: string;
	/** Why approach is objectively better */
	objectiveReason: string;
}

interface AIComparisonResult {
	winnerId: string;
	reasoning: string;
}

/**
 * Clear winner scenario - Approach A is clearly better.
 */
const CLEAR_WINNER_SCENARIO: ComparisonScenario = {
	feature: {
		id: 'ft-1',
		description: 'Implement user search with filtering and pagination',
		testCommand: 'pnpm test -- --grep "user search"',
		dependsOn: [],
		estimatedComplexity: 'medium',
	},
	approach1: {
		id: 'approach-a',
		name: 'SQL Query Approach',
		summary: 'Uses parameterized SQL queries with proper pagination using OFFSET/LIMIT and database-level filtering.',
		diff: `
+// Efficient database-level filtering and pagination
+async function searchUsers(query: string, filters: SearchFilters, page: number, pageSize: number) {
+  const params: any[] = [];
+  let sql = 'SELECT * FROM users WHERE 1=1';
+
+  if (query) {
+    sql += ' AND (name ILIKE $' + (params.length + 1) + ' OR email ILIKE $' + (params.length + 1) + ')';
+    params.push('%' + query + '%');
+  }
+
+  if (filters.role) {
+    sql += ' AND role = $' + (params.length + 1);
+    params.push(filters.role);
+  }
+
+  sql += ' ORDER BY created_at DESC OFFSET $' + (params.length + 1) + ' LIMIT $' + (params.length + 2);
+  params.push((page - 1) * pageSize, pageSize);
+
+  return db.query(sql, params);
+}
`,
		testResult: { passed: true, output: '12 passing', duration: 150 },
		linesAdded: 25,
		linesRemoved: 0,
		filesChanged: 2,
	},
	approach2: {
		id: 'approach-b',
		name: 'In-Memory Approach',
		summary: 'Fetches all users from database, then filters and paginates in JavaScript.',
		diff: `
+// Fetches all users and filters in memory
+async function searchUsers(query: string, filters: SearchFilters, page: number, pageSize: number) {
+  // Load ALL users into memory
+  const allUsers = await db.query('SELECT * FROM users');
+
+  // Filter in memory
+  let results = allUsers;
+  if (query) {
+    results = results.filter(u =>
+      u.name.toLowerCase().includes(query.toLowerCase()) ||
+      u.email.toLowerCase().includes(query.toLowerCase())
+    );
+  }
+  if (filters.role) {
+    results = results.filter(u => u.role === filters.role);
+  }
+
+  // Paginate in memory
+  const start = (page - 1) * pageSize;
+  return results.slice(start, start + pageSize);
+}
`,
		testResult: { passed: true, output: '12 passing', duration: 890 },
		linesAdded: 22,
		linesRemoved: 0,
		filesChanged: 2,
	},
	objectivelyBetter: 'approach-a',
	objectiveReason: 'SQL approach is more scalable - does filtering/pagination at database level instead of loading all records into memory.',
};

/**
 * Good comparison output - correctly identifies the better approach.
 */
const GOOD_COMPARISON_OUTPUT: AIComparisonResult = {
	winnerId: 'approach-a',
	reasoning: `
I select Approach A (SQL Query Approach) for the following reasons:

**Performance & Scalability:**
- Approach A filters and paginates at the database level, which is O(log n) with proper indexes
- Approach B loads ALL users into memory before filtering, which is O(n) and will not scale
- The test duration reflects this: 150ms vs 890ms even with test data

**Memory Efficiency:**
- Approach A only transfers the requested page of data over the network
- Approach B transfers the entire users table, which could be GBs in production

**Code Quality:**
- Both approaches have similar line counts and are readable
- Approach A uses parameterized queries, which is secure against SQL injection
- Approach A follows the principle of pushing filtering to the data source

**Maintainability:**
- Approach A's pattern is standard and well-understood
- Adding new filters to Approach A requires only SQL modifications
- Approach B would require re-fetching all data for any filter change

The only advantage of Approach B is slightly simpler code, but this doesn't outweigh the severe scalability issues.
`,
};

/**
 * Poor comparison output - selects wrong approach with weak reasoning.
 */
const POOR_COMPARISON_OUTPUT: AIComparisonResult = {
	winnerId: 'approach-b',
	reasoning: 'Both approaches work and pass tests. Approach B has slightly simpler code that is easier to read. Selected Approach B.',
};

/**
 * Close call scenario - both approaches are reasonable.
 */
const CLOSE_CALL_SCENARIO: ComparisonScenario = {
	feature: {
		id: 'ft-2',
		description: 'Add caching for API responses',
		testCommand: 'pnpm test -- --grep "cache"',
		dependsOn: [],
		estimatedComplexity: 'medium',
	},
	approach1: {
		id: 'approach-redis',
		name: 'Redis Cache',
		summary: 'Uses Redis for distributed caching, good for multi-instance deployments.',
		diff: `
+import Redis from 'ioredis';
+const redis = new Redis(process.env.REDIS_URL);
+
+async function getCached<T>(key: string, ttl: number, fetch: () => Promise<T>): Promise<T> {
+  const cached = await redis.get(key);
+  if (cached) return JSON.parse(cached);
+  const data = await fetch();
+  await redis.setex(key, ttl, JSON.stringify(data));
+  return data;
+}
`,
		testResult: { passed: true, output: '8 passing', duration: 200 },
		linesAdded: 15,
		linesRemoved: 0,
		filesChanged: 3,
	},
	approach2: {
		id: 'approach-memory',
		name: 'In-Memory LRU Cache',
		summary: 'Uses in-memory LRU cache, simpler setup, good for single-instance deployments.',
		diff: `
+import LRU from 'lru-cache';
+const cache = new LRU({ max: 500, ttl: 1000 * 60 * 5 });
+
+async function getCached<T>(key: string, ttl: number, fetch: () => Promise<T>): Promise<T> {
+  const cached = cache.get(key) as T | undefined;
+  if (cached) return cached;
+  const data = await fetch();
+  cache.set(key, data, { ttl: ttl * 1000 });
+  return data;
+}
`,
		testResult: { passed: true, output: '8 passing', duration: 50 },
		linesAdded: 12,
		linesRemoved: 0,
		filesChanged: 2,
	},
	objectivelyBetter: 'either', // Both are valid depending on deployment
	objectiveReason: 'Redis is better for distributed, LRU is simpler for single-instance. Selection should depend on deployment context.',
};

// =============================================================================
// Test Helpers
// =============================================================================

function formatScenarioForJudge(scenario: ComparisonScenario): string {
	return `
## Feature
${scenario.feature.description}

## Approach 1: ${scenario.approach1.name}
Summary: ${scenario.approach1.summary}
Test Result: ${scenario.approach1.testResult.passed ? 'PASSED' : 'FAILED'} (${scenario.approach1.testResult.duration}ms)
Changes: +${scenario.approach1.linesAdded} -${scenario.approach1.linesRemoved} in ${scenario.approach1.filesChanged} files

Code:
\`\`\`typescript
${scenario.approach1.diff}
\`\`\`

## Approach 2: ${scenario.approach2.name}
Summary: ${scenario.approach2.summary}
Test Result: ${scenario.approach2.testResult.passed ? 'PASSED' : 'FAILED'} (${scenario.approach2.testResult.duration}ms)
Changes: +${scenario.approach2.linesAdded} -${scenario.approach2.linesRemoved} in ${scenario.approach2.filesChanged} files

Code:
\`\`\`typescript
${scenario.approach2.diff}
\`\`\`
`;
}

function formatComparisonOutputForJudge(output: AIComparisonResult): string {
	return `
## Selected Winner
${output.winnerId}

## Reasoning
${output.reasoning}
`;
}

function createComparisonContext(scenario: ComparisonScenario, output: AIComparisonResult): JudgeContext {
	return {
		input: formatScenarioForJudge(scenario),
		output: formatComparisonOutputForJudge(output),
		additionalContext:
			scenario.objectivelyBetter !== 'either'
				? `Note: Based on objective analysis, ${scenario.objectivelyBetter} is the better choice because: ${scenario.objectiveReason}`
				: `Note: Both approaches are valid for different contexts. ${scenario.objectiveReason}`,
	};
}

// =============================================================================
// Tests
// =============================================================================

describe('ParallelExplorer LLM Judge', function () {
	this.timeout(60000);

	const runLLMTests = process.env.RUN_LLM_JUDGE_TESTS === 'true';

	(runLLMTests ? describe : describe.skip)('Approach Comparison Quality', () => {
		it('evaluates good comparison positively', async () => {
			const context = createComparisonContext(CLEAR_WINNER_SCENARIO, GOOD_COMPARISON_OUTPUT);

			const result = await evaluateWithJudge(PARALLEL_CRITERIA, context);

			console.log('\n--- Good Comparison Output Evaluation ---');
			console.log(formatJudgeResult(result));

			expect(result.score).to.be.at.least(MINIMUM_PASSING_SCORE);
			expect(result.strengths).to.have.length.at.least(1);
		});

		it('evaluates poor comparison negatively', async () => {
			const context = createComparisonContext(CLEAR_WINNER_SCENARIO, POOR_COMPARISON_OUTPUT);

			const result = await evaluateWithJudge(PARALLEL_CRITERIA, context);

			console.log('\n--- Poor Comparison Output Evaluation ---');
			console.log(formatJudgeResult(result));

			expect(result.score).to.be.below(MINIMUM_PASSING_SCORE);
			expect(result.issues).to.have.length.at.least(1);
		});

		it('penalizes incorrect winner selection', async () => {
			const context = createComparisonContext(CLEAR_WINNER_SCENARIO, POOR_COMPARISON_OUTPUT);

			const result = await evaluateWithJudge(PARALLEL_CRITERIA, context);

			// Winner selection accuracy should score very low
			if (result.criterionScores?.['Winner Selection Accuracy']) {
				expect(result.criterionScores['Winner Selection Accuracy']).to.be.below(5);
			}
		});

		it('rewards thorough reasoning', async () => {
			const context = createComparisonContext(CLEAR_WINNER_SCENARIO, GOOD_COMPARISON_OUTPUT);

			const result = await evaluateWithJudge(PARALLEL_CRITERIA, context);

			// Reasoning quality should score high for good comparison
			if (result.criterionScores?.['Reasoning Quality']) {
				expect(result.criterionScores['Reasoning Quality']).to.be.at.least(7);
			}
		});

		it('handles close-call scenarios appropriately', async () => {
			// For close calls, either selection can be valid if reasoning is good
			const validOutput: AIComparisonResult = {
				winnerId: 'approach-memory',
				reasoning: `
For this single-instance deployment, I select the In-Memory LRU Cache approach:

**Simplicity:** No external Redis dependency to manage.
**Performance:** Faster cache access (50ms vs 200ms in tests) since no network hop.
**Operational:** Simpler deployment, no Redis cluster to maintain.

If the application scales to multiple instances in the future, we should migrate to Redis.
The current interface is identical, making migration straightforward.
`,
			};

			const context = createComparisonContext(CLOSE_CALL_SCENARIO, validOutput);

			const result = await evaluateWithJudge(PARALLEL_CRITERIA, context);

			console.log('\n--- Close Call Scenario Evaluation ---');
			console.log(formatJudgeResult(result));

			// Should still pass if reasoning acknowledges trade-offs
			expect(result.score).to.be.at.least(6); // May be slightly below 7 for "either" scenarios
		});
	});

	// Unit tests that don't require LLM
	describe('Judge Framework Integration', () => {
		it('creates proper context from comparison scenario', () => {
			const context = createComparisonContext(CLEAR_WINNER_SCENARIO, GOOD_COMPARISON_OUTPUT);

			expect(context.input).to.include('SQL Query Approach');
			expect(context.input).to.include('In-Memory Approach');
			expect(context.output).to.include('approach-a');
		});

		it('includes objective context when available', () => {
			const context = createComparisonContext(CLEAR_WINNER_SCENARIO, GOOD_COMPARISON_OUTPUT);

			expect(context.additionalContext).to.include('approach-a');
			expect(context.additionalContext).to.include('scalable');
		});

		it('formats code diffs properly', () => {
			const formatted = formatScenarioForJudge(CLEAR_WINNER_SCENARIO);

			expect(formatted).to.include('```typescript');
			expect(formatted).to.include('searchUsers');
			expect(formatted).to.include('PASSED');
		});
	});
});

// =============================================================================
// Evaluation Criteria Documentation Tests
// =============================================================================

describe('Parallel Criteria Definitions', () => {
	it('has all required criteria', () => {
		const criterionNames = PARALLEL_CRITERIA.map((c) => c.name);

		expect(criterionNames).to.include('Winner Selection Accuracy');
		expect(criterionNames).to.include('Comparison Fairness');
		expect(criterionNames).to.include('Reasoning Quality');
	});

	it('has valid weights (1-5)', () => {
		for (const criterion of PARALLEL_CRITERIA) {
			expect(criterion.weight).to.be.at.least(1);
			expect(criterion.weight).to.be.at.most(5);
		}
	});

	it('winner selection has highest weight', () => {
		const selectionCriterion = PARALLEL_CRITERIA.find((c) => c.name === 'Winner Selection Accuracy');
		const maxWeight = Math.max(...PARALLEL_CRITERIA.map((c) => c.weight));

		expect(selectionCriterion?.weight).to.equal(maxWeight);
	});

	it('total weight is reasonable', () => {
		const totalWeight = PARALLEL_CRITERIA.reduce((sum, c) => sum + c.weight, 0);
		// As specified in plan: Total: 7
		expect(totalWeight).to.equal(7);
	});
});
