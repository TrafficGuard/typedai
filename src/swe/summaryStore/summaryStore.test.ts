import path from 'node:path';
import type { PGlite } from '@electric-sql/pglite';
import { expect } from 'chai';
import mockFs from 'mock-fs';
import { typedaiDirName } from '#app/appDirs';
import type { IFileSystemService } from '#shared/files/fileSystemService';
import type { Summary } from '#swe/summaries/llmSummaries';
import { setupConditionalLoggerOutput } from '#test/testUtils';
import { normalizeGitUrl } from './repoId';
import { PostgresSummaryStore, determineSummaryType } from './summaryStoreAdapter';
import { type SyncState, getSyncStatusMessage, loadSyncState, recordPendingPush, recordSuccessfulPull, recordSuccessfulPush } from './syncState';
import { clearSummariesTable, createPGliteClient, createTestPGlite } from './testUtils';

const MOCK_REPO = '/mock/repo';

describe('Summary Store', () => {
	setupConditionalLoggerOutput();

	// ─────────────────────────────────────────────────────────────────────────────
	// Repository Identity (Pure Functions)
	// ─────────────────────────────────────────────────────────────────────────────

	describe('Repository Identity', () => {
		describe('normalizeGitUrl', () => {
			const cases: [string, string][] = [
				// SSH format
				['git@gitlab.com:team/repo.git', 'gitlab.com/team/repo'],
				['git@github.com:org/project.git', 'github.com/org/project'],
				['git@bitbucket.org:company/app.git', 'bitbucket.org/company/app'],

				// HTTPS format
				['https://github.com/org/project.git', 'github.com/org/project'],
				['https://gitlab.com/team/repo.git', 'gitlab.com/team/repo'],
				['http://gitlab.com/team/repo.git', 'gitlab.com/team/repo'],

				// Without .git suffix
				['https://github.com/org/project', 'github.com/org/project'],
				['git@github.com:org/project', 'github.com/org/project'],

				// SSH with port
				['ssh://git@gitlab.com:22/team/repo.git', 'gitlab.com/team/repo'],

				// Case normalization
				['HTTPS://GitHub.COM/ORG/Repo.git', 'github.com/org/repo'],
				['git@GITLAB.COM:TEAM/Repo.git', 'gitlab.com/team/repo'],

				// Deep paths
				['git@gitlab.com:team/subgroup/repo.git', 'gitlab.com/team/subgroup/repo'],
				['https://github.com/org/deep/path/repo.git', 'github.com/org/deep/path/repo'],
			];

			cases.forEach(([input, expected]) => {
				it(`normalizes "${input}" to "${expected}"`, () => {
					expect(normalizeGitUrl(input)).to.equal(expected);
				});
			});
		});
	});

	// ─────────────────────────────────────────────────────────────────────────────
	// Summary Type Classification (Pure Function)
	// ─────────────────────────────────────────────────────────────────────────────

	describe('Summary Type Classification', () => {
		const cases: [string, 'project' | 'folder' | 'file'][] = [
			// Project
			['_project_summary', 'project'],

			// Folders
			['_index', 'folder'],
			['src/_index', 'folder'],
			['src/services/_index', 'folder'],
			['deeply/nested/path/_index', 'folder'],

			// Files
			['file.ts', 'file'],
			['src/file.ts', 'file'],
			['src/services/auth.service.ts', 'file'],
			['package.json', 'file'],
			['.gitignore', 'file'],
			['src/index.ts', 'file'],
			['README.md', 'file'],
		];

		cases.forEach(([inputPath, expectedType]) => {
			it(`classifies "${inputPath}" as "${expectedType}"`, () => {
				expect(determineSummaryType(inputPath)).to.equal(expectedType);
			});
		});
	});

	// ─────────────────────────────────────────────────────────────────────────────
	// Sync State Persistence (File System State)
	// ─────────────────────────────────────────────────────────────────────────────

	describe('Sync State Persistence', () => {
		let mockFss: IFileSystemService;
		const statePath = path.join(MOCK_REPO, typedaiDirName, 'sync-state.json');

		beforeEach(() => {
			mockFs({
				[MOCK_REPO]: {
					[typedaiDirName]: {},
				},
			});

			// Create a mock file system service
			mockFss = {
				getWorkingDirectory: () => MOCK_REPO,
				fileExists: async (p: string) => {
					try {
						const fs = await import('node:fs/promises');
						await fs.access(p);
						return true;
					} catch {
						return false;
					}
				},
				readFile: async (p: string) => {
					const fs = await import('node:fs/promises');
					return fs.readFile(p, 'utf-8');
				},
				writeFile: async (p: string, content: string) => {
					const fs = await import('node:fs/promises');
					const dir = path.dirname(p);
					await fs.mkdir(dir, { recursive: true });
					await fs.writeFile(p, content, 'utf-8');
				},
			} as IFileSystemService;
		});

		afterEach(() => {
			mockFs.restore();
		});

		it('persists pull timestamp to file system', async () => {
			await recordSuccessfulPull('gitlab.com/team/repo', mockFss);

			// Verify FILE STATE
			const fs = await import('node:fs/promises');
			const content = await fs.readFile(statePath, 'utf-8');
			const state: SyncState = JSON.parse(content);

			expect(state.repositoryId).to.equal('gitlab.com/team/repo');
			expect(state.lastSuccessfulPull).to.match(/^\d{4}-\d{2}-\d{2}T/); // ISO timestamp
			expect(state.pendingPushPaths).to.deep.equal([]);
		});

		it('persists push timestamp and clears pending paths', async () => {
			// Setup: state file with pending paths
			const fs = await import('node:fs/promises');
			const initialState: SyncState = {
				repositoryId: 'repo',
				pendingPushPaths: ['file1.ts', 'file2.ts'],
				lastSuccessfulPull: '2024-01-01T00:00:00Z',
				lastSuccessfulPush: null,
			};
			await fs.writeFile(statePath, JSON.stringify(initialState));

			await recordSuccessfulPush('repo', mockFss);

			// Verify FILE STATE
			const content = await fs.readFile(statePath, 'utf-8');
			const state: SyncState = JSON.parse(content);

			expect(state.pendingPushPaths).to.deep.equal([]);
			expect(state.lastSuccessfulPush).to.not.be.null;
			expect(state.lastSuccessfulPush).to.match(/^\d{4}-\d{2}-\d{2}T/);
		});

		it('accumulates pending paths without duplicates', async () => {
			// First batch of pending paths
			await recordPendingPush('repo', ['file1.ts', 'file2.ts'], mockFss);

			// Second batch with some overlap
			await recordPendingPush('repo', ['file2.ts', 'file3.ts'], mockFss);

			// Verify FILE STATE
			const fs = await import('node:fs/promises');
			const content = await fs.readFile(statePath, 'utf-8');
			const state: SyncState = JSON.parse(content);

			expect(state.pendingPushPaths).to.have.members(['file1.ts', 'file2.ts', 'file3.ts']);
			expect(state.pendingPushPaths).to.have.length(3); // No duplicates
		});

		it('returns null for missing sync state file', async () => {
			const state = await loadSyncState(mockFss);
			expect(state).to.be.null;
		});

		it('returns null for corrupt sync state file', async () => {
			const fs = await import('node:fs/promises');
			await fs.writeFile(statePath, 'not valid json{{{');

			const state = await loadSyncState(mockFss);
			expect(state).to.be.null;
		});

		it('returns null for sync state missing repositoryId', async () => {
			const fs = await import('node:fs/promises');
			await fs.writeFile(statePath, JSON.stringify({ lastSuccessfulPull: null }));

			const state = await loadSyncState(mockFss);
			expect(state).to.be.null;
		});
	});

	// ─────────────────────────────────────────────────────────────────────────────
	// Sync Status Message (Pure Function)
	// ─────────────────────────────────────────────────────────────────────────────

	describe('Sync Status Message', () => {
		it('returns appropriate message for null state', () => {
			const message = getSyncStatusMessage(null);
			expect(message).to.equal('No sync history found');
		});

		it('indicates never pulled when lastSuccessfulPull is null', () => {
			const state: SyncState = {
				repositoryId: 'repo',
				lastSuccessfulPull: null,
				lastSuccessfulPush: null,
				pendingPushPaths: [],
			};
			const message = getSyncStatusMessage(state);
			expect(message).to.include('Never pulled from Cloud SQL');
		});

		it('indicates never pushed when lastSuccessfulPush is null', () => {
			const state: SyncState = {
				repositoryId: 'repo',
				lastSuccessfulPull: '2024-01-01T00:00:00Z',
				lastSuccessfulPush: null,
				pendingPushPaths: [],
			};
			const message = getSyncStatusMessage(state);
			expect(message).to.include('Never pushed to Cloud SQL');
		});

		it('shows pending count when paths exist', () => {
			const state: SyncState = {
				repositoryId: 'repo',
				lastSuccessfulPull: '2024-01-01T00:00:00Z',
				lastSuccessfulPush: '2024-01-01T00:00:00Z',
				pendingPushPaths: ['a.ts', 'b.ts', 'c.ts'],
			};
			const message = getSyncStatusMessage(state);
			expect(message).to.include('Pending: 3 paths need sync');
		});
	});

	// ─────────────────────────────────────────────────────────────────────────────
	// PostgreSQL Store Operations (Real PostgreSQL via PGlite)
	// ─────────────────────────────────────────────────────────────────────────────

	describe('PostgreSQL Store Operations', () => {
		let pglite: PGlite;
		let store: PostgresSummaryStore;

		before(async () => {
			pglite = await createTestPGlite();
		});

		beforeEach(async () => {
			const client = createPGliteClient(pglite);
			store = new PostgresSummaryStore(client);

			// Initialize schema for first test, then just clear data
			await client.initializeSchema();
			await clearSummariesTable(pglite);
		});

		after(async () => {
			await store.close();
			await pglite.close();
		});

		describe('Push and Pull round-trip', () => {
			it('persists summaries to database and retrieves them', async () => {
				const input = new Map<string, Summary>([
					['src/a.ts', { path: 'src/a.ts', short: 'short1', long: 'long1', meta: { hash: 'h1' } }],
					['src/b.ts', { path: 'src/b.ts', short: 'short2', long: 'long2', meta: { hash: 'h2' } }],
				]);

				await store.push('test-repo', input);
				const result = await store.pull('test-repo');

				// Assert DATABASE STATE via pull
				expect(result.size).to.equal(2);
				expect(result.get('src/a.ts')).to.deep.equal(input.get('src/a.ts'));
				expect(result.get('src/b.ts')).to.deep.equal(input.get('src/b.ts'));
			});

			it('returns empty map when no summaries exist', async () => {
				const result = await store.pull('nonexistent-repo');
				expect(result.size).to.equal(0);
			});
		});

		describe('Upsert behavior', () => {
			it('updates existing summaries on conflict', async () => {
				// Initial push
				await store.push('repo', new Map([['file.ts', { path: 'file.ts', short: 'old short', long: 'old long', meta: { hash: 'v1' } }]]));

				// Update same file
				await store.push('repo', new Map([['file.ts', { path: 'file.ts', short: 'new short', long: 'new long', meta: { hash: 'v2' } }]]));

				// Verify only one row exists with updated content
				const result = await store.pull('repo');
				expect(result.size).to.equal(1);
				expect(result.get('file.ts')?.short).to.equal('new short');
				expect(result.get('file.ts')?.long).to.equal('new long');
				expect(result.get('file.ts')?.meta.hash).to.equal('v2');
			});

			it('handles mixed new and existing summaries', async () => {
				// Initial push
				await store.push('repo', new Map([['existing.ts', { path: 'existing.ts', short: 's', long: 'l', meta: { hash: 'old' } }]]));

				// Push with one existing and one new
				await store.push(
					'repo',
					new Map([
						['existing.ts', { path: 'existing.ts', short: 's', long: 'l', meta: { hash: 'updated' } }],
						['new.ts', { path: 'new.ts', short: 's', long: 'l', meta: { hash: 'new' } }],
					]),
				);

				const result = await store.pull('repo');
				expect(result.size).to.equal(2);
				expect(result.get('existing.ts')?.meta.hash).to.equal('updated');
				expect(result.get('new.ts')?.meta.hash).to.equal('new');
			});
		});

		describe('Delete behavior', () => {
			it('removes specified paths from database', async () => {
				await store.push(
					'repo',
					new Map([
						['a.ts', { path: 'a.ts', short: 's', long: 'l', meta: { hash: 'h' } }],
						['b.ts', { path: 'b.ts', short: 's', long: 'l', meta: { hash: 'h' } }],
						['c.ts', { path: 'c.ts', short: 's', long: 'l', meta: { hash: 'h' } }],
					]),
				);

				await store.delete('repo', ['a.ts', 'c.ts']);

				const result = await store.pull('repo');
				expect(result.size).to.equal(1);
				expect(result.has('a.ts')).to.be.false;
				expect(result.has('b.ts')).to.be.true;
				expect(result.has('c.ts')).to.be.false;
			});

			it('handles empty delete list gracefully', async () => {
				await store.push('repo', new Map([['a.ts', { path: 'a.ts', short: 's', long: 'l', meta: { hash: 'h' } }]]));

				await store.delete('repo', []);

				const result = await store.pull('repo');
				expect(result.size).to.equal(1);
			});

			it('handles deleting non-existent paths gracefully', async () => {
				await store.push('repo', new Map([['a.ts', { path: 'a.ts', short: 's', long: 'l', meta: { hash: 'h' } }]]));

				await store.delete('repo', ['nonexistent.ts']);

				const result = await store.pull('repo');
				expect(result.size).to.equal(1);
			});
		});

		describe('Repository isolation', () => {
			it('keeps summaries separate per repository', async () => {
				await store.push('repo-a', new Map([['file.ts', { path: 'file.ts', short: 'A', long: 'A', meta: { hash: 'a' } }]]));
				await store.push('repo-b', new Map([['file.ts', { path: 'file.ts', short: 'B', long: 'B', meta: { hash: 'b' } }]]));

				const resultA = await store.pull('repo-a');
				const resultB = await store.pull('repo-b');

				expect(resultA.get('file.ts')?.short).to.equal('A');
				expect(resultB.get('file.ts')?.short).to.equal('B');
			});

			it('deletes only affect the specified repository', async () => {
				await store.push('repo-a', new Map([['file.ts', { path: 'file.ts', short: 'A', long: 'A', meta: { hash: 'a' } }]]));
				await store.push('repo-b', new Map([['file.ts', { path: 'file.ts', short: 'B', long: 'B', meta: { hash: 'b' } }]]));

				await store.delete('repo-a', ['file.ts']);

				const resultA = await store.pull('repo-a');
				const resultB = await store.pull('repo-b');

				expect(resultA.size).to.equal(0);
				expect(resultB.size).to.equal(1);
			});
		});

		describe('Summary type storage', () => {
			it('stores correct summary types based on path', async () => {
				await store.push(
					'repo',
					new Map([
						['_project_summary', { path: '_project_summary', short: 's', long: 'l', meta: { hash: 'p' } }],
						['src/_index', { path: 'src/_index', short: 's', long: 'l', meta: { hash: 'f' } }],
						['src/file.ts', { path: 'src/file.ts', short: 's', long: 'l', meta: { hash: 'f' } }],
					]),
				);

				// Verify via raw query that types are correct
				const result = await pglite.query<{ file_path: string; summary_type: string }>(
					'SELECT file_path, summary_type FROM file_summaries WHERE repository_id = $1 ORDER BY file_path',
					['repo'],
				);

				const typeMap = new Map(result.rows.map((r) => [r.file_path, r.summary_type]));
				expect(typeMap.get('_project_summary')).to.equal('project');
				expect(typeMap.get('src/_index')).to.equal('folder');
				expect(typeMap.get('src/file.ts')).to.equal('file');
			});
		});

		describe('Empty operations', () => {
			it('handles push of empty map gracefully', async () => {
				await store.push('repo', new Map());
				const result = await store.pull('repo');
				expect(result.size).to.equal(0);
			});
		});
	});
});
