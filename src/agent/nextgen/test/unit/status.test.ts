/**
 * Unit Tests for status.ts
 *
 * Tests status management operations:
 * - Initialization (initializeStatus)
 * - Status updates (updateFeatureStatusFromTest, approveFeature, rejectFeature)
 * - Feature selection (selectNextFeature)
 * - Progress queries (getProgressSummary, isTaskComplete)
 */

import { expect } from 'chai';
import {
	approveFeature,
	blockFeature,
	getBlockedFeatures,
	getFeaturesByStatus,
	getProgressSummary,
	hasExceededMaxAttempts,
	initializeStatus,
	isTaskComplete,
	recalculateMilestoneStatus,
	rejectFeature,
	selectNextFeature,
	startFeature,
	updateFeatureStatusFromTest,
} from '../../memory/status';
import {
	createComplexGoalTree,
	createDependentFeature,
	createFailingTestResult,
	createPassingTestResult,
	createSimpleGoalTree,
	createTaskStatusFromGoals,
	createTestFeature,
	createTestFeatureStatus,
	createTestGoalTree,
	createTestMilestone,
	createTestSubtask,
	createTestTaskStatus,
} from '../fixtures/memoryFixtures';

describe('nextgen/memory/status', () => {
	// ===========================================================================
	// Initialization
	// ===========================================================================

	describe('initializeStatus', () => {
		it('initializes all features as pending', () => {
			const goals = createSimpleGoalTree();
			const status = initializeStatus('test-task', goals);

			expect(status.taskId).to.equal('test-task');
			expect(Object.keys(status.features)).to.have.length(2);

			for (const fs of Object.values(status.features)) {
				expect(fs.status).to.equal('pending');
				expect(fs.attempts).to.equal(0);
				expect(fs.maxAttempts).to.equal(3);
				expect(fs.commits).to.deep.equal([]);
			}
		});

		it('initializes milestones with correct totals', () => {
			const goals = createComplexGoalTree();
			const status = initializeStatus('test-task', goals);

			expect(status.milestones['ms-1']).to.deep.include({
				status: 'pending',
				passing: 0,
				total: 2,
			});

			expect(status.milestones['ms-2']).to.deep.include({
				status: 'pending',
				passing: 0,
				total: 2,
			});
		});

		it('sets lastUpdated timestamp', () => {
			const goals = createSimpleGoalTree();
			const before = new Date().toISOString();
			const status = initializeStatus('test-task', goals);
			const after = new Date().toISOString();

			expect(status.lastUpdated >= before).to.be.true;
			expect(status.lastUpdated <= after).to.be.true;
		});
	});

	// ===========================================================================
	// Status Updates
	// ===========================================================================

	describe('updateFeatureStatusFromTest', () => {
		it('updates status to in_progress on passing test', () => {
			const goals = createSimpleGoalTree();
			const status = initializeStatus('test-task', goals);
			const testResult = createPassingTestResult();

			const updated = updateFeatureStatusFromTest(status, 'ms-1-st-1-ft-1', testResult);

			expect(updated.features['ms-1-st-1-ft-1'].status).to.equal('in_progress');
			expect(updated.features['ms-1-st-1-ft-1'].attempts).to.equal(1);
			expect(updated.features['ms-1-st-1-ft-1'].lastError).to.be.undefined;
		});

		it('updates status to failing on failed test', () => {
			const goals = createSimpleGoalTree();
			const status = initializeStatus('test-task', goals);
			const testResult = createFailingTestResult('Assertion failed');

			const updated = updateFeatureStatusFromTest(status, 'ms-1-st-1-ft-1', testResult);

			expect(updated.features['ms-1-st-1-ft-1'].status).to.equal('failing');
			expect(updated.features['ms-1-st-1-ft-1'].lastError).to.equal('Assertion failed');
		});

		it('increments attempt count', () => {
			const goals = createSimpleGoalTree();
			let status = initializeStatus('test-task', goals);
			const testResult = createFailingTestResult();

			status = updateFeatureStatusFromTest(status, 'ms-1-st-1-ft-1', testResult);
			expect(status.features['ms-1-st-1-ft-1'].attempts).to.equal(1);

			status = updateFeatureStatusFromTest(status, 'ms-1-st-1-ft-1', testResult);
			expect(status.features['ms-1-st-1-ft-1'].attempts).to.equal(2);
		});

		it('records test duration', () => {
			const goals = createSimpleGoalTree();
			const status = initializeStatus('test-task', goals);
			const testResult = createPassingTestResult({ duration: 1234 });

			const updated = updateFeatureStatusFromTest(status, 'ms-1-st-1-ft-1', testResult);

			expect(updated.features['ms-1-st-1-ft-1'].lastTestDuration).to.equal(1234);
		});

		it('appends commits', () => {
			const goals = createSimpleGoalTree();
			let status = initializeStatus('test-task', goals);
			const testResult = createPassingTestResult();

			status = updateFeatureStatusFromTest(status, 'ms-1-st-1-ft-1', testResult, ['abc123']);
			expect(status.features['ms-1-st-1-ft-1'].commits).to.deep.equal(['abc123']);

			status = updateFeatureStatusFromTest(status, 'ms-1-st-1-ft-1', testResult, ['def456']);
			expect(status.features['ms-1-st-1-ft-1'].commits).to.deep.equal(['abc123', 'def456']);
		});

		it('throws for unknown feature', () => {
			const status = createTestTaskStatus();
			const testResult = createPassingTestResult();

			expect(() => updateFeatureStatusFromTest(status, 'unknown', testResult)).to.throw('Feature not found');
		});
	});

	describe('approveFeature', () => {
		it('sets status to passing', () => {
			const goals = createSimpleGoalTree();
			let status = initializeStatus('test-task', goals);
			const testResult = createPassingTestResult();

			// First pass tests
			status = updateFeatureStatusFromTest(status, 'ms-1-st-1-ft-1', testResult);
			expect(status.features['ms-1-st-1-ft-1'].status).to.equal('in_progress');

			// Then approve
			status = approveFeature(status, 'ms-1-st-1-ft-1');
			expect(status.features['ms-1-st-1-ft-1'].status).to.equal('passing');
		});

		it('throws if feature not in_progress', () => {
			const goals = createSimpleGoalTree();
			const status = initializeStatus('test-task', goals);

			expect(() => approveFeature(status, 'ms-1-st-1-ft-1')).to.throw('Cannot approve feature');
		});

		it('throws for unknown feature', () => {
			const status = createTestTaskStatus();

			expect(() => approveFeature(status, 'unknown')).to.throw('Feature not found');
		});
	});

	describe('rejectFeature', () => {
		it('sets status to failing with feedback', () => {
			const goals = createSimpleGoalTree();
			let status = initializeStatus('test-task', goals);
			const testResult = createPassingTestResult();

			status = updateFeatureStatusFromTest(status, 'ms-1-st-1-ft-1', testResult);
			status = rejectFeature(status, 'ms-1-st-1-ft-1', 'Needs refactoring');

			expect(status.features['ms-1-st-1-ft-1'].status).to.equal('failing');
			expect(status.features['ms-1-st-1-ft-1'].lastError).to.equal('Needs refactoring');
		});
	});

	describe('blockFeature', () => {
		it('sets status to blocked with reason', () => {
			const goals = createSimpleGoalTree();
			let status = initializeStatus('test-task', goals);

			status = blockFeature(status, 'ms-1-st-1-ft-1', 'Dependency unavailable');

			expect(status.features['ms-1-st-1-ft-1'].status).to.equal('blocked');
			expect(status.features['ms-1-st-1-ft-1'].lastError).to.equal('Dependency unavailable');
		});
	});

	describe('startFeature', () => {
		it('transitions pending to in_progress', () => {
			const goals = createSimpleGoalTree();
			let status = initializeStatus('test-task', goals);

			status = startFeature(status, 'ms-1-st-1-ft-1');

			expect(status.features['ms-1-st-1-ft-1'].status).to.equal('in_progress');
		});

		it('transitions failing to in_progress', () => {
			const goals = createSimpleGoalTree();
			let status = initializeStatus('test-task', goals);
			const testResult = createFailingTestResult();

			status = updateFeatureStatusFromTest(status, 'ms-1-st-1-ft-1', testResult);
			expect(status.features['ms-1-st-1-ft-1'].status).to.equal('failing');

			status = startFeature(status, 'ms-1-st-1-ft-1');
			expect(status.features['ms-1-st-1-ft-1'].status).to.equal('in_progress');
		});

		it('does not change passing status', () => {
			const status = createTaskStatusFromGoals(createSimpleGoalTree(), 'passing');

			const updated = startFeature(status, 'ms-1-st-1-ft-1');

			expect(updated.features['ms-1-st-1-ft-1'].status).to.equal('passing');
		});
	});

	// ===========================================================================
	// Milestone Status
	// ===========================================================================

	describe('recalculateMilestoneStatus', () => {
		it('sets milestone to passing when all features pass', () => {
			const goals = createSimpleGoalTree();
			const status = createTaskStatusFromGoals(goals, 'passing');

			const updated = recalculateMilestoneStatus(status, goals);

			expect(updated.milestones['ms-1'].status).to.equal('passing');
			expect(updated.milestones['ms-1'].passing).to.equal(2);
		});

		it('sets milestone to in_progress when some features pass', () => {
			const goals = createSimpleGoalTree();
			const status = createTaskStatusFromGoals(goals, 'pending', {
				'ms-1-st-1-ft-1': 'passing',
			});

			const updated = recalculateMilestoneStatus(status, goals);

			expect(updated.milestones['ms-1'].status).to.equal('in_progress');
			expect(updated.milestones['ms-1'].passing).to.equal(1);
		});

		it('sets milestone to blocked when some features blocked', () => {
			const goals = createSimpleGoalTree();
			const status = createTaskStatusFromGoals(goals, 'passing', {
				'ms-1-st-1-ft-2': 'blocked',
			});

			const updated = recalculateMilestoneStatus(status, goals);

			expect(updated.milestones['ms-1'].status).to.equal('blocked');
		});

		it('sets milestone to pending when no progress', () => {
			const goals = createSimpleGoalTree();
			const status = createTaskStatusFromGoals(goals, 'pending');

			const updated = recalculateMilestoneStatus(status, goals);

			expect(updated.milestones['ms-1'].status).to.equal('pending');
		});
	});

	// ===========================================================================
	// Feature Selection
	// ===========================================================================

	describe('selectNextFeature', () => {
		it('returns first pending feature', () => {
			const goals = createSimpleGoalTree();
			const status = initializeStatus('test-task', goals);

			const feature = selectNextFeature(goals, status);

			expect(feature).to.not.be.null;
			expect(feature?.id).to.equal('ms-1-st-1-ft-1');
		});

		it('skips passing features', () => {
			const goals = createSimpleGoalTree();
			const status = createTaskStatusFromGoals(goals, 'pending', {
				'ms-1-st-1-ft-1': 'passing',
			});

			const feature = selectNextFeature(goals, status);

			expect(feature?.id).to.equal('ms-1-st-1-ft-2');
		});

		it('skips blocked features', () => {
			const goals = createSimpleGoalTree();
			const status = createTaskStatusFromGoals(goals, 'pending', {
				'ms-1-st-1-ft-1': 'blocked',
			});

			const feature = selectNextFeature(goals, status);

			expect(feature?.id).to.equal('ms-1-st-1-ft-2');
		});

		it('respects feature dependencies', () => {
			const goals = createTestGoalTree({
				milestones: [
					createTestMilestone({
						id: 'ms-1',
						subtasks: [
							createTestSubtask({
								id: 'ms-1-st-1',
								features: [createTestFeature({ id: 'ft-1' }), createDependentFeature('ft-2', ['ft-1']), createDependentFeature('ft-3', ['ft-2'])],
							}),
						],
					}),
				],
			});
			const status = initializeStatus('test-task', goals);

			// ft-1 is first (no deps)
			let feature = selectNextFeature(goals, status);
			expect(feature?.id).to.equal('ft-1');

			// After ft-1 passes, ft-2 is next
			const statusWithFt1Passing = createTaskStatusFromGoals(goals, 'pending', {
				'ft-1': 'passing',
			});
			feature = selectNextFeature(goals, statusWithFt1Passing);
			expect(feature?.id).to.equal('ft-2');
		});

		it('respects milestone dependencies', () => {
			const goals = createComplexGoalTree();
			const status = initializeStatus('test-task', goals);

			// First milestone features first
			let feature = selectNextFeature(goals, status);
			expect(feature?.id).to.equal('ms-1-st-1-ft-1');

			// After ms-1 passes, ms-2 features are available
			const statusWithMs1Passing = createTaskStatusFromGoals(goals, 'pending', {
				'ms-1-st-1-ft-1': 'passing',
				'ms-1-st-1-ft-2': 'passing',
			});
			feature = selectNextFeature(goals, statusWithMs1Passing);
			expect(feature?.id).to.equal('ms-2-st-1-ft-1');
		});

		it('returns null when all features passing', () => {
			const goals = createSimpleGoalTree();
			const status = createTaskStatusFromGoals(goals, 'passing');

			const feature = selectNextFeature(goals, status);

			expect(feature).to.be.null;
		});

		it('returns null when remaining features blocked', () => {
			const goals = createSimpleGoalTree();
			const status = createTaskStatusFromGoals(goals, 'blocked');

			const feature = selectNextFeature(goals, status);

			expect(feature).to.be.null;
		});
	});

	// ===========================================================================
	// Progress Queries
	// ===========================================================================

	describe('hasExceededMaxAttempts', () => {
		it('returns true when attempts >= maxAttempts', () => {
			const status = createTestTaskStatus({
				features: {
					'ft-1': createTestFeatureStatus({ attempts: 3, maxAttempts: 3 }),
				},
			});

			expect(hasExceededMaxAttempts(status, 'ft-1')).to.be.true;
		});

		it('returns false when attempts < maxAttempts', () => {
			const status = createTestTaskStatus({
				features: {
					'ft-1': createTestFeatureStatus({ attempts: 2, maxAttempts: 3 }),
				},
			});

			expect(hasExceededMaxAttempts(status, 'ft-1')).to.be.false;
		});

		it('returns false for unknown feature', () => {
			const status = createTestTaskStatus();

			expect(hasExceededMaxAttempts(status, 'unknown')).to.be.false;
		});
	});

	describe('getBlockedFeatures', () => {
		it('returns blocked features', () => {
			const goals = createSimpleGoalTree();
			const status = createTaskStatusFromGoals(goals, 'pending', {
				'ms-1-st-1-ft-1': 'blocked',
			});

			const blocked = getBlockedFeatures(goals, status);

			expect(blocked).to.have.length(1);
			expect(blocked[0].id).to.equal('ms-1-st-1-ft-1');
		});

		it('includes features exceeding max attempts', () => {
			const goals = createSimpleGoalTree();
			const status = createTaskStatusFromGoals(goals, 'pending');
			status.features['ms-1-st-1-ft-1'].attempts = 3;
			status.features['ms-1-st-1-ft-1'].maxAttempts = 3;

			const blocked = getBlockedFeatures(goals, status);

			expect(blocked).to.have.length(1);
			expect(blocked[0].id).to.equal('ms-1-st-1-ft-1');
		});
	});

	describe('getProgressSummary', () => {
		it('returns correct counts', () => {
			const goals = createComplexGoalTree();
			const status = createTaskStatusFromGoals(goals, 'pending', {
				'ms-1-st-1-ft-1': 'passing',
				'ms-1-st-1-ft-2': 'passing',
			});
			const updatedStatus = recalculateMilestoneStatus(status, goals);

			const summary = getProgressSummary(goals, updatedStatus);

			expect(summary.passingFeatures).to.equal(2);
			expect(summary.totalFeatures).to.equal(5);
			expect(summary.passingMilestones).to.equal(1);
			expect(summary.totalMilestones).to.equal(3);
			expect(summary.percentComplete).to.equal(40);
		});

		it('returns 0% for no progress', () => {
			const goals = createSimpleGoalTree();
			const status = initializeStatus('test-task', goals);

			const summary = getProgressSummary(goals, status);

			expect(summary.percentComplete).to.equal(0);
		});

		it('returns 100% when complete', () => {
			const goals = createSimpleGoalTree();
			const status = createTaskStatusFromGoals(goals, 'passing');
			const updatedStatus = recalculateMilestoneStatus(status, goals);

			const summary = getProgressSummary(goals, updatedStatus);

			expect(summary.percentComplete).to.equal(100);
		});
	});

	describe('isTaskComplete', () => {
		it('returns true when all features passing', () => {
			const goals = createSimpleGoalTree();
			const status = createTaskStatusFromGoals(goals, 'passing');

			expect(isTaskComplete(goals, status)).to.be.true;
		});

		it('returns false when any feature not passing', () => {
			const goals = createSimpleGoalTree();
			const status = createTaskStatusFromGoals(goals, 'pending', {
				'ms-1-st-1-ft-1': 'passing',
			});

			expect(isTaskComplete(goals, status)).to.be.false;
		});
	});

	describe('getFeaturesByStatus', () => {
		it('returns features with specified status', () => {
			const goals = createSimpleGoalTree();
			const status = createTaskStatusFromGoals(goals, 'pending', {
				'ms-1-st-1-ft-1': 'passing',
			});

			const passing = getFeaturesByStatus(goals, status, 'passing');
			const pending = getFeaturesByStatus(goals, status, 'pending');

			expect(passing).to.have.length(1);
			expect(passing[0].id).to.equal('ms-1-st-1-ft-1');
			expect(pending).to.have.length(1);
			expect(pending[0].id).to.equal('ms-1-st-1-ft-2');
		});
	});
});
