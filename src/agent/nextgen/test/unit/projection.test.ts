/**
 * Unit Tests for memory/projection.ts
 *
 * Tests the TodoWrite projection from domain memory state.
 */

import { expect } from 'chai';
import { formatTodoItems, projectDetailedProgress, projectMilestoneToTodoWrite, projectSummary, projectToTodoWrite } from '../../memory/projection';
import type { GoalTree, TaskStatus } from '../../memory/types';
import {
	createComplexGoalTree,
	createSimpleGoalTree,
	createTestFeature,
	createTestFeatureStatus,
	createTestGoalTree,
	createTestMilestone,
	createTestSubtask,
	createTestTaskStatus,
} from '../fixtures/memoryFixtures';

describe('memory/projection', () => {
	// =============================================================================
	// projectToTodoWrite Tests
	// =============================================================================

	describe('projectToTodoWrite', () => {
		it('projects empty goals to empty todo list', () => {
			const goals = createTestGoalTree({ milestones: [] });
			const status = createTestTaskStatus({ milestones: {}, features: {} });

			const todos = projectToTodoWrite(goals, status);

			expect(todos).to.deep.equal([]);
		});

		it('projects single milestone with status', () => {
			const goals = createSimpleGoalTree();
			const status = createTestTaskStatus({
				milestones: {
					'ms-1': { status: 'in_progress', passing: 1, total: 2 },
				},
				features: {
					'ms-1-st-1-ft-1': createTestFeatureStatus({ status: 'passing' }),
					'ms-1-st-1-ft-2': createTestFeatureStatus({ status: 'pending' }),
				},
			});

			const todos = projectToTodoWrite(goals, status);

			expect(todos).to.have.length(1);
			expect(todos[0].content).to.equal('Milestone 1 (1/2)');
			expect(todos[0].status).to.equal('in_progress');
		});

		it('includes current feature when provided', () => {
			const goals = createSimpleGoalTree();
			const currentFeature = goals.milestones[0].subtasks[0].features[0];
			const status = createTestTaskStatus({
				milestones: {
					'ms-1': { status: 'in_progress', passing: 0, total: 2 },
				},
				features: {
					'ms-1-st-1-ft-1': createTestFeatureStatus({ status: 'in_progress' }),
					'ms-1-st-1-ft-2': createTestFeatureStatus({ status: 'pending' }),
				},
			});

			const todos = projectToTodoWrite(goals, status, currentFeature);

			expect(todos).to.have.length(2);
			expect(todos[0].content).to.include('Milestone 1');
			expect(todos[1].content).to.equal(currentFeature.description);
			expect(todos[1].status).to.equal('in_progress');
		});

		it('maps milestone status correctly', () => {
			const goals = createTestGoalTree({
				milestones: [
					createTestMilestone({ id: 'ms-1', name: 'Pending' }),
					createTestMilestone({ id: 'ms-2', name: 'In Progress' }),
					createTestMilestone({ id: 'ms-3', name: 'Passing' }),
					createTestMilestone({ id: 'ms-4', name: 'Blocked' }),
				],
			});
			const status = createTestTaskStatus({
				milestones: {
					'ms-1': { status: 'pending', passing: 0, total: 1 },
					'ms-2': { status: 'in_progress', passing: 0, total: 1 },
					'ms-3': { status: 'passing', passing: 1, total: 1 },
					'ms-4': { status: 'blocked', passing: 0, total: 1 },
				},
				features: {},
			});

			const todos = projectToTodoWrite(goals, status);

			expect(todos[0].status).to.equal('pending');
			expect(todos[1].status).to.equal('in_progress');
			expect(todos[2].status).to.equal('completed');
			expect(todos[3].status).to.equal('pending'); // blocked maps to pending
		});
	});

	// =============================================================================
	// projectMilestoneToTodoWrite Tests
	// =============================================================================

	describe('projectMilestoneToTodoWrite', () => {
		it('projects milestone with all features', () => {
			const milestone = createTestMilestone({
				id: 'ms-1',
				name: 'Test Milestone',
				subtasks: [
					createTestSubtask({
						id: 'st-1',
						features: [
							createTestFeature({ id: 'ft-1', description: 'Feature 1' }),
							createTestFeature({ id: 'ft-2', description: 'Feature 2' }),
							createTestFeature({ id: 'ft-3', description: 'Feature 3' }),
						],
					}),
				],
			});
			const status = createTestTaskStatus({
				milestones: {
					'ms-1': { status: 'in_progress', passing: 1, total: 3 },
				},
				features: {
					'ft-1': createTestFeatureStatus({ status: 'passing' }),
					'ft-2': createTestFeatureStatus({ status: 'in_progress' }),
					'ft-3': createTestFeatureStatus({ status: 'pending' }),
				},
			});

			const todos = projectMilestoneToTodoWrite(milestone, status);

			expect(todos).to.have.length(4); // 1 milestone + 3 features
			expect(todos[0].content).to.equal('Test Milestone');
			expect(todos[0].status).to.equal('in_progress');
			expect(todos[1].content).to.equal('Feature 1');
			expect(todos[1].status).to.equal('completed');
			expect(todos[2].content).to.equal('Feature 2');
			expect(todos[2].status).to.equal('in_progress');
			expect(todos[3].content).to.equal('Feature 3');
			expect(todos[3].status).to.equal('pending');
		});

		it('maps feature status correctly', () => {
			const milestone = createTestMilestone({
				id: 'ms-1',
				subtasks: [
					createTestSubtask({
						features: [
							createTestFeature({ id: 'ft-1' }),
							createTestFeature({ id: 'ft-2' }),
							createTestFeature({ id: 'ft-3' }),
							createTestFeature({ id: 'ft-4' }),
							createTestFeature({ id: 'ft-5' }),
						],
					}),
				],
			});
			const status = createTestTaskStatus({
				milestones: {
					'ms-1': { status: 'in_progress', passing: 1, total: 5 },
				},
				features: {
					'ft-1': createTestFeatureStatus({ status: 'pending' }),
					'ft-2': createTestFeatureStatus({ status: 'in_progress' }),
					'ft-3': createTestFeatureStatus({ status: 'passing' }),
					'ft-4': createTestFeatureStatus({ status: 'failing' }),
					'ft-5': createTestFeatureStatus({ status: 'blocked' }),
				},
			});

			const todos = projectMilestoneToTodoWrite(milestone, status);

			expect(todos[1].status).to.equal('pending'); // pending -> pending
			expect(todos[2].status).to.equal('in_progress'); // in_progress -> in_progress
			expect(todos[3].status).to.equal('completed'); // passing -> completed
			expect(todos[4].status).to.equal('in_progress'); // failing -> in_progress
			expect(todos[5].status).to.equal('pending'); // blocked -> pending
		});
	});

	// =============================================================================
	// projectDetailedProgress Tests
	// =============================================================================

	describe('projectDetailedProgress', () => {
		it('shows all milestones with progress counts', () => {
			const goals = createComplexGoalTree();
			const status = createTestTaskStatus({
				milestones: {
					'ms-1': { status: 'passing', passing: 2, total: 2 },
					'ms-2': { status: 'in_progress', passing: 1, total: 2 },
					'ms-3': { status: 'pending', passing: 0, total: 1 },
				},
				features: {
					'ms-1-st-1-ft-1': createTestFeatureStatus({ status: 'passing' }),
					'ms-1-st-1-ft-2': createTestFeatureStatus({ status: 'passing' }),
					'ms-2-st-1-ft-1': createTestFeatureStatus({ status: 'passing' }),
					'ms-2-st-1-ft-2': createTestFeatureStatus({ status: 'in_progress' }),
					'ms-3-st-1-ft-1': createTestFeatureStatus({ status: 'pending' }),
				},
			});

			const todos = projectDetailedProgress(goals, status, undefined, {
				showAllFeatures: false,
				showCompletedMilestones: true,
			});

			// Should include all milestones
			const milestoneItems = todos.filter((t) => t.content.includes('('));
			expect(milestoneItems.length).to.be.at.least(3);
		});

		it('shows features for in-progress milestones', () => {
			const goals = createSimpleGoalTree();
			const currentFeature = goals.milestones[0].subtasks[0].features[0];
			const status = createTestTaskStatus({
				milestones: {
					'ms-1': { status: 'in_progress', passing: 0, total: 2 },
				},
				features: {
					'ms-1-st-1-ft-1': createTestFeatureStatus({ status: 'in_progress' }),
					'ms-1-st-1-ft-2': createTestFeatureStatus({ status: 'pending' }),
				},
			});

			const todos = projectDetailedProgress(goals, status, currentFeature);

			// Should include milestone + features
			expect(todos.length).to.be.greaterThan(1);
		});

		it('hides completed milestones when option is false', () => {
			const goals = createComplexGoalTree();
			const status = createTestTaskStatus({
				milestones: {
					'ms-1': { status: 'passing', passing: 2, total: 2 },
					'ms-2': { status: 'in_progress', passing: 1, total: 2 },
					'ms-3': { status: 'pending', passing: 0, total: 1 },
				},
				features: {
					'ms-1-st-1-ft-1': createTestFeatureStatus({ status: 'passing' }),
					'ms-1-st-1-ft-2': createTestFeatureStatus({ status: 'passing' }),
					'ms-2-st-1-ft-1': createTestFeatureStatus({ status: 'passing' }),
					'ms-2-st-1-ft-2': createTestFeatureStatus({ status: 'in_progress' }),
					'ms-3-st-1-ft-1': createTestFeatureStatus({ status: 'pending' }),
				},
			});

			const todos = projectDetailedProgress(goals, status, undefined, {
				showCompletedMilestones: false,
			});

			// Should not include 'Foundation' (ms-1) which is complete
			expect(todos.some((t) => t.content.includes('Foundation'))).to.be.false;
		});

		it('shows all features when option is true', () => {
			const goals = createSimpleGoalTree();
			const status = createTestTaskStatus({
				milestones: {
					'ms-1': { status: 'in_progress', passing: 1, total: 2 },
				},
				features: {
					'ms-1-st-1-ft-1': createTestFeatureStatus({ status: 'passing' }),
					'ms-1-st-1-ft-2': createTestFeatureStatus({ status: 'pending' }),
				},
			});

			const todos = projectDetailedProgress(goals, status, undefined, {
				showAllFeatures: true,
			});

			// Should include milestone + all features
			expect(todos.length).to.be.greaterThanOrEqual(3);
		});

		it('marks current feature with arrow prefix', () => {
			const goals = createSimpleGoalTree();
			const currentFeature = goals.milestones[0].subtasks[0].features[0];
			const status = createTestTaskStatus({
				milestones: {
					'ms-1': { status: 'in_progress', passing: 0, total: 2 },
				},
				features: {
					'ms-1-st-1-ft-1': createTestFeatureStatus({ status: 'in_progress' }),
					'ms-1-st-1-ft-2': createTestFeatureStatus({ status: 'pending' }),
				},
			});

			const todos = projectDetailedProgress(goals, status, currentFeature);

			const currentItem = todos.find((t) => t.content.startsWith('→'));
			expect(currentItem).to.exist;
			expect(currentItem!.content).to.include(currentFeature.description);
		});
	});

	// =============================================================================
	// projectSummary Tests
	// =============================================================================

	describe('projectSummary', () => {
		it('shows overall task progress', () => {
			const goals = createSimpleGoalTree();
			const status = createTestTaskStatus({
				milestones: {
					'ms-1': { status: 'in_progress', passing: 1, total: 2 },
				},
				features: {
					'ms-1-st-1-ft-1': createTestFeatureStatus({ status: 'passing' }),
					'ms-1-st-1-ft-2': createTestFeatureStatus({ status: 'pending' }),
				},
			});

			const todos = projectSummary(goals, status);

			expect(todos[0].content).to.include('Simple Task');
			expect(todos[0].content).to.include('1/2 features');
			expect(todos[0].status).to.equal('in_progress');
		});

		it('marks task as completed when all features pass', () => {
			const goals = createSimpleGoalTree();
			const status = createTestTaskStatus({
				milestones: {
					'ms-1': { status: 'passing', passing: 2, total: 2 },
				},
				features: {
					'ms-1-st-1-ft-1': createTestFeatureStatus({ status: 'passing' }),
					'ms-1-st-1-ft-2': createTestFeatureStatus({ status: 'passing' }),
				},
			});

			const todos = projectSummary(goals, status);

			expect(todos[0].status).to.equal('completed');
		});

		it('includes milestone summaries with icons', () => {
			const goals = createComplexGoalTree();
			const status = createTestTaskStatus({
				milestones: {
					'ms-1': { status: 'passing', passing: 2, total: 2 },
					'ms-2': { status: 'in_progress', passing: 1, total: 2 },
					'ms-3': { status: 'pending', passing: 0, total: 1 },
				},
				features: {
					'ms-1-st-1-ft-1': createTestFeatureStatus({ status: 'passing' }),
					'ms-1-st-1-ft-2': createTestFeatureStatus({ status: 'passing' }),
					'ms-2-st-1-ft-1': createTestFeatureStatus({ status: 'passing' }),
					'ms-2-st-1-ft-2': createTestFeatureStatus({ status: 'in_progress' }),
					'ms-3-st-1-ft-1': createTestFeatureStatus({ status: 'pending' }),
				},
			});

			const todos = projectSummary(goals, status);

			// First item is overall task
			expect(todos.length).to.be.at.least(4);

			// Check milestone icons
			const foundationItem = todos.find((t) => t.content.includes('Foundation'));
			expect(foundationItem?.content).to.include('✓'); // passing

			const coreItem = todos.find((t) => t.content.includes('Core'));
			expect(coreItem?.content).to.include('→'); // in_progress

			const polishItem = todos.find((t) => t.content.includes('Polish'));
			expect(polishItem?.content).to.include('○'); // pending
		});
	});

	// =============================================================================
	// formatTodoItems Tests
	// =============================================================================

	describe('formatTodoItems', () => {
		it('formats todos with status icons', () => {
			const todos = [
				{ content: 'Pending task', status: 'pending' as const, activeForm: 'Working' },
				{ content: 'In progress task', status: 'in_progress' as const, activeForm: 'Working' },
				{ content: 'Completed task', status: 'completed' as const, activeForm: 'Working' },
			];

			const result = formatTodoItems(todos);

			expect(result).to.include('○ Pending task');
			expect(result).to.include('→ In progress task');
			expect(result).to.include('✓ Completed task');
		});

		it('returns each todo on a new line', () => {
			const todos = [
				{ content: 'Task 1', status: 'pending' as const, activeForm: 'Working' },
				{ content: 'Task 2', status: 'pending' as const, activeForm: 'Working' },
			];

			const result = formatTodoItems(todos);
			const lines = result.split('\n');

			expect(lines).to.have.length(2);
		});

		it('returns empty string for empty list', () => {
			const result = formatTodoItems([]);
			expect(result).to.equal('');
		});
	});
});
