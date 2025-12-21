/**
 * Unit Tests for memory/progress.ts
 *
 * Tests the append-only audit log for progress tracking.
 */

import { expect } from 'chai';
import { countFeatureAttempts, getFeatureProgress, parseRecentProgress } from '../../memory/progress';
import { formatProgressEntry } from '../../memory/store';
import type { ProgressEntry } from '../../memory/types';

describe('memory/progress', () => {
	// =============================================================================
	// formatProgressEntry Tests
	// =============================================================================

	describe('formatProgressEntry', () => {
		it('formats a basic progress entry', () => {
			const entry: ProgressEntry = {
				timestamp: '2024-01-15T10:00:00.000Z',
				type: 'feature_attempt',
				featureId: 'ft-1',
				summary: 'Starting work on feature',
				details: {},
			};

			const result = formatProgressEntry(entry);

			expect(result).to.include('## 2024-01-15T10:00:00.000Z - Feature Attempt');
			expect(result).to.include('**Feature:** ft-1');
			expect(result).to.include('**Summary:** Starting work on feature');
		});

		it('formats initialization entry', () => {
			const entry: ProgressEntry = {
				timestamp: '2024-01-15T10:00:00.000Z',
				type: 'initialization',
				summary: 'Task initialized with 3 milestones',
				details: {
					approach: 'Goal tree created for: Add auth',
				},
			};

			const result = formatProgressEntry(entry);

			expect(result).to.include('## 2024-01-15T10:00:00.000Z - Initialization');
			expect(result).to.include('**Summary:** Task initialized with 3 milestones');
			expect(result).to.include('**Approach:** Goal tree created for: Add auth');
		});

		it('formats feature passed entry with files and commits', () => {
			const entry: ProgressEntry = {
				timestamp: '2024-01-15T11:00:00.000Z',
				type: 'feature_passed',
				featureId: 'ft-1',
				summary: 'Tests passed for feature',
				details: {
					testCommand: 'pnpm test -- --grep "ft-1"',
					filesChanged: ['src/auth.ts', 'src/auth.test.ts'],
					commits: ['abc123', 'def456'],
				},
			};

			const result = formatProgressEntry(entry);

			expect(result).to.include('## 2024-01-15T11:00:00.000Z - Feature Passed');
			expect(result).to.include('**Feature:** ft-1');
			expect(result).to.include('**Test:** `pnpm test -- --grep "ft-1"` ✓');
			expect(result).to.include('**Files Changed:** src/auth.ts, src/auth.test.ts');
			expect(result).to.include('**Commits:** abc123, def456');
		});

		it('formats feature failed entry with error', () => {
			const entry: ProgressEntry = {
				timestamp: '2024-01-15T11:30:00.000Z',
				type: 'feature_failed',
				featureId: 'ft-2',
				summary: 'Tests failed for feature',
				details: {
					testCommand: 'pnpm test -- --grep "ft-2"',
					error: 'Expected 1 to equal 2',
					attempt: 2,
				},
			};

			const result = formatProgressEntry(entry);

			expect(result).to.include('## 2024-01-15T11:30:00.000Z - Feature Failed');
			expect(result).to.include('**Test:** `pnpm test -- --grep "ft-2"` ✗');
			expect(result).to.include('**Error:** Expected 1 to equal 2');
			expect(result).to.include('**Attempt:** 2');
		});

		it('formats review approved entry', () => {
			const entry: ProgressEntry = {
				timestamp: '2024-01-15T12:00:00.000Z',
				type: 'review_approved',
				featureId: 'ft-1',
				summary: 'Feature approved by review agent',
				details: {
					feedback: 'LGTM! Clean implementation.',
				},
			};

			const result = formatProgressEntry(entry);

			expect(result).to.include('Review Approved');
			expect(result).to.include('**Feedback:** LGTM! Clean implementation.');
		});

		it('formats review changes requested entry with design decisions', () => {
			const entry: ProgressEntry = {
				timestamp: '2024-01-15T12:30:00.000Z',
				type: 'review_changes_requested',
				featureId: 'ft-1',
				summary: 'Review agent requested changes',
				details: {
					feedback: 'Please add error handling',
					designDecisions: ['Use try-catch blocks', 'Log errors to console'],
				},
			};

			const result = formatProgressEntry(entry);

			expect(result).to.include('Review: Changes Requested');
			expect(result).to.include('**Feedback:** Please add error handling');
			expect(result).to.include('**Design Decisions:**');
			expect(result).to.include('- Use try-catch blocks');
			expect(result).to.include('- Log errors to console');
		});

		it('formats review escalated entry', () => {
			const entry: ProgressEntry = {
				timestamp: '2024-01-15T13:00:00.000Z',
				type: 'review_escalated',
				featureId: 'ft-1',
				summary: 'Review escalated to human',
				details: {
					feedback: 'Architectural decision required',
				},
			};

			const result = formatProgressEntry(entry);

			expect(result).to.include('Review: Escalated to Human');
			expect(result).to.include('**Feedback:** Architectural decision required');
		});

		it('formats milestone completed entry', () => {
			const entry: ProgressEntry = {
				timestamp: '2024-01-15T14:00:00.000Z',
				type: 'milestone_completed',
				milestoneId: 'ms-1',
				summary: 'Milestone completed: Foundation (5 features)',
				details: {},
			};

			const result = formatProgressEntry(entry);

			expect(result).to.include('Milestone Completed');
			expect(result).to.include('**Milestone:** ms-1');
			expect(result).to.include('**Summary:** Milestone completed: Foundation (5 features)');
		});

		it('formats parallel exploration entry with options', () => {
			const entry: ProgressEntry = {
				timestamp: '2024-01-15T15:00:00.000Z',
				type: 'parallel_exploration',
				featureId: 'ft-3',
				summary: 'Parallel exploration complete: Option A selected',
				details: {
					optionA: { approach: 'Use hooks', passed: true, cost: 1.5 },
					optionB: { approach: 'Use classes', passed: false, cost: 2.0 },
					winner: 'a',
					feedback: 'Hooks approach is cleaner',
				},
			};

			const result = formatProgressEntry(entry);

			expect(result).to.include('Parallel Exploration');
			expect(result).to.include('Option A: Use hooks (passed)');
			expect(result).to.include('Option B: Use classes (failed)');
			expect(result).to.include('Winner: Option A');
			expect(result).to.include('**Feedback:** Hooks approach is cleaner');
		});

		it('formats human intervention entry', () => {
			const entry: ProgressEntry = {
				timestamp: '2024-01-15T16:00:00.000Z',
				type: 'human_intervention',
				featureId: 'ft-4',
				summary: 'Human intervention: Resolved dependency issue',
				details: {
					humanAction: 'Resolved dependency issue',
					humanFeedback: 'Upgraded lodash to v4.17.21',
				},
			};

			const result = formatProgressEntry(entry);

			expect(result).to.include('Human Intervention');
			expect(result).to.include('**Human Action:** Resolved dependency issue');
			expect(result).to.include('**Human Feedback:** Upgraded lodash to v4.17.21');
		});

		it('formats error entry', () => {
			const entry: ProgressEntry = {
				timestamp: '2024-01-15T17:00:00.000Z',
				type: 'error',
				featureId: 'ft-5',
				summary: 'Error: Network timeout',
				details: {
					error: 'Network timeout',
				},
			};

			const result = formatProgressEntry(entry);

			expect(result).to.include('Error');
			expect(result).to.include('**Error:** Network timeout');
		});

		it('includes separator at the end', () => {
			const entry: ProgressEntry = {
				timestamp: '2024-01-15T10:00:00.000Z',
				type: 'feature_attempt',
				summary: 'Test',
				details: {},
			};

			const result = formatProgressEntry(entry);

			expect(result).to.include('\n---\n');
		});
	});

	// =============================================================================
	// parseRecentProgress Tests
	// =============================================================================

	describe('parseRecentProgress', () => {
		const sampleProgressLog = `# Progress Log: test-task

> Test task description

---

## 2024-01-15T10:00:00.000Z - Initialization

**Summary:** Task initialized

---

## 2024-01-15T11:00:00.000Z - Feature Attempt

**Feature:** ft-1
**Summary:** Starting attempt 1

---

## 2024-01-15T12:00:00.000Z - Feature Passed

**Feature:** ft-1
**Summary:** Tests passed
**Test:** \`pnpm test\` ✓

---

## 2024-01-15T13:00:00.000Z - Feature Failed

**Feature:** ft-2
**Summary:** Tests failed
**Error:** Assertion failed

---
`;

		it('parses entries from markdown content', () => {
			const entries = parseRecentProgress(sampleProgressLog);

			expect(entries).to.have.length(4);
			expect(entries[0].type).to.equal('Initialization');
			expect(entries[1].type).to.equal('Feature Attempt');
			expect(entries[2].type).to.equal('Feature Passed');
			expect(entries[3].type).to.equal('Feature Failed');
		});

		it('extracts timestamps correctly', () => {
			const entries = parseRecentProgress(sampleProgressLog);

			expect(entries[0].timestamp).to.equal('2024-01-15T10:00:00.000Z');
			expect(entries[1].timestamp).to.equal('2024-01-15T11:00:00.000Z');
			expect(entries[2].timestamp).to.equal('2024-01-15T12:00:00.000Z');
			expect(entries[3].timestamp).to.equal('2024-01-15T13:00:00.000Z');
		});

		it('extracts entry bodies', () => {
			const entries = parseRecentProgress(sampleProgressLog);

			expect(entries[0].body).to.include('**Summary:** Task initialized');
			expect(entries[1].body).to.include('**Feature:** ft-1');
			expect(entries[2].body).to.include('**Test:**');
			expect(entries[3].body).to.include('**Error:** Assertion failed');
		});

		it('limits results when limit is specified', () => {
			const entries = parseRecentProgress(sampleProgressLog, 2);

			// Returns most recent entries
			expect(entries).to.have.length(2);
			expect(entries[0].type).to.equal('Feature Passed');
			expect(entries[1].type).to.equal('Feature Failed');
		});

		it('returns empty array for empty content', () => {
			const entries = parseRecentProgress('');
			expect(entries).to.deep.equal([]);
		});

		it('returns empty array for content without entries', () => {
			const entries = parseRecentProgress('# Progress Log\n\nNo entries yet.');
			expect(entries).to.deep.equal([]);
		});

		it('handles content with header but no entries', () => {
			const content = `# Progress Log: test-task

> Description

---
`;
			const entries = parseRecentProgress(content);
			expect(entries).to.deep.equal([]);
		});
	});

	// =============================================================================
	// getFeatureProgress Tests
	// =============================================================================

	describe('getFeatureProgress', () => {
		const progressWithMultipleFeatures = `# Progress Log

---

## 2024-01-15T10:00:00.000Z - Feature Attempt

**Feature:** ft-1
**Summary:** Starting attempt 1

---

## 2024-01-15T11:00:00.000Z - Feature Attempt

**Feature:** ft-2
**Summary:** Starting attempt 1

---

## 2024-01-15T12:00:00.000Z - Feature Failed

**Feature:** ft-1
**Summary:** Tests failed
**Error:** Error 1

---

## 2024-01-15T13:00:00.000Z - Feature Passed

**Feature:** ft-1
**Summary:** Tests passed

---

## 2024-01-15T14:00:00.000Z - Feature Passed

**Feature:** ft-2
**Summary:** Tests passed

---
`;

		it('filters entries by feature ID', () => {
			const ft1Entries = getFeatureProgress(progressWithMultipleFeatures, 'ft-1');

			expect(ft1Entries).to.have.length(3);
			ft1Entries.forEach((entry) => {
				expect(entry.body).to.include('**Feature:** ft-1');
			});
		});

		it('returns different entries for different features', () => {
			const ft1Entries = getFeatureProgress(progressWithMultipleFeatures, 'ft-1');
			const ft2Entries = getFeatureProgress(progressWithMultipleFeatures, 'ft-2');

			expect(ft1Entries).to.have.length(3);
			expect(ft2Entries).to.have.length(2);
		});

		it('returns empty array for non-existent feature', () => {
			const entries = getFeatureProgress(progressWithMultipleFeatures, 'ft-999');
			expect(entries).to.deep.equal([]);
		});

		it('returns empty array for empty content', () => {
			const entries = getFeatureProgress('', 'ft-1');
			expect(entries).to.deep.equal([]);
		});
	});

	// =============================================================================
	// countFeatureAttempts Tests
	// =============================================================================

	describe('countFeatureAttempts', () => {
		const progressWithAttempts = `# Progress Log

---

## 2024-01-15T10:00:00.000Z - Feature Attempt

**Feature:** ft-1
**Summary:** Starting attempt 1

---

## 2024-01-15T11:00:00.000Z - Feature Failed

**Feature:** ft-1
**Summary:** Tests failed

---

## 2024-01-15T12:00:00.000Z - Feature Attempt

**Feature:** ft-1
**Summary:** Starting attempt 2

---

## 2024-01-15T13:00:00.000Z - Feature Passed

**Feature:** ft-1
**Summary:** Tests passed

---

## 2024-01-15T14:00:00.000Z - Review Approved

**Feature:** ft-1
**Summary:** Approved

---
`;

		it('counts feature attempts, failures, and passes', () => {
			// Counts entries with type 'Feature Attempt', 'Feature Failed', or 'Feature Passed'
			const count = countFeatureAttempts(progressWithAttempts, 'ft-1');

			// 2 attempts + 1 failed + 1 passed = 4
			expect(count).to.equal(4);
		});

		it('returns 0 for feature with no attempts', () => {
			const count = countFeatureAttempts(progressWithAttempts, 'ft-999');
			expect(count).to.equal(0);
		});

		it('does not count non-attempt entries', () => {
			// 'Review Approved' should not be counted
			const progressWithOnlyReview = `## 2024-01-15T14:00:00.000Z - Review Approved

**Feature:** ft-1
**Summary:** Approved

---
`;
			const count = countFeatureAttempts(progressWithOnlyReview, 'ft-1');
			expect(count).to.equal(0);
		});

		it('returns 0 for empty content', () => {
			const count = countFeatureAttempts('', 'ft-1');
			expect(count).to.equal(0);
		});
	});
});
