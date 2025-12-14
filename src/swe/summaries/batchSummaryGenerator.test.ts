import { expect } from 'chai';
import type { BatchJobState } from '#llm/services/vertexBatch';
import type { IFileSystemService } from '#shared/files/fileSystemService';
import {
	acquireBatchLock,
	buildFileSummaryPrompt,
	buildFolderSummaryPrompt,
	clearBatchJobState,
	hasPendingBatchJob,
	loadBatchJobState,
	releaseBatchLock,
	saveBatchJobState,
} from './batchSummaryGenerator';
import type { Summary } from './llmSummaries';

/**
 * Creates an in-memory mock of IFileSystemService for testing.
 */
function createMockFileSystem(workingDir = '/test/project'): IFileSystemService & { files: Map<string, string> } {
	const files = new Map<string, string>();

	return {
		files,
		getWorkingDirectory: () => workingDir,
		async readFile(path: string): Promise<string> {
			const content = files.get(path);
			if (content === undefined) {
				const error: any = new Error(`ENOENT: no such file or directory, open '${path}'`);
				error.code = 'ENOENT';
				throw error;
			}
			return content;
		},
		async writeFile(path: string, content: string): Promise<void> {
			files.set(path, content);
		},
		async deleteFile(path: string): Promise<void> {
			files.delete(path);
		},
		async fileExists(path: string): Promise<boolean> {
			return files.has(path);
		},
		// Stub remaining methods - not needed for state persistence tests
		async listFilesRecursive(): Promise<string[]> {
			return [];
		},
		async listFilesInDirectory(): Promise<string[]> {
			return [];
		},
		async getFileStats(): Promise<any> {
			return {};
		},
	} as any;
}

describe('batchSummaryGenerator', () => {
	describe('buildFileSummaryPrompt', () => {
		it('should generate prompt without parent summaries', () => {
			const fileContents = 'export function hello() { return "world"; }';
			const parentSummaries: Summary[] = [];

			const prompt = buildFileSummaryPrompt(fileContents, parentSummaries);

			expect(prompt).to.include('<source-code>');
			expect(prompt).to.include(fileContents);
			expect(prompt).to.include('</source-code>');
			expect(prompt).to.include('SHORT SUMMARY');
			expect(prompt).to.include('LONG SUMMARY');
			expect(prompt).not.to.include('<parent-summaries>');
		});

		it('should include parent summaries when provided', () => {
			const fileContents = 'export function hello() { return "world"; }';
			const parentSummaries: Summary[] = [
				{
					path: 'src',
					short: 'Source code directory',
					long: 'Contains all source code files',
					meta: { hash: 'abc123' },
				},
				{
					path: 'src/utils',
					short: 'Utility functions',
					long: 'Helper functions and utilities',
					meta: { hash: 'def456' },
				},
			];

			const prompt = buildFileSummaryPrompt(fileContents, parentSummaries);

			expect(prompt).to.include('<parent-summaries>');
			expect(prompt).to.include('</parent-summaries>');
			expect(prompt).to.include('<parent-summary path="src">');
			expect(prompt).to.include('Contains all source code files');
			expect(prompt).to.include('<parent-summary path="src/utils">');
			expect(prompt).to.include('Helper functions and utilities');
		});

		it('should include JSON format instructions', () => {
			const prompt = buildFileSummaryPrompt('some code', []);

			expect(prompt).to.include('"short"');
			expect(prompt).to.include('"long"');
			expect(prompt).to.include('Maximum 15 words');
			expect(prompt).to.include('Maximum 3 concise sentences');
		});
	});

	describe('buildFolderSummaryPrompt', () => {
		it('should generate prompt for folder summary', () => {
			const combinedSummary = `file1.ts:
Exports utility functions for string manipulation.

file2.ts:
Database connection helpers.`;
			const parentSummaries: Summary[] = [];

			const prompt = buildFolderSummaryPrompt(combinedSummary, parentSummaries);

			expect(prompt).to.include('<summaries>');
			expect(prompt).to.include(combinedSummary);
			expect(prompt).to.include('</summaries>');
			expect(prompt).to.include('Maximum 15 words');
			expect(prompt).to.include('Maximum 4 concise sentences');
		});

		it('should include parent summaries when provided', () => {
			const combinedSummary = 'file.ts:\nSome summary';
			const parentSummaries: Summary[] = [
				{
					path: 'src',
					short: 'Source directory',
					long: 'Main source code',
					meta: { hash: 'abc' },
				},
			];

			const prompt = buildFolderSummaryPrompt(combinedSummary, parentSummaries);

			expect(prompt).to.include('<parent-summaries>');
			expect(prompt).to.include('<parent-summary path="src">');
			expect(prompt).to.include('Main source code');
		});
	});

	describe('state persistence', () => {
		const createTestState = (): BatchJobState => ({
			jobId: 'projects/test/locations/us-central1/batchPredictionJobs/123',
			jobName: 'batch-summaries-test',
			submittedAt: '2024-01-15T10:30:00Z',
			state: 'JOB_STATE_RUNNING',
			lastCheckedAt: '2024-01-15T10:30:00Z',
			config: {
				projectId: 'test-project',
				region: 'us-central1',
				bucket: 'test-bucket',
				model: 'gemini-2.5-flash',
			},
			requestCount: 100,
			fileMapping: {
				'src/index.ts': { path: 'src/index.ts', hash: 'abc123' },
				'src/utils.ts': { path: 'src/utils.ts', hash: 'def456' },
			},
		});

		describe('saveBatchJobState / loadBatchJobState', () => {
			it('should roundtrip state correctly', async () => {
				const fss = createMockFileSystem();
				const state = createTestState();

				await saveBatchJobState(fss, state);
				const loaded = await loadBatchJobState(fss);

				expect(loaded).to.deep.equal(state);
			});

			it('should return null when no state file exists', async () => {
				const fss = createMockFileSystem();

				const loaded = await loadBatchJobState(fss);

				expect(loaded).to.be.null;
			});

			it('should throw on corrupted state file', async () => {
				const fss = createMockFileSystem();
				fss.files.set('/test/project/.typedai/batch-job-state.json', 'not valid json {{{');

				try {
					await loadBatchJobState(fss);
					expect.fail('Should have thrown');
				} catch (e: any) {
					expect(e.message).to.include('corrupted');
				}
			});

			it('should preserve fileMapping with hashes', async () => {
				const fss = createMockFileSystem();
				const state = createTestState();

				await saveBatchJobState(fss, state);
				const loaded = await loadBatchJobState(fss);

				expect(loaded?.fileMapping['src/index.ts'].hash).to.equal('abc123');
				expect(loaded?.fileMapping['src/utils.ts'].hash).to.equal('def456');
			});
		});

		describe('clearBatchJobState', () => {
			it('should remove state file', async () => {
				const fss = createMockFileSystem();
				await saveBatchJobState(fss, createTestState());

				await clearBatchJobState(fss);
				const loaded = await loadBatchJobState(fss);

				expect(loaded).to.be.null;
			});

			it('should not throw when state file does not exist', async () => {
				const fss = createMockFileSystem();

				// Should not throw
				await clearBatchJobState(fss);
			});
		});

		describe('hasPendingBatchJob', () => {
			it('should return false when no state exists', async () => {
				const fss = createMockFileSystem();

				const result = await hasPendingBatchJob(fss);

				expect(result).to.be.false;
			});

			it('should return true for running job', async () => {
				const fss = createMockFileSystem();
				const state = createTestState();
				state.state = 'JOB_STATE_RUNNING';
				await saveBatchJobState(fss, state);

				const result = await hasPendingBatchJob(fss);

				expect(result).to.be.true;
			});

			it('should return true for pending job', async () => {
				const fss = createMockFileSystem();
				const state = createTestState();
				state.state = 'JOB_STATE_PENDING';
				await saveBatchJobState(fss, state);

				const result = await hasPendingBatchJob(fss);

				expect(result).to.be.true;
			});

			it('should return false for succeeded job', async () => {
				const fss = createMockFileSystem();
				const state = createTestState();
				state.state = 'JOB_STATE_SUCCEEDED';
				await saveBatchJobState(fss, state);

				const result = await hasPendingBatchJob(fss);

				expect(result).to.be.false;
			});

			it('should return false for failed job', async () => {
				const fss = createMockFileSystem();
				const state = createTestState();
				state.state = 'JOB_STATE_FAILED';
				await saveBatchJobState(fss, state);

				const result = await hasPendingBatchJob(fss);

				expect(result).to.be.false;
			});

			it('should return false for cancelled job', async () => {
				const fss = createMockFileSystem();
				const state = createTestState();
				state.state = 'JOB_STATE_CANCELLED';
				await saveBatchJobState(fss, state);

				const result = await hasPendingBatchJob(fss);

				expect(result).to.be.false;
			});
		});

		describe('batch locking', () => {
			it('should acquire lock when none exists', async () => {
				const fss = createMockFileSystem();

				const acquired = await acquireBatchLock(fss);

				expect(acquired).to.be.true;
				expect(fss.files.has('/test/project/.typedai/batch-job.lock')).to.be.true;
			});

			it('should not acquire lock when recently held', async () => {
				const fss = createMockFileSystem();
				// Create a recent lock
				fss.files.set('/test/project/.typedai/batch-job.lock', JSON.stringify({ timestamp: Date.now(), pid: 999 }));

				const acquired = await acquireBatchLock(fss);

				expect(acquired).to.be.false;
			});

			it('should acquire lock when stale (expired)', async () => {
				const fss = createMockFileSystem();
				// Create an old lock (25 hours ago)
				const staleTimestamp = Date.now() - 25 * 60 * 60 * 1000;
				fss.files.set('/test/project/.typedai/batch-job.lock', JSON.stringify({ timestamp: staleTimestamp, pid: 999 }));

				const acquired = await acquireBatchLock(fss);

				expect(acquired).to.be.true;
			});

			it('should release lock', async () => {
				const fss = createMockFileSystem();
				await acquireBatchLock(fss);
				expect(fss.files.has('/test/project/.typedai/batch-job.lock')).to.be.true;

				await releaseBatchLock(fss);

				expect(fss.files.has('/test/project/.typedai/batch-job.lock')).to.be.false;
			});

			it('should not throw when releasing non-existent lock', async () => {
				const fss = createMockFileSystem();

				// Should not throw
				await releaseBatchLock(fss);
			});

			it('should handle corrupted lock file by overwriting', async () => {
				const fss = createMockFileSystem();
				fss.files.set('/test/project/.typedai/batch-job.lock', 'not valid json');

				const acquired = await acquireBatchLock(fss);

				expect(acquired).to.be.true;
			});
		});
	});
});
