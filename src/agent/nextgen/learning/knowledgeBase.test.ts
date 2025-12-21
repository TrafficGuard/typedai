import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { expect } from 'chai';
import { setupConditionalLoggerOutput } from '#test/testUtils';
import type { Learning } from '../core/types';
import { KnowledgeBase } from './knowledgeBase';

describe('KnowledgeBase', () => {
	setupConditionalLoggerOutput();

	let knowledgeBase: KnowledgeBase;
	let tempDir: string;

	beforeEach(async () => {
		// Create a unique temp directory for each test
		tempDir = path.join(os.tmpdir(), `kb-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
		knowledgeBase = new KnowledgeBase({ basePath: tempDir });
		await knowledgeBase.initialize();
	});

	afterEach(async () => {
		// Cleanup temp directory
		try {
			await fs.rm(tempDir, { recursive: true, force: true });
		} catch {
			// Ignore cleanup errors
		}
	});

	describe('save', () => {
		it('should save a learning to the file system', async () => {
			const learning = createLearning({
				id: 'test-learning-1',
				category: 'typescript/testing',
				content: 'Use vi.mock() at module level',
			});

			const filePath = await knowledgeBase.save(learning);

			expect(filePath).to.include('typescript');
			expect(filePath).to.include('testing');
			expect(filePath).to.include('.md');

			// Verify file exists
			const content = await fs.readFile(filePath, 'utf-8');
			expect(content).to.include('vi.mock()');
			expect(content).to.include('typescript/testing');
		});

		it('should create category directories', async () => {
			const learning = createLearning({
				id: 'test-learning-2',
				category: 'react/hooks/custom',
			});

			await knowledgeBase.save(learning);

			const dirPath = path.join(tempDir, 'react', 'hooks', 'custom');
			const stat = await fs.stat(dirPath);
			expect(stat.isDirectory()).to.be.true;
		});

		it('should include YAML frontmatter', async () => {
			const learning = createLearning({
				type: 'pattern',
				confidence: 0.85,
				tags: ['async', 'testing'],
			});

			const filePath = await knowledgeBase.save(learning);
			const content = await fs.readFile(filePath, 'utf-8');

			expect(content).to.include('---');
			expect(content).to.include('type: pattern');
			expect(content).to.include('confidence: 0.85');
		});
	});

	describe('saveAll', () => {
		it('should save multiple learnings', async () => {
			const learnings = [createLearning({ id: 'l1', category: 'a' }), createLearning({ id: 'l2', category: 'b' }), createLearning({ id: 'l3', category: 'c' })];

			const paths = await knowledgeBase.saveAll(learnings);

			expect(paths).to.have.lengthOf(3);
			for (const p of paths) {
				const stat = await fs.stat(p);
				expect(stat.isFile()).to.be.true;
			}
		});
	});

	describe('get', () => {
		it('should retrieve a saved learning by ID', async () => {
			const learning = createLearning({ id: 'get-test-1' });
			await knowledgeBase.save(learning);

			const retrieved = await knowledgeBase.get('get-test-1');

			expect(retrieved).to.not.be.null;
			expect(retrieved!.id).to.equal('get-test-1');
		});

		it('should return null for non-existent ID', async () => {
			const retrieved = await knowledgeBase.get('non-existent-id');
			expect(retrieved).to.be.null;
		});
	});

	describe('retrieve', () => {
		beforeEach(async () => {
			// Populate with test data
			await knowledgeBase.saveAll([
				createLearning({ id: 'r1', type: 'pattern', category: 'typescript', confidence: 0.9, tags: ['async'] }),
				createLearning({ id: 'r2', type: 'pitfall', category: 'typescript/testing', confidence: 0.8, tags: ['mocking'] }),
				createLearning({ id: 'r3', type: 'pattern', category: 'react', confidence: 0.7, tags: ['hooks'] }),
				createLearning({ id: 'r4', type: 'context', category: 'database', confidence: 0.6, tags: ['postgres'] }),
			]);
		});

		it('should filter by type', async () => {
			const results = await knowledgeBase.retrieve({ types: ['pattern'] });

			expect(results).to.have.lengthOf(2);
			expect(results.every((l) => l.type === 'pattern')).to.be.true;
		});

		it('should filter by category', async () => {
			const results = await knowledgeBase.retrieve({ categories: ['typescript'] });

			expect(results).to.have.lengthOf(2);
			expect(results.every((l) => l.category.startsWith('typescript'))).to.be.true;
		});

		it('should filter by category with wildcard', async () => {
			const results = await knowledgeBase.retrieve({ categories: ['typescript/*'] });

			expect(results.length).to.be.greaterThanOrEqual(1);
		});

		it('should filter by tags', async () => {
			const results = await knowledgeBase.retrieve({ tags: ['async'] });

			expect(results).to.have.lengthOf(1);
			expect(results[0].tags).to.include('async');
		});

		it('should filter by minimum confidence', async () => {
			const results = await knowledgeBase.retrieve({ minConfidence: 0.75 });

			expect(results.every((l) => l.confidence >= 0.75)).to.be.true;
		});

		it('should respect limit', async () => {
			const results = await knowledgeBase.retrieve({ limit: 2 });

			expect(results).to.have.lengthOf(2);
		});

		it('should sort by confidence descending', async () => {
			const results = await knowledgeBase.retrieve({});

			for (let i = 1; i < results.length; i++) {
				expect(results[i - 1].confidence).to.be.greaterThanOrEqual(results[i].confidence);
			}
		});
	});

	describe('retrieveRelevant', () => {
		beforeEach(async () => {
			await knowledgeBase.saveAll([
				createLearning({ id: 'rel1', category: 'typescript', content: 'Use async/await instead of callbacks', confidence: 0.9 }),
				createLearning({ id: 'rel2', category: 'testing', content: 'Mock external services in unit tests', confidence: 0.85 }),
				createLearning({ id: 'rel3', category: 'react', content: 'Use useMemo for expensive calculations', confidence: 0.8 }),
			]);
		});

		it('should find relevant learnings based on task description', async () => {
			const results = await knowledgeBase.retrieveRelevant('Fix async function in TypeScript');

			expect(results.length).to.be.greaterThanOrEqual(1);
		});

		it('should use technology context', async () => {
			const results = await knowledgeBase.retrieveRelevant('Improve performance', { technologies: ['react'] });

			expect(results.some((l) => l.category === 'react')).to.be.true;
		});
	});

	describe('delete', () => {
		it('should delete a learning', async () => {
			const learning = createLearning({ id: 'delete-test' });
			await knowledgeBase.save(learning);

			const deleted = await knowledgeBase.delete('delete-test');

			expect(deleted).to.be.true;
			const retrieved = await knowledgeBase.get('delete-test');
			expect(retrieved).to.be.null;
		});

		it('should return false for non-existent ID', async () => {
			const deleted = await knowledgeBase.delete('non-existent');
			expect(deleted).to.be.false;
		});
	});

	describe('getByCategory', () => {
		beforeEach(async () => {
			await knowledgeBase.saveAll([
				createLearning({ id: 'cat1', category: 'typescript/async' }),
				createLearning({ id: 'cat2', category: 'typescript/types' }),
				createLearning({ id: 'cat3', category: 'react/hooks' }),
			]);
		});

		it('should get all learnings in category', async () => {
			const results = await knowledgeBase.getByCategory('typescript');

			expect(results).to.have.lengthOf(2);
			expect(results.every((l) => l.category.startsWith('typescript'))).to.be.true;
		});

		it('should get learnings in subcategory', async () => {
			const results = await knowledgeBase.getByCategory('typescript/async');

			expect(results).to.have.lengthOf(1);
			expect(results[0].category).to.equal('typescript/async');
		});
	});

	describe('getStats', () => {
		beforeEach(async () => {
			await knowledgeBase.saveAll([
				createLearning({ id: 's1', type: 'pattern', category: 'typescript', confidence: 0.9 }),
				createLearning({ id: 's2', type: 'pattern', category: 'typescript', confidence: 0.8 }),
				createLearning({ id: 's3', type: 'pitfall', category: 'react', confidence: 0.7 }),
			]);
		});

		it('should return correct statistics', async () => {
			const stats = await knowledgeBase.getStats();

			expect(stats.totalLearnings).to.equal(3);
			expect(stats.byType.pattern).to.equal(2);
			expect(stats.byType.pitfall).to.equal(1);
			expect(stats.byCategory.typescript).to.equal(2);
			expect(stats.byCategory.react).to.equal(1);
			expect(stats.avgConfidence).to.be.closeTo(0.8, 0.01);
		});
	});

	describe('clear', () => {
		it('should remove all learnings', async () => {
			await knowledgeBase.saveAll([createLearning({ id: 'c1' }), createLearning({ id: 'c2' })]);

			await knowledgeBase.clear();

			const stats = await knowledgeBase.getStats();
			expect(stats.totalLearnings).to.equal(0);
		});
	});

	describe('persistence', () => {
		it('should load learnings from disk on initialization', async () => {
			const learning = createLearning({ id: 'persist-test', content: 'Persistent learning' });
			await knowledgeBase.save(learning);

			// Create new instance with same path
			const newKB = new KnowledgeBase({ basePath: tempDir });
			await newKB.initialize();

			const retrieved = await newKB.get('persist-test');

			expect(retrieved).to.not.be.null;
			expect(retrieved!.content).to.equal('Persistent learning');
		});
	});
});

// Helper function
function createLearning(overrides: Partial<Learning> = {}): Learning {
	return {
		id: overrides.id ?? `learning-${Date.now()}-${Math.random().toString(36).slice(2)}`,
		type: overrides.type ?? 'pattern',
		category: overrides.category ?? 'test',
		content: overrides.content ?? 'Test learning content',
		confidence: overrides.confidence ?? 0.8,
		tags: overrides.tags ?? [],
		source: overrides.source ?? {
			agentId: 'test-agent',
			task: 'test task',
			outcome: 'success',
		},
		createdAt: overrides.createdAt ?? new Date(),
	};
}
