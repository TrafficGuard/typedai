import { createHash } from 'node:crypto';
import { promises as fsAsync } from 'node:fs';
import path from 'node:path';
import chai, { expect } from 'chai';
import chaiSubset from 'chai-subset';
import mock from 'mock-fs';
import sinon from 'sinon';
// import { getFileSystem, llms } from '#agent/agentContextLocalStorage'; // No longer needed for direct stubbing here
import { typedaiDirName } from '#app/appDirs';
import { FileSystemService } from '#functions/storage/fileSystemService';
import { logger } from '#o11y/logger';
import type { LLM } from '#shared/llm/llm.model';
import { IndexDocBuilder, buildIndexDocs, getRepositoryOverview, loadBuildDocsSummaries } from '#swe/index/repoIndexDocBuilder';
import { AI_INFO_FILENAME } from '#swe/projectDetection';
import { errorToString } from '#utils/errors';
import * as llmSummaries from './llmSummaries'; // To stub its functions

// Enable chai-subset
chai.use(chaiSubset);

const MOCK_REPO_ROOT = '/test-repo';

function hash(content: string): string {
	return createHash('md5').update(content).digest('hex');
}

describe.only('IndexDocBuilder', () => {
	let builder: IndexDocBuilder;
	let mockFss: FileSystemService;
	let mockEasyLlmClient: sinon.SinonStubbedInstance<LLM>;
	let mockMediumLlmClient: sinon.SinonStubbedInstance<LLM>;
	let generateFileSummaryStub: sinon.SinonStub;
	let generateFolderSummaryStub: sinon.SinonStub;
	let loggerInfoStub: sinon.SinonStub;
	let loggerWarnStub: sinon.SinonStub;
	let loggerErrorStub: sinon.SinonStub;
	let loggerDebugStub: sinon.SinonStub;

	beforeEach(async () => {
		// DO NOT mock the filesystem here. It will be mocked in each test.
		// DO NOT instantiate mockFss or builder here. They will be instantiated in each test.

		// Create stubbed LLM clients
		mockEasyLlmClient = {
			generateText: sinon.stub(),
			generateTextWithJson: sinon.stub(),
			generateJson: sinon.stub(),
			generateTextWithResult: sinon.stub(),
			generateMessage: sinon.stub(),
			streamText: sinon.stub(),
			getService: sinon.stub(),
			getModel: sinon.stub(),
			getDisplayName: sinon.stub(),
			getId: sinon.stub(),
			getMaxInputTokens: sinon.stub(),
			countTokens: sinon.stub(),
			isConfigured: sinon.stub(),
			getOldModels: sinon.stub(),
		} as sinon.SinonStubbedInstance<LLM>;
		mockMediumLlmClient = {
			generateText: sinon.stub(),
			generateTextWithJson: sinon.stub(),
			generateJson: sinon.stub(),
			generateTextWithResult: sinon.stub(),
			generateMessage: sinon.stub(),
			streamText: sinon.stub(),
			getService: sinon.stub(),
			getModel: sinon.stub(),
			getDisplayName: sinon.stub(),
			getId: sinon.stub(),
			getMaxInputTokens: sinon.stub(),
			countTokens: sinon.stub(),
			isConfigured: sinon.stub(),
			getOldModels: sinon.stub(),
		} as sinon.SinonStubbedInstance<LLM>;

		generateFileSummaryStub = sinon.stub(llmSummaries, 'generateFileSummary');
		generateFolderSummaryStub = sinon.stub(llmSummaries, 'generateFolderSummary');

		loggerInfoStub = sinon.stub(logger, 'info');
		loggerWarnStub = sinon.stub(logger, 'warn');
		loggerErrorStub = sinon.stub(logger, 'error');
		loggerDebugStub = sinon.stub(logger, 'debug');

		// Default responses for llmSummaries stubs
		generateFileSummaryStub.resolves({ path: '', short: 'Mocked file short', long: 'Mocked file long', meta: { hash: 'file_hash_placeholder' } });
		generateFolderSummaryStub.resolves({ path: '', short: 'Mocked folder short', long: 'Mocked folder long', meta: { hash: 'folder_hash_placeholder' } });

		// Default responses for direct LLM client calls (e.g., project overview)
		mockEasyLlmClient.generateText.resolves('Mocked project overview');
	});

	afterEach(() => {
		sinon.restore();
		mock.restore(); // Crucial to restore the filesystem after each test
	});

	describe('buildIndexDocsInternal', () => {
		it('should correctly generate summaries for files and folders matching wildcard patterns', async () => {
			const file1Content = 'content of file1.ts';
			const file2Content = 'content of file2.ts';
			const file3Content = 'content of file3.ts';

			const aiConfig = [{ indexDocs: ['src/swe/**/*.ts'] }];
			mock({ // Test-specific mock setup
				[MOCK_REPO_ROOT]: {
					[AI_INFO_FILENAME]: JSON.stringify(aiConfig),
					src: {
						'other.js': 'some js content',
						swe: {
							'file1.ts': file1Content,
							'file2.ts': file2Content,
							sub: {
								'file3.ts': file3Content,
								'not-a-ts.txt': 'some text',
							},
						},
					},
					another: {
						'another.ts': 'another ts file content',
					},
					[typedaiDirName]: { docs: {} },
				},
			});

			// Instantiate FSS and Builder AFTER mocking the filesystem for this test
			mockFss = new FileSystemService();
			mockFss.setWorkingDirectoryUnsafe(MOCK_REPO_ROOT);
			builder = new IndexDocBuilder(mockFss, { easy: mockEasyLlmClient, medium: mockMediumLlmClient });

			await builder.buildIndexDocsInternal();

			// Verify file summaries
			const summaryFile1Path = path.join(MOCK_REPO_ROOT, typedaiDirName, 'docs', 'src/swe/file1.ts.json');
			const summaryFile2Path = path.join(MOCK_REPO_ROOT, typedaiDirName, 'docs', 'src/swe/file2.ts.json');
			const summaryFile3Path = path.join(MOCK_REPO_ROOT, typedaiDirName, 'docs', 'src/swe/sub/file3.ts.json');

			expect(
				await fsAsync
					.access(summaryFile1Path)
					.then(() => true)
					.catch(() => false),
				'file1.ts.json should exist',
			).to.be.true;
			expect(
				await fsAsync
					.access(summaryFile2Path)
					.then(() => true)
					.catch(() => false),
				'file2.ts.json should exist',
			).to.be.true;
			expect(
				await fsAsync
					.access(summaryFile3Path)
					.then(() => true)
					.catch(() => false),
				'file3.ts.json should exist',
			).to.be.true;

			const summaryFile1 = JSON.parse(await fsAsync.readFile(summaryFile1Path, 'utf-8'));
			expect(summaryFile1).to.containSubset({
				path: 'src/swe/file1.ts',
				short: 'Mocked file short',
				long: 'Mocked file long',
				meta: { hash: hash(file1Content) },
			});

			// Verify folder summaries
			const summaryFolderSubPath = path.join(MOCK_REPO_ROOT, typedaiDirName, 'docs', 'src/swe/sub/_index.json');
			const summaryFolderSwePath = path.join(MOCK_REPO_ROOT, typedaiDirName, 'docs', 'src/swe/_index.json');
			const summaryFolderSrcPath = path.join(MOCK_REPO_ROOT, typedaiDirName, 'docs', 'src/_index.json');

			expect(
				await fsAsync
					.access(summaryFolderSubPath)
					.then(() => true)
					.catch(() => false),
				'src/swe/sub/_index.json should exist',
			).to.be.true;
			expect(
				await fsAsync
					.access(summaryFolderSwePath)
					.then(() => true)
					.catch(() => false),
				'src/swe/_index.json should exist',
			).to.be.true;
			expect(
				await fsAsync
					.access(summaryFolderSrcPath)
					.then(() => true)
					.catch(() => false),
				'src/_index.json should exist',
			).to.be.true;

			const summaryFolderSub = JSON.parse(await fsAsync.readFile(summaryFolderSubPath, 'utf-8'));
			const expectedSubChildrenHash = hash(`src/swe/sub/file3.ts:${hash(file3Content)}`);
			expect(summaryFolderSub).to.containSubset({
				path: 'src/swe/sub',
				short: 'Mocked folder short',
				long: 'Mocked folder long',
				meta: { hash: expectedSubChildrenHash },
			});

			// Verify project summary
			const projectSummaryPath = path.join(MOCK_REPO_ROOT, typedaiDirName, 'docs', '_project_summary.json');
			expect(
				await fsAsync
					.access(projectSummaryPath)
					.then(() => true)
					.catch(() => false),
				'_project_summary.json should exist',
			).to.be.true;
			const projectSummary = JSON.parse(await fsAsync.readFile(projectSummaryPath, 'utf-8'));
			expect(projectSummary.projectOverview).to.equal('Mocked project overview');

			// Verify LLM calls
			expect(generateFileSummaryStub.callCount).to.equal(3);
			expect(generateFolderSummaryStub.callCount).to.equal(3);
			expect(mockEasyLlmClient.generateText.callCount).to.equal(1);

			const nonMatchingFileSummaryPath = path.join(MOCK_REPO_ROOT, typedaiDirName, 'docs', 'src/other.js.json');
			expect(
				await fsAsync
					.access(nonMatchingFileSummaryPath)
					.then(() => true)
					.catch(() => false),
				'src/other.js.json should not exist',
			).to.be.false;

			const nonMatchingFolderSummaryPath = path.join(MOCK_REPO_ROOT, typedaiDirName, 'docs', 'another/_index.json');
			expect(
				await fsAsync
					.access(nonMatchingFolderSummaryPath)
					.then(() => true)
					.catch(() => false),
				'another/_index.json should not exist',
			).to.be.false;
		});

		it('should delete orphaned summary files', async () => {
			const orphanedSummaryRelPath = 'orphaned/file.ts';
			// const orphanedSummaryJsonPath = path.join(typedaiDirName, 'docs', `${orphanedSummaryRelPath}.json`); // Not used

			mock({ // Test-specific mock setup
				[MOCK_REPO_ROOT]: {
					[AI_INFO_FILENAME]: JSON.stringify([{ indexDocs: ['src/**/*.ts'] }]),
					src: {
						'existing.ts': 'content',
					},
					[typedaiDirName]: {
						docs: {
							src: {
								'existing.ts.json': JSON.stringify({ path: 'src/existing.ts', short: 's', long: 'l', meta: { hash: 'h1' } }),
							},
							orphaned: {
								'file.ts.json': JSON.stringify({ path: orphanedSummaryRelPath, short: 's', long: 'l', meta: { hash: 'h_orphan' } }),
							},
						},
					},
				},
			});

			// Instantiate FSS and Builder AFTER mocking
			mockFss = new FileSystemService();
			mockFss.setWorkingDirectoryUnsafe(MOCK_REPO_ROOT);
			builder = new IndexDocBuilder(mockFss, { easy: mockEasyLlmClient, medium: mockMediumLlmClient });

			const orphanedSummaryFullPath = path.join(MOCK_REPO_ROOT, typedaiDirName, 'docs', 'orphaned/file.ts.json');
			expect(
				await fsAsync
					.access(orphanedSummaryFullPath)
					.then(() => true)
					.catch(() => false),
				'Orphaned summary should exist initially',
			).to.be.true;

			await builder.buildIndexDocsInternal();

			expect(
				await fsAsync
					.access(orphanedSummaryFullPath)
					.then(() => true)
					.catch(() => false),
				'Orphaned summary should be deleted',
			).to.be.false;
			const existingSummaryFullPath = path.join(MOCK_REPO_ROOT, typedaiDirName, 'docs', 'src/existing.ts.json');
			expect(
				await fsAsync
					.access(existingSummaryFullPath)
					.then(() => true)
					.catch(() => false),
				'Existing summary should still exist',
			).to.be.true;
		});

		it('should not regenerate summaries if content and children hashes are unchanged', async () => {
			const fileContent = 'content of file.ts';
			const aiConfig = [{ indexDocs: ['src/file.ts'] }];
			// const fileSummaryPath = path.join(typedaiDirName, 'docs', 'src/file.ts.json'); // Not used
			// const folderSummaryPath = path.join(typedaiDirName, 'docs', 'src/_index.json'); // Not used
			// const projectSummaryPath = path.join(typedaiDirName, 'docs', '_project_summary.json'); // Not used

			const initialFileHash = hash(fileContent);
			const initialFolderChildrenHash = hash(`src/file.ts:${initialFileHash}`);
			const initialProjectChildrenHash = hash(`src:${initialFolderChildrenHash}`);

			mock({ // Test-specific mock setup
				[MOCK_REPO_ROOT]: {
					[AI_INFO_FILENAME]: JSON.stringify(aiConfig),
					src: {
						'file.ts': fileContent,
					},
					[typedaiDirName]: {
						docs: {
							src: {
								'file.ts.json': JSON.stringify({ path: 'src/file.ts', short: 's', long: 'l', meta: { hash: initialFileHash } }),
								'_index.json': JSON.stringify({ path: 'src', short: 's', long: 'l', meta: { hash: initialFolderChildrenHash } }),
							},
							'_project_summary.json': JSON.stringify({ projectOverview: 'overview', meta: { hash: initialProjectChildrenHash } }),
						},
					},
				},
			});

			// Instantiate FSS and Builder AFTER mocking
			mockFss = new FileSystemService();
			mockFss.setWorkingDirectoryUnsafe(MOCK_REPO_ROOT);
			builder = new IndexDocBuilder(mockFss, { easy: mockEasyLlmClient, medium: mockMediumLlmClient });

			await builder.buildIndexDocsInternal();

			expect(generateFileSummaryStub.called, 'generateFileSummary helper should not be called').to.be.false;
			expect(generateFolderSummaryStub.called, 'generateFolderSummary helper should not be called').to.be.false;
			expect(mockEasyLlmClient.generateText.called, 'Easy LLM generateText for project summary should not be called').to.be.false;
			expect(mockMediumLlmClient.generateJson.called, 'Medium LLM generateJson should not be called').to.be.false;
		});

		it('should regenerate file summary if file content changes', async () => {
			const oldFileContent = 'old content';
			const newFileContent = 'new content';
			const aiConfig = [{ indexDocs: ['src/file.ts'] }];
			const fileSummaryRelPath = 'src/file.ts';
			const fileSummaryJsonPath = path.join(typedaiDirName, 'docs', `${fileSummaryRelPath}.json`);

			mock({ // Test-specific mock setup
				[MOCK_REPO_ROOT]: {
					[AI_INFO_FILENAME]: JSON.stringify(aiConfig),
					src: {
						'file.ts': oldFileContent,
					},
					[typedaiDirName]: {
						docs: {
							src: {
								'file.ts.json': JSON.stringify({ path: fileSummaryRelPath, short: 's', long: 'l', meta: { hash: hash(oldFileContent) } }),
								'_index.json': JSON.stringify({ path: 'src', short: 's', long: 'l', meta: { hash: 'folder_h' } }),
							},
							'_project_summary.json': JSON.stringify({ projectOverview: 'overview', meta: { hash: 'project_h' } }),
						},
					},
				},
			});

			// Instantiate FSS and Builder AFTER mocking
			mockFss = new FileSystemService();
			mockFss.setWorkingDirectoryUnsafe(MOCK_REPO_ROOT);
			builder = new IndexDocBuilder(mockFss, { easy: mockEasyLlmClient, medium: mockMediumLlmClient });

			await fsAsync.writeFile(path.join(MOCK_REPO_ROOT, 'src/file.ts'), newFileContent);

			await builder.buildIndexDocsInternal();

			expect(generateFileSummaryStub.calledOnce, 'generateFileSummary helper should be called once for changed file').to.be.true;
			const summaryFile = JSON.parse(await fsAsync.readFile(path.join(MOCK_REPO_ROOT, fileSummaryJsonPath), 'utf-8'));
			expect(summaryFile.meta.hash).to.equal(hash(newFileContent));
			expect(generateFolderSummaryStub.called, 'generateFolderSummary helper for parent should be called').to.be.true;
			expect(mockEasyLlmClient.generateText.calledOnce, 'Easy LLM generateText for project summary should be called').to.be.true;
		});

		it('should handle missing AI_INFO_FILENAME gracefully', async () => {
			mock({ // Test-specific mock setup
				[MOCK_REPO_ROOT]: {
					// AI_INFO_FILENAME is missing
				},
			});

			// Instantiate FSS and Builder AFTER mocking
			mockFss = new FileSystemService();
			mockFss.setWorkingDirectoryUnsafe(MOCK_REPO_ROOT);
			builder = new IndexDocBuilder(mockFss, { easy: mockEasyLlmClient, medium: mockMediumLlmClient });

			await expect(builder.buildIndexDocsInternal()).to.be.rejectedWith(Error, `${AI_INFO_FILENAME} not found`);
		});

		it('should handle empty indexDocs in AI_INFO_FILENAME', async () => {
			mock({ // Test-specific mock setup
				[MOCK_REPO_ROOT]: {
					[AI_INFO_FILENAME]: JSON.stringify([{ indexDocs: [] }]),
					src: { 'file.ts': 'content' },
					[typedaiDirName]: { docs: {} },
				},
			});

			// Instantiate FSS and Builder AFTER mocking
			mockFss = new FileSystemService();
			mockFss.setWorkingDirectoryUnsafe(MOCK_REPO_ROOT);
			builder = new IndexDocBuilder(mockFss, { easy: mockEasyLlmClient, medium: mockMediumLlmClient });

			await builder.buildIndexDocsInternal();

			expect(loggerWarnStub.calledWithMatch('No indexDocs patterns found')).to.be.true;
			expect(generateFileSummaryStub.called).to.be.false;
			expect(generateFolderSummaryStub.called).to.be.false;
			expect(mockEasyLlmClient.generateText.calledOnce).to.be.true;
		});
	});

	describe('loadBuildDocsSummariesInternal', () => {
		it('should load existing summaries', async () => {
			const summary1Path = 'src/file1.ts';
			const summary1Content = { path: summary1Path, short: 's1', long: 'l1', meta: { hash: 'h1' } };
			mock({ // Test-specific mock setup
				[MOCK_REPO_ROOT]: {
					[typedaiDirName]: {
						docs: {
							src: {
								'file1.ts.json': JSON.stringify(summary1Content),
							},
							'_project_summary.json': JSON.stringify({ projectOverview: 'overview', meta: { hash: 'ph' } }),
						},
					},
				},
			});

			// Instantiate FSS and Builder AFTER mocking
			mockFss = new FileSystemService();
			mockFss.setWorkingDirectoryUnsafe(MOCK_REPO_ROOT);
			builder = new IndexDocBuilder(mockFss, { easy: mockEasyLlmClient, medium: mockMediumLlmClient });

			const summaries = await builder.loadBuildDocsSummariesInternal();
			expect(summaries.size).to.equal(1);
			expect(summaries.get(summary1Path)).to.deep.equal(summary1Content);
		});

		it('should call buildIndexDocsInternal if createIfNotExits is true and docs dir is missing', async () => {
			mock({ // Test-specific mock setup
				[MOCK_REPO_ROOT]: {
					[AI_INFO_FILENAME]: JSON.stringify([{ indexDocs: ['src/file.ts'] }]),
					src: { 'file.ts': 'content' },
				},
			});

			// Instantiate FSS and Builder AFTER mocking
			mockFss = new FileSystemService();
			mockFss.setWorkingDirectoryUnsafe(MOCK_REPO_ROOT);
			builder = new IndexDocBuilder(mockFss, { easy: mockEasyLlmClient, medium: mockMediumLlmClient });
			const buildInternalStub = sinon.stub(builder, 'buildIndexDocsInternal').resolves();

			await builder.loadBuildDocsSummariesInternal(true);

			expect(buildInternalStub.calledOnce).to.be.true;
		});
	});

	describe('getTopLevelSummaryInternal', () => {
		it('should return project overview from _project_summary.json', async () => {
			const overview = 'Test Project Overview';
			mock({ // Test-specific mock setup
				[MOCK_REPO_ROOT]: {
					[typedaiDirName]: {
						docs: {
							'_project_summary.json': JSON.stringify({ projectOverview: overview, meta: { hash: 'h' } }),
						},
					},
				},
			});

			// Instantiate FSS and Builder AFTER mocking
			mockFss = new FileSystemService();
			mockFss.setWorkingDirectoryUnsafe(MOCK_REPO_ROOT);
			builder = new IndexDocBuilder(mockFss, { easy: mockEasyLlmClient, medium: mockMediumLlmClient });

			const result = await builder.getTopLevelSummaryInternal();
			expect(result).to.equal(overview);
		});

		it('should return empty string if _project_summary.json is missing', async () => {
			mock({ // Test-specific mock setup
				[MOCK_REPO_ROOT]: {
					[typedaiDirName]: {
						docs: {
							/* _project_summary.json is missing */
						},
					},
				},
			});

			// Instantiate FSS and Builder AFTER mocking
			mockFss = new FileSystemService();
			mockFss.setWorkingDirectoryUnsafe(MOCK_REPO_ROOT);
			builder = new IndexDocBuilder(mockFss, { easy: mockEasyLlmClient, medium: mockMediumLlmClient });

			const result = await builder.getTopLevelSummaryInternal();
			expect(result).to.equal('');
		});
	});
});

// Minimal tests for exported functions to ensure they setup and call the builder
describe('Exported repoIndexDocBuilder functions', () => {
	let mockEasyLlmForExported: sinon.SinonStubbedInstance<LLM>;
	let mockMediumLlmForExported: sinon.SinonStubbedInstance<LLM>;
	// No need for builderInstanceStub if spying on prototype

	beforeEach(async () => {
		mockEasyLlmForExported = {
			generateText: sinon.stub(),
			generateTextWithJson: sinon.stub(),
			generateJson: sinon.stub(),
			generateTextWithResult: sinon.stub(),
			generateMessage: sinon.stub(),
			streamText: sinon.stub(),
			getService: sinon.stub(),
			getModel: sinon.stub(),
			getDisplayName: sinon.stub(),
			getId: sinon.stub(),
			getMaxInputTokens: sinon.stub(),
			countTokens: sinon.stub(),
			isConfigured: sinon.stub(),
			getOldModels: sinon.stub(),
		} as sinon.SinonStubbedInstance<LLM>;
		mockMediumLlmForExported = {
			generateText: sinon.stub(),
			generateTextWithJson: sinon.stub(),
			generateJson: sinon.stub(),
			generateTextWithResult: sinon.stub(),
			generateMessage: sinon.stub(),
			streamText: sinon.stub(),
			getService: sinon.stub(),
			getModel: sinon.stub(),
			getDisplayName: sinon.stub(),
			getId: sinon.stub(),
			getMaxInputTokens: sinon.stub(),
			countTokens: sinon.stub(),
			isConfigured: sinon.stub(),
			getOldModels: sinon.stub(),
		} as sinon.SinonStubbedInstance<LLM>;

		// If getFileSystem() or llms() are used by the exported functions to create IndexDocBuilder,
		// they would need to be stubbed here to return appropriate mocks.
		// For example:
		// sinon.stub(agentContextLocalStorage, 'getFileSystem').returns(sinon.createStubInstance(FileSystemService));
		// sinon.stub(agentContextLocalStorage, 'llms').returns({ easy: mockEasyLlmForExported, medium: mockMediumLlmForExported });
	});

	afterEach(async () => {
		sinon.restore();
		// mock.restore(); // Only if mock-fs was used in this describe block's tests
	});

	it('buildIndexDocs exported function should run', async () => {
		const buildInternalSpy = sinon.spy(IndexDocBuilder.prototype, 'buildIndexDocsInternal');
		// This test assumes that getFileSystem() and llms() will provide valid (even if unmocked for deep behavior)
		// instances for the IndexDocBuilder constructor.
		await buildIndexDocs();
		expect(buildInternalSpy.calledOnce).to.be.true;
		buildInternalSpy.restore(); // Restore spy on prototype
	});

	it('loadBuildDocsSummaries exported function should run', async () => {
		const loadInternalSpy = sinon.spy(IndexDocBuilder.prototype, 'loadBuildDocsSummariesInternal');
		await loadBuildDocsSummaries(false);
		expect(loadInternalSpy.calledOnceWith(false)).to.be.true;
		loadInternalSpy.restore();
	});

	it('getRepositoryOverview exported function should run', async () => {
		const getOverviewInternalSpy = sinon.spy(IndexDocBuilder.prototype, 'getTopLevelSummaryInternal');
		// (mockEasyLlmForExported.generateText as sinon.SinonStub).resolves('overview'); // Not strictly needed if only spying on prototype
		await getRepositoryOverview();
		expect(getOverviewInternalSpy.calledOnce).to.be.true;
		getOverviewInternalSpy.restore();
	});
});
