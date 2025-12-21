/**
 * Integration Tests for memory/store.ts
 *
 * Tests file I/O operations with actual filesystem access.
 * Uses temp directories that are cleaned up after each test.
 */

import * as fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { expect } from 'chai';
import {
	appendMarkdown,
	domainMemoryExists,
	ensureDir,
	fileExists,
	formatProgressEntry,
	initializeDomainMemory,
	loadDomainMemory,
	loadGoals,
	loadJson,
	loadMarkdown,
	loadStatus,
	saveGoals,
	saveJson,
	saveMarkdown,
	saveStatus,
} from '../../memory/store';
import { getDomainMemoryPaths } from '../../memory/types';
import type { GoalTree, ProgressEntry, TaskStatus } from '../../memory/types';
import { createSimpleGoalTree, createTestFeatureStatus, createTestProgressEntry, createTestTaskStatus } from '../fixtures/memoryFixtures';

describe('integration/store', () => {
	let tempDir: string;

	beforeEach(async () => {
		// Create a unique temp directory for each test
		tempDir = await fs.mkdtemp(path.join(tmpdir(), 'nextgen-test-'));
	});

	afterEach(async () => {
		// Clean up temp directory
		try {
			await fs.rm(tempDir, { recursive: true, force: true });
		} catch (error) {
			// Ignore cleanup errors
		}
	});

	// =============================================================================
	// Directory Operations Tests
	// =============================================================================

	describe('ensureDir', () => {
		it('creates directory if it does not exist', async () => {
			const newDir = path.join(tempDir, 'new', 'nested', 'dir');

			await ensureDir(newDir);

			const stat = await fs.stat(newDir);
			expect(stat.isDirectory()).to.be.true;
		});

		it('does not error if directory already exists', async () => {
			await ensureDir(tempDir);

			// Should not throw
			await ensureDir(tempDir);

			const stat = await fs.stat(tempDir);
			expect(stat.isDirectory()).to.be.true;
		});
	});

	describe('fileExists', () => {
		it('returns true for existing file', async () => {
			const filePath = path.join(tempDir, 'test.txt');
			await fs.writeFile(filePath, 'test content');

			const exists = await fileExists(filePath);

			expect(exists).to.be.true;
		});

		it('returns false for non-existing file', async () => {
			const filePath = path.join(tempDir, 'nonexistent.txt');

			const exists = await fileExists(filePath);

			expect(exists).to.be.false;
		});

		it('returns true for existing directory', async () => {
			const exists = await fileExists(tempDir);

			expect(exists).to.be.true;
		});
	});

	// =============================================================================
	// YAML Operations Tests (goals.yaml)
	// =============================================================================

	describe('loadGoals / saveGoals', () => {
		it('saves and loads a goal tree', async () => {
			const goalsPath = path.join(tempDir, 'goals.yaml');
			const goals = createSimpleGoalTree();

			await saveGoals(goalsPath, goals);
			const loaded = await loadGoals(goalsPath);

			// Check key fields (YAML may omit undefined/null fields)
			expect(loaded?.task).to.equal(goals.task);
			expect(loaded?.description).to.equal(goals.description);
			expect(loaded?.milestones).to.have.length(goals.milestones.length);
		});

		it('returns null for non-existing file', async () => {
			const goalsPath = path.join(tempDir, 'nonexistent.yaml');

			const loaded = await loadGoals(goalsPath);

			expect(loaded).to.be.null;
		});

		it('creates parent directories if needed', async () => {
			const goalsPath = path.join(tempDir, 'nested', 'dir', 'goals.yaml');
			const goals = createSimpleGoalTree();

			await saveGoals(goalsPath, goals);
			const loaded = await loadGoals(goalsPath);

			expect(loaded?.task).to.equal(goals.task);
			expect(loaded?.milestones).to.have.length(goals.milestones.length);
		});

		it('preserves complex goal tree structure', async () => {
			const goalsPath = path.join(tempDir, 'goals.yaml');
			const goals: GoalTree = {
				task: 'Complex Task',
				description: 'A task with various data types',
				createdAt: '2024-01-15T10:00:00.000Z',
				updatedAt: '2024-01-15T12:00:00.000Z',
				milestones: [
					{
						id: 'ms-1',
						name: 'Milestone 1',
						description: 'First milestone with "quotes" and special chars: @#$%',
						requiresHumanReview: true,
						dependsOn: [],
						completionCriteria: ['Criterion 1', 'Criterion 2'],
						subtasks: [
							{
								id: 'st-1',
								name: 'Subtask 1',
								description: 'Description with\nmultiple\nlines',
								features: [
									{
										id: 'ft-1',
										description: 'Feature with backticks: `code`',
										testCommand: 'pnpm test -- --grep "ft-1"',
										dependsOn: [],
										estimatedComplexity: 'high',
									},
								],
							},
						],
					},
				],
				constraints: ['No breaking changes'],
				preferences: ['Use hooks for state management'],
			};

			await saveGoals(goalsPath, goals);
			const loaded = await loadGoals(goalsPath);

			expect(loaded).to.deep.equal(goals);
		});
	});

	// =============================================================================
	// JSON Operations Tests (status.json)
	// =============================================================================

	describe('loadJson / saveJson', () => {
		it('saves and loads JSON data', async () => {
			const filePath = path.join(tempDir, 'data.json');
			const data = { key: 'value', number: 42, array: [1, 2, 3] };

			await saveJson(filePath, data);
			const loaded = await loadJson<typeof data>(filePath);

			expect(loaded).to.deep.equal(data);
		});

		it('returns null for non-existing file', async () => {
			const filePath = path.join(tempDir, 'nonexistent.json');

			const loaded = await loadJson(filePath);

			expect(loaded).to.be.null;
		});
	});

	describe('loadStatus / saveStatus', () => {
		it('saves and loads task status', async () => {
			const statusPath = path.join(tempDir, 'status.json');
			const status = createTestTaskStatus({
				taskId: 'integration-test',
				features: {
					'ft-1': createTestFeatureStatus({ status: 'passing', attempts: 2 }),
					'ft-2': createTestFeatureStatus({ status: 'failing', lastError: 'Test error' }),
				},
				milestones: {
					'ms-1': { status: 'in_progress', passing: 1, total: 2 },
				},
			});

			await saveStatus(statusPath, status);
			const loaded = await loadStatus(statusPath);

			// Check key fields
			expect(loaded?.taskId).to.equal(status.taskId);
			expect(loaded?.features['ft-1'].status).to.equal('passing');
			expect(loaded?.features['ft-2'].status).to.equal('failing');
			expect(loaded?.features['ft-2'].lastError).to.equal('Test error');
			expect(loaded?.milestones['ms-1'].status).to.equal('in_progress');
		});

		it('preserves all feature status fields', async () => {
			const statusPath = path.join(tempDir, 'status.json');
			const status: TaskStatus = {
				taskId: 'test-task',
				lastUpdated: '2024-01-15T10:00:00.000Z',
				features: {
					'ft-1': {
						status: 'passing',
						attempts: 3,
						maxAttempts: 5,
						commits: ['abc123', 'def456'],
						lastTest: '2024-01-15T09:00:00.000Z',
						lastTestDuration: 1500,
					},
				},
				milestones: {
					'ms-1': { status: 'passing', passing: 1, total: 1 },
				},
			};

			await saveStatus(statusPath, status);
			const loaded = await loadStatus(statusPath);

			// Check key fields are preserved
			expect(loaded?.taskId).to.equal('test-task');
			expect(loaded?.features['ft-1'].status).to.equal('passing');
			expect(loaded?.features['ft-1'].attempts).to.equal(3);
			expect(loaded?.features['ft-1'].maxAttempts).to.equal(5);
			expect(loaded?.features['ft-1'].commits).to.deep.equal(['abc123', 'def456']);
			expect(loaded?.features['ft-1'].lastTest).to.equal('2024-01-15T09:00:00.000Z');
			expect(loaded?.features['ft-1'].lastTestDuration).to.equal(1500);
		});
	});

	// =============================================================================
	// Markdown Operations Tests
	// =============================================================================

	describe('loadMarkdown / saveMarkdown', () => {
		it('saves and loads markdown content', async () => {
			const filePath = path.join(tempDir, 'test.md');
			const content = `# Test Markdown

This is **bold** and *italic*.

- List item 1
- List item 2
`;

			await saveMarkdown(filePath, content);
			const loaded = await loadMarkdown(filePath);

			expect(loaded).to.equal(content);
		});

		it('returns null for non-existing file', async () => {
			const filePath = path.join(tempDir, 'nonexistent.md');

			const loaded = await loadMarkdown(filePath);

			expect(loaded).to.be.null;
		});

		it('preserves unicode content', async () => {
			const filePath = path.join(tempDir, 'unicode.md');
			const content = '# Unicode Test 🚀\n\n日本語テスト\nÉmoji: ✓ ✗ ○ →';

			await saveMarkdown(filePath, content);
			const loaded = await loadMarkdown(filePath);

			expect(loaded).to.equal(content);
		});
	});

	describe('appendMarkdown', () => {
		it('appends to existing file', async () => {
			const filePath = path.join(tempDir, 'append.md');
			await saveMarkdown(filePath, 'First line\n');

			await appendMarkdown(filePath, 'Second line\n');
			const content = await loadMarkdown(filePath);

			expect(content).to.equal('First line\nSecond line\n');
		});

		it('creates file if it does not exist', async () => {
			const filePath = path.join(tempDir, 'new-file.md');

			await appendMarkdown(filePath, 'New content');
			const content = await loadMarkdown(filePath);

			expect(content).to.equal('New content');
		});

		it('creates parent directories if needed', async () => {
			const filePath = path.join(tempDir, 'nested', 'dir', 'append.md');

			await appendMarkdown(filePath, 'Content');
			const content = await loadMarkdown(filePath);

			expect(content).to.equal('Content');
		});
	});

	// =============================================================================
	// Progress Entry Formatting Tests
	// =============================================================================

	describe('formatProgressEntry', () => {
		it('formats a progress entry correctly', async () => {
			const entry: ProgressEntry = {
				timestamp: '2024-01-15T10:00:00.000Z',
				type: 'feature_attempt',
				featureId: 'ft-1',
				summary: 'Starting attempt 1',
				details: { approach: 'Test approach' },
			};

			const formatted = formatProgressEntry(entry);

			expect(formatted).to.include('## 2024-01-15T10:00:00.000Z');
			expect(formatted).to.include('Feature Attempt');
			expect(formatted).to.include('**Feature:** ft-1');
			expect(formatted).to.include('**Summary:** Starting attempt 1');
			expect(formatted).to.include('**Approach:** Test approach');
		});
	});

	// =============================================================================
	// Domain Memory Operations Tests
	// =============================================================================

	describe('initializeDomainMemory', () => {
		it('creates all required files', async () => {
			const paths = getDomainMemoryPaths(tempDir, 'test-task');
			const goals = createSimpleGoalTree();
			const status = createTestTaskStatus({
				taskId: 'test-task',
				features: {
					'ms-1-st-1-ft-1': createTestFeatureStatus(),
					'ms-1-st-1-ft-2': createTestFeatureStatus(),
				},
				milestones: {
					'ms-1': { status: 'pending', passing: 0, total: 2 },
				},
			});

			await initializeDomainMemory(paths, goals, status);

			expect(await fileExists(paths.goalsPath)).to.be.true;
			expect(await fileExists(paths.statusPath)).to.be.true;
			expect(await fileExists(paths.progressPath)).to.be.true;
		});

		it('initializes progress log with header', async () => {
			const paths = getDomainMemoryPaths(tempDir, 'test-task');
			const goals = createSimpleGoalTree();
			const status = createTestTaskStatus({ taskId: 'test-task' });

			await initializeDomainMemory(paths, goals, status);

			const progressContent = await loadMarkdown(paths.progressPath);
			expect(progressContent).to.include('# Progress Log: test-task');
		});
	});

	describe('domainMemoryExists', () => {
		it('returns false when no files exist', async () => {
			const paths = getDomainMemoryPaths(tempDir, 'nonexistent-task');

			const exists = await domainMemoryExists(paths);

			expect(exists).to.be.false;
		});

		it('returns false when only goals exist', async () => {
			const paths = getDomainMemoryPaths(tempDir, 'test-task');
			await ensureDir(paths.baseDir);
			await saveGoals(paths.goalsPath, createSimpleGoalTree());

			const exists = await domainMemoryExists(paths);

			expect(exists).to.be.false;
		});

		it('returns true when both goals and status exist', async () => {
			const paths = getDomainMemoryPaths(tempDir, 'test-task');
			const goals = createSimpleGoalTree();
			const status = createTestTaskStatus({ taskId: 'test-task' });

			await initializeDomainMemory(paths, goals, status);

			const exists = await domainMemoryExists(paths);

			expect(exists).to.be.true;
		});
	});

	describe('loadDomainMemory', () => {
		it('loads all domain memory files', async () => {
			const paths = getDomainMemoryPaths(tempDir, 'test-task');
			const goals = createSimpleGoalTree();
			const status = createTestTaskStatus({ taskId: 'test-task' });

			await initializeDomainMemory(paths, goals, status);
			await saveMarkdown(paths.contextPath, '# Context');

			const loaded = await loadDomainMemory(paths);

			// Check key fields (YAML/JSON may not preserve undefined)
			expect(loaded.goals?.task).to.equal(goals.task);
			expect(loaded.goals?.milestones).to.have.length(goals.milestones.length);
			expect(loaded.status?.taskId).to.equal(status.taskId);
			expect(loaded.progress).to.include('# Progress Log');
			expect(loaded.context).to.equal('# Context');
		});

		it('returns nulls for missing files', async () => {
			const paths = getDomainMemoryPaths(tempDir, 'nonexistent-task');

			const loaded = await loadDomainMemory(paths);

			expect(loaded.goals).to.be.null;
			expect(loaded.status).to.be.null;
			expect(loaded.progress).to.be.null;
			expect(loaded.context).to.be.null;
		});
	});

	// =============================================================================
	// Concurrent Access Tests
	// =============================================================================

	describe('concurrent access', () => {
		it('handles concurrent appends to progress log', async () => {
			const filePath = path.join(tempDir, 'concurrent.md');
			await saveMarkdown(filePath, '# Log\n');

			// Append multiple entries concurrently
			await Promise.all([appendMarkdown(filePath, 'Entry 1\n'), appendMarkdown(filePath, 'Entry 2\n'), appendMarkdown(filePath, 'Entry 3\n')]);

			const content = await loadMarkdown(filePath);

			// All entries should be present (order may vary)
			expect(content).to.include('# Log');
			expect(content).to.include('Entry 1');
			expect(content).to.include('Entry 2');
			expect(content).to.include('Entry 3');
		});
	});
});
