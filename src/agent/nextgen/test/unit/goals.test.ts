/**
 * Unit Tests for goals.ts
 *
 * Tests goal tree operations:
 * - Creation (createGoalTree, createMilestone, createSubtask, createFeature)
 * - Traversal (getAllFeatures, getFeatureById, getMilestoneForFeature, etc.)
 * - Validation (validateGoalTree, circular dependency detection)
 * - Dependency checking (checkMilestoneDependencies, checkFeatureDependencies)
 */

import { expect } from 'chai';
import {
	checkFeatureDependencies,
	checkMilestoneDependencies,
	createFeature,
	createGoalTree,
	createMilestone,
	createSubtask,
	getAllFeatures,
	getFeatureById,
	getFeaturesInMilestone,
	getGoalTreeStats,
	getMilestoneById,
	getMilestoneForFeature,
	getSubtaskById,
	getSubtaskForFeature,
	validateGoalTree,
} from '../../memory/goals';
import {
	createCircularGoalTree,
	createComplexGoalTree,
	createDependentFeature,
	createDependentMilestone,
	createSimpleGoalTree,
	createTestFeature,
	createTestGoalTree,
	createTestMilestone,
	createTestSubtask,
} from '../fixtures/memoryFixtures';

describe('nextgen/memory/goals', () => {
	// ===========================================================================
	// Creation Functions
	// ===========================================================================

	describe('createFeature', () => {
		it('creates feature with required fields', () => {
			const feature = createFeature('ft-1', 'Test feature', 'pnpm test');

			expect(feature.id).to.equal('ft-1');
			expect(feature.description).to.equal('Test feature');
			expect(feature.testCommand).to.equal('pnpm test');
			expect(feature.dependsOn).to.deep.equal([]);
			expect(feature.estimatedComplexity).to.equal('medium');
		});

		it('creates feature with optional fields', () => {
			const feature = createFeature('ft-2', 'Complex feature', 'pnpm test', {
				dependsOn: ['ft-1'],
				estimatedComplexity: 'high',
			});

			expect(feature.dependsOn).to.deep.equal(['ft-1']);
			expect(feature.estimatedComplexity).to.equal('high');
		});
	});

	describe('createSubtask', () => {
		it('creates subtask with features', () => {
			const features = [createFeature('ft-1', 'Feature 1', 'test1'), createFeature('ft-2', 'Feature 2', 'test2')];
			const subtask = createSubtask('st-1', 'Subtask 1', 'Description', features);

			expect(subtask.id).to.equal('st-1');
			expect(subtask.name).to.equal('Subtask 1');
			expect(subtask.features).to.have.length(2);
		});
	});

	describe('createMilestone', () => {
		it('creates milestone with defaults', () => {
			const subtasks = [createTestSubtask()];
			const milestone = createMilestone('ms-1', 'Milestone 1', 'Description', subtasks);

			expect(milestone.id).to.equal('ms-1');
			expect(milestone.requiresHumanReview).to.be.false;
			expect(milestone.dependsOn).to.deep.equal([]);
			expect(milestone.completionCriteria).to.deep.equal([]);
		});

		it('creates milestone with options', () => {
			const milestone = createMilestone('ms-1', 'Milestone 1', 'Description', [], {
				requiresHumanReview: true,
				dependsOn: ['ms-0'],
				completionCriteria: ['All tests pass'],
			});

			expect(milestone.requiresHumanReview).to.be.true;
			expect(milestone.dependsOn).to.deep.equal(['ms-0']);
			expect(milestone.completionCriteria).to.deep.equal(['All tests pass']);
		});
	});

	describe('createGoalTree', () => {
		it('creates goal tree with milestones', () => {
			const milestones = [createTestMilestone()];
			const tree = createGoalTree('Task', 'Description', milestones);

			expect(tree.task).to.equal('Task');
			expect(tree.description).to.equal('Description');
			expect(tree.createdAt).to.be.a('string');
			expect(tree.milestones).to.have.length(1);
		});
	});

	// ===========================================================================
	// Traversal Functions
	// ===========================================================================

	describe('getAllFeatures', () => {
		it('returns all features from simple goal tree', () => {
			const goals = createSimpleGoalTree();
			const features = getAllFeatures(goals);

			expect(features).to.have.length(2);
			expect(features.map((f) => f.id)).to.include('ms-1-st-1-ft-1');
			expect(features.map((f) => f.id)).to.include('ms-1-st-1-ft-2');
		});

		it('returns all features from complex goal tree', () => {
			const goals = createComplexGoalTree();
			const features = getAllFeatures(goals);

			expect(features).to.have.length(5);
		});

		it('returns empty array for empty goal tree', () => {
			const goals = createTestGoalTree({ milestones: [] });
			const features = getAllFeatures(goals);

			expect(features).to.deep.equal([]);
		});
	});

	describe('getFeatureById', () => {
		it('finds feature by ID', () => {
			const goals = createComplexGoalTree();
			const feature = getFeatureById(goals, 'ms-2-st-1-ft-1');

			expect(feature).to.not.be.null;
			expect(feature?.id).to.equal('ms-2-st-1-ft-1');
		});

		it('returns null for unknown ID', () => {
			const goals = createSimpleGoalTree();
			const feature = getFeatureById(goals, 'unknown');

			expect(feature).to.be.null;
		});
	});

	describe('getMilestoneForFeature', () => {
		it('finds milestone containing feature', () => {
			const goals = createComplexGoalTree();
			const milestone = getMilestoneForFeature(goals, 'ms-2-st-1-ft-1');

			expect(milestone).to.not.be.null;
			expect(milestone?.id).to.equal('ms-2');
		});

		it('returns null for unknown feature', () => {
			const goals = createSimpleGoalTree();
			const milestone = getMilestoneForFeature(goals, 'unknown');

			expect(milestone).to.be.null;
		});
	});

	describe('getSubtaskForFeature', () => {
		it('finds subtask containing feature', () => {
			const goals = createComplexGoalTree();
			const subtask = getSubtaskForFeature(goals, 'ms-1-st-1-ft-2');

			expect(subtask).to.not.be.null;
			expect(subtask?.id).to.equal('ms-1-st-1');
		});

		it('returns null for unknown feature', () => {
			const goals = createSimpleGoalTree();
			const subtask = getSubtaskForFeature(goals, 'unknown');

			expect(subtask).to.be.null;
		});
	});

	describe('getFeaturesInMilestone', () => {
		it('returns all features in milestone', () => {
			const goals = createComplexGoalTree();
			const milestone = getMilestoneById(goals, 'ms-1');
			expect(milestone).to.not.be.null;

			const features = getFeaturesInMilestone(milestone!);
			expect(features).to.have.length(2);
		});
	});

	describe('getMilestoneById', () => {
		it('finds milestone by ID', () => {
			const goals = createComplexGoalTree();
			const milestone = getMilestoneById(goals, 'ms-2');

			expect(milestone).to.not.be.null;
			expect(milestone?.name).to.equal('Core Features');
		});

		it('returns null for unknown ID', () => {
			const goals = createSimpleGoalTree();
			const milestone = getMilestoneById(goals, 'unknown');

			expect(milestone).to.be.null;
		});
	});

	describe('getSubtaskById', () => {
		it('finds subtask by ID', () => {
			const goals = createComplexGoalTree();
			const subtask = getSubtaskById(goals, 'ms-2-st-1');

			expect(subtask).to.not.be.null;
		});

		it('returns null for unknown ID', () => {
			const goals = createSimpleGoalTree();
			const subtask = getSubtaskById(goals, 'unknown');

			expect(subtask).to.be.null;
		});
	});

	// ===========================================================================
	// Dependency Checking
	// ===========================================================================

	describe('checkMilestoneDependencies', () => {
		it('returns true when no dependencies', () => {
			const goals = createComplexGoalTree();
			const milestone = getMilestoneById(goals, 'ms-1')!;
			const passingIds = new Set<string>();

			const result = checkMilestoneDependencies(goals, milestone, passingIds);
			expect(result).to.be.true;
		});

		it('returns true when all dependencies met', () => {
			const goals = createComplexGoalTree();
			const milestone = getMilestoneById(goals, 'ms-2')!;
			const passingIds = new Set(['ms-1-st-1-ft-1', 'ms-1-st-1-ft-2']);

			const result = checkMilestoneDependencies(goals, milestone, passingIds);
			expect(result).to.be.true;
		});

		it('returns false when dependencies not met', () => {
			const goals = createComplexGoalTree();
			const milestone = getMilestoneById(goals, 'ms-2')!;
			const passingIds = new Set(['ms-1-st-1-ft-1']); // Missing ft-2

			const result = checkMilestoneDependencies(goals, milestone, passingIds);
			expect(result).to.be.false;
		});
	});

	describe('checkFeatureDependencies', () => {
		it('returns true when no dependencies', () => {
			const feature = createTestFeature({ dependsOn: [] });
			const passingIds = new Set<string>();

			const result = checkFeatureDependencies(feature, passingIds);
			expect(result).to.be.true;
		});

		it('returns true when all dependencies met', () => {
			const feature = createDependentFeature('ft-2', ['ft-1']);
			const passingIds = new Set(['ft-1']);

			const result = checkFeatureDependencies(feature, passingIds);
			expect(result).to.be.true;
		});

		it('returns false when dependencies not met', () => {
			const feature = createDependentFeature('ft-3', ['ft-1', 'ft-2']);
			const passingIds = new Set(['ft-1']); // Missing ft-2

			const result = checkFeatureDependencies(feature, passingIds);
			expect(result).to.be.false;
		});
	});

	// ===========================================================================
	// Validation
	// ===========================================================================

	describe('validateGoalTree', () => {
		it('validates a correct goal tree', () => {
			const goals = createComplexGoalTree();
			const result = validateGoalTree(goals);

			expect(result.valid).to.be.true;
			expect(result.errors).to.have.length(0);
		});

		it('detects missing task name', () => {
			const goals = createTestGoalTree({ task: '' });
			const result = validateGoalTree(goals);

			expect(result.valid).to.be.false;
			expect(result.errors).to.include('Missing task name');
		});

		it('detects missing description', () => {
			const goals = createTestGoalTree({ description: '' });
			const result = validateGoalTree(goals);

			expect(result.valid).to.be.false;
			expect(result.errors).to.include('Missing task description');
		});

		it('detects no milestones', () => {
			const goals = createTestGoalTree({ milestones: [] });
			const result = validateGoalTree(goals);

			expect(result.valid).to.be.false;
			expect(result.errors).to.include('No milestones defined');
		});

		it('detects duplicate milestone IDs', () => {
			const goals = createTestGoalTree({
				milestones: [createTestMilestone({ id: 'ms-1' }), createTestMilestone({ id: 'ms-1' })],
			});
			const result = validateGoalTree(goals);

			expect(result.valid).to.be.false;
			expect(result.errors.some((e) => e.includes('Duplicate milestone ID'))).to.be.true;
		});

		it('detects duplicate feature IDs', () => {
			const goals = createTestGoalTree({
				milestones: [
					createTestMilestone({
						subtasks: [
							createTestSubtask({
								features: [createTestFeature({ id: 'ft-1' }), createTestFeature({ id: 'ft-1' })],
							}),
						],
					}),
				],
			});
			const result = validateGoalTree(goals);

			expect(result.valid).to.be.false;
			expect(result.errors.some((e) => e.includes('Duplicate feature ID'))).to.be.true;
		});

		it('detects missing test command', () => {
			const goals = createTestGoalTree({
				milestones: [
					createTestMilestone({
						subtasks: [
							createTestSubtask({
								features: [createTestFeature({ testCommand: '' })],
							}),
						],
					}),
				],
			});
			const result = validateGoalTree(goals);

			expect(result.valid).to.be.false;
			expect(result.errors.some((e) => e.includes('no testCommand'))).to.be.true;
		});

		it('detects unknown milestone dependency', () => {
			const goals = createTestGoalTree({
				milestones: [createDependentMilestone('ms-1', ['unknown'])],
			});
			const result = validateGoalTree(goals);

			expect(result.valid).to.be.false;
			expect(result.errors.some((e) => e.includes('unknown milestone'))).to.be.true;
		});

		it('detects unknown feature dependency', () => {
			const goals = createTestGoalTree({
				milestones: [
					createTestMilestone({
						subtasks: [
							createTestSubtask({
								features: [createDependentFeature('ft-1', ['unknown'])],
							}),
						],
					}),
				],
			});
			const result = validateGoalTree(goals);

			expect(result.valid).to.be.false;
			expect(result.errors.some((e) => e.includes('unknown feature'))).to.be.true;
		});

		it('detects circular milestone dependencies', () => {
			const goals = createCircularGoalTree();
			const result = validateGoalTree(goals);

			expect(result.valid).to.be.false;
			expect(result.errors.some((e) => e.includes('Circular milestone'))).to.be.true;
		});

		it('detects circular feature dependencies', () => {
			const goals = createTestGoalTree({
				milestones: [
					createTestMilestone({
						subtasks: [
							createTestSubtask({
								features: [createDependentFeature('ft-1', ['ft-2']), createDependentFeature('ft-2', ['ft-1'])],
							}),
						],
					}),
				],
			});
			const result = validateGoalTree(goals);

			expect(result.valid).to.be.false;
			expect(result.errors.some((e) => e.includes('Circular feature'))).to.be.true;
		});
	});

	// ===========================================================================
	// Statistics
	// ===========================================================================

	describe('getGoalTreeStats', () => {
		it('returns correct stats for simple goal tree', () => {
			const goals = createSimpleGoalTree();
			const stats = getGoalTreeStats(goals);

			expect(stats.milestones).to.equal(1);
			expect(stats.subtasks).to.equal(1);
			expect(stats.features).to.equal(2);
		});

		it('returns correct stats for complex goal tree', () => {
			const goals = createComplexGoalTree();
			const stats = getGoalTreeStats(goals);

			expect(stats.milestones).to.equal(3);
			expect(stats.subtasks).to.equal(3);
			expect(stats.features).to.equal(5);
			expect(stats.hasHumanReviewMilestones).to.be.true;
		});

		it('counts complexity correctly', () => {
			const goals = createTestGoalTree({
				milestones: [
					createTestMilestone({
						subtasks: [
							createTestSubtask({
								features: [
									createTestFeature({ estimatedComplexity: 'low' }),
									createTestFeature({ id: 'ft-2', estimatedComplexity: 'medium' }),
									createTestFeature({ id: 'ft-3', estimatedComplexity: 'high' }),
								],
							}),
						],
					}),
				],
			});
			const stats = getGoalTreeStats(goals);

			expect(stats.complexity.low).to.equal(1);
			expect(stats.complexity.medium).to.equal(1);
			expect(stats.complexity.high).to.equal(1);
		});
	});
});
