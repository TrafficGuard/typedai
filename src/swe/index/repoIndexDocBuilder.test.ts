import { createHash } from 'node:crypto';
import { promises as fsAsync } from 'node:fs';
import path from 'node:path';
import chai, { expect } from 'chai';
import chaiSubset from 'chai-subset';
import mock from 'mock-fs';
import sinon from 'sinon';
import { getFileSystem } from '#agent/agentContextLocalStorage';
import { typedaiDirName } from '#app/appDirs';
import { FileSystemService } from '#functions/storage/fileSystemService';
import type { LLM } from '#shared/llm/llm.model';
import { IndexDocBuilder, buildIndexDocs, getRepositoryOverview, loadBuildDocsSummaries } from '#swe/index/repoIndexDocBuilder';
import { AI_INFO_FILENAME } from '#swe/projectDetection';
import { setupConditionalLoggerOutput } from '#test/testUtils';

chai.use(chaiSubset);

const MOCK_REPO_ROOT = '/test-repo';

function hash(content: string): string {
	return createHash('md5').update(content).digest('hex');
}

async function fileExists(filePath: string): Promise<boolean> {
	return fsAsync
		.access(filePath)
		.then(() => true)
		.catch(() => false);
}

describe('IndexDocBuilder', () => {
	setupConditionalLoggerOutput();
	let builder: IndexDocBuilder;
	let mockFss: FileSystemService;
	let llm: sinon.SinonStubbedInstance<LLM>;
	let generateFileSummaryStub: sinon.SinonStub;
	let generateFolderSummaryStub: sinon.SinonStub;

	function setupMockFs(mockFileSystemConfig: any) {
		mock(mockFileSystemConfig);
		mockFss = new FileSystemService(MOCK_REPO_ROOT);
		sinon.stub(mockFss, 'getVcsRoot').returns(MOCK_REPO_ROOT);
		builder = new IndexDocBuilder(mockFss, llm, generateFileSummaryStub, generateFolderSummaryStub);
	}

	beforeEach(async () => {
		// DO NOT mock the filesystem here. It will be mocked in each test.
		// DO NOT instantiate mockFss or builder here. They will be instantiated in each test.
		llm = {
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

		generateFileSummaryStub = sinon.stub().resolves({ path: '', short: 'Mocked file short', long: 'Mocked file long', meta: { hash: 'file_hash_placeholder' } });
		generateFolderSummaryStub = sinon.stub().resolves({ path: '', short: 'Mocked folder short', long: 'Mocked folder long', meta: { hash: 'folder_hash_placeholder' } });

		// Default responses for direct LLM client calls (e.g., project overview)
		llm.generateText.resolves('Mocked project overview');
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
			setupMockFs({
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

			await builder.buildIndexDocsInternal();

			// Verify file summaries
			const summaryFile1Path = path.join(MOCK_REPO_ROOT, typedaiDirName, 'docs', 'src/swe/file1.ts.json');
			const summaryFile2Path = path.join(MOCK_REPO_ROOT, typedaiDirName, 'docs', 'src/swe/file2.ts.json');
			const summaryFile3Path = path.join(MOCK_REPO_ROOT, typedaiDirName, 'docs', 'src/swe/sub/file3.ts.json');

			expect(await fileExists(summaryFile1Path), 'file1.ts.json should exist').to.be.true;
			expect(await fileExists(summaryFile2Path), 'file2.ts.json should exist').to.be.true;
			expect(await fileExists(summaryFile3Path), 'file3.ts.json should exist').to.be.true;

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

			expect(await fileExists(summaryFolderSubPath), 'src/swe/sub/_index.json should exist').to.be.true;
			expect(await fileExists(summaryFolderSwePath), 'src/swe/_index.json should exist').to.be.true;
			expect(await fileExists(summaryFolderSrcPath), 'src/_index.json should exist').to.be.true;

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
			expect(await fileExists(projectSummaryPath), '_project_summary.json should exist').to.be.true;
			const projectSummary = JSON.parse(await fsAsync.readFile(projectSummaryPath, 'utf-8'));
			expect(projectSummary.projectOverview).to.equal('Mocked project overview');

			// Verify LLM calls
			expect(generateFileSummaryStub.callCount).to.equal(3);
			expect(generateFolderSummaryStub.callCount).to.equal(3);
			expect(llm.generateText.callCount).to.equal(1);

			const nonMatchingFileSummaryPath = path.join(MOCK_REPO_ROOT, typedaiDirName, 'docs', 'src/other.js.json');
			expect(await fileExists(nonMatchingFileSummaryPath), 'src/other.js.json should not exist').to.be.false;

			const nonMatchingFolderSummaryPath = path.join(MOCK_REPO_ROOT, typedaiDirName, 'docs', 'another/_index.json');
			expect(await fileExists(nonMatchingFolderSummaryPath), 'another/_index.json should not exist').to.be.false;
		});

		it('should delete orphaned summary files', async () => {
			const orphanedSummaryRelPath = 'orphaned/file.ts';

			setupMockFs({
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

			const orphanedSummaryFullPath = path.join(MOCK_REPO_ROOT, typedaiDirName, 'docs', 'orphaned/file.ts.json');
			expect(await fileExists(orphanedSummaryFullPath), 'Orphaned summary should exist initially').to.be.true;

			await builder.buildIndexDocsInternal();

			expect(await fileExists(orphanedSummaryFullPath), 'Orphaned summary should be deleted').to.be.false;
			const existingSummaryFullPath = path.join(MOCK_REPO_ROOT, typedaiDirName, 'docs', 'src/existing.ts.json');
			expect(await fileExists(existingSummaryFullPath), 'Existing summary should still exist').to.be.true;
		});

		it('should not regenerate summaries if content and children hashes are unchanged', async () => {
			const fileContent = 'content of file.ts';
			const aiConfig = [{ indexDocs: ['src/file.ts'] }];

			const initialFileHash = hash(fileContent);
			const initialFolderChildrenHash = hash(`src/file.ts:${initialFileHash}`);
			const initialProjectChildrenHash = hash(`src:${initialFolderChildrenHash}`);

			setupMockFs({
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

			await builder.buildIndexDocsInternal();

			expect(generateFileSummaryStub.called, 'generateFileSummary helper should not be called').to.be.false;
			expect(generateFolderSummaryStub.called, 'generateFolderSummary helper should not be called').to.be.false;
			expect(llm.generateText.called, 'Easy LLM generateText for project summary should not be called').to.be.false;
			expect(llm.generateJson.called, 'Medium LLM generateJson should not be called').to.be.false;
		});

		it('should regenerate file summary if file content changes', async () => {
			const oldFileContent = 'old content';
			const newFileContent = 'new content';
			const aiConfig = [{ indexDocs: ['src/file.ts'] }];
			const fileSummaryRelPath = 'src/file.ts';
			const fileSummaryJsonPath = path.join(typedaiDirName, 'docs', `${fileSummaryRelPath}.json`);

			setupMockFs({
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

			await fsAsync.writeFile(path.join(MOCK_REPO_ROOT, 'src/file.ts'), newFileContent);

			await builder.buildIndexDocsInternal();

			expect(generateFileSummaryStub.calledOnce, 'generateFileSummary helper should be called once for changed file').to.be.true;
			const summaryFile = JSON.parse(await fsAsync.readFile(path.join(MOCK_REPO_ROOT, fileSummaryJsonPath), 'utf-8'));
			expect(summaryFile.meta.hash).to.equal(hash(newFileContent));
			expect(generateFolderSummaryStub.called, 'generateFolderSummary helper for parent should be called').to.be.true;
			expect(llm.generateText.calledOnce, 'Easy LLM generateText for project summary should be called').to.be.true;
		});

		it('should handle missing AI_INFO_FILENAME gracefully', async () => {
			setupMockFs({
				[MOCK_REPO_ROOT]: {
					// AI_INFO_FILENAME is missing
				},
			});

			await expect(builder.buildIndexDocsInternal()).to.be.rejectedWith(Error, `${AI_INFO_FILENAME} not found`);
		});

		it('should handle empty indexDocs in AI_INFO_FILENAME', async () => {
			setupMockFs({
				[MOCK_REPO_ROOT]: {
					[AI_INFO_FILENAME]: JSON.stringify([{ indexDocs: [] }]),
					src: { 'file.ts': 'content' },
					[typedaiDirName]: { docs: {} },
				},
			});

			await builder.buildIndexDocsInternal();

			expect(generateFileSummaryStub.called).to.be.false;
			expect(generateFolderSummaryStub.called).to.be.false;
			expect(llm.generateText.calledOnce).to.be.true;
		});
	});

	describe('loadBuildDocsSummariesInternal', () => {
		it('should load existing summaries', async () => {
			const summary1Path = 'src/file1.ts';
			const summary1Content = { path: summary1Path, short: 's1', long: 'l1', meta: { hash: 'h1' } };
			setupMockFs({
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

			const summaries = await builder.loadBuildDocsSummariesInternal();
			expect(summaries.size).to.equal(1);
			expect(summaries.get(summary1Path)).to.deep.equal(summary1Content);
		});
	});

	describe('getTopLevelSummaryInternal', () => {
		it('should return project overview from _project_summary.json', async () => {
			const overview = 'Test Project Overview';
			setupMockFs({
				[MOCK_REPO_ROOT]: {
					[typedaiDirName]: {
						docs: {
							'_project_summary.json': JSON.stringify({ projectOverview: overview, meta: { hash: 'h' } }),
						},
					},
				},
			});

			const result = await builder.getTopLevelSummaryInternal();
			expect(result).to.equal(overview);
		});

		it('should return empty string if _project_summary.json is missing', async () => {
			setupMockFs({
				[MOCK_REPO_ROOT]: {
					[typedaiDirName]: {
						docs: {
							/* _project_summary.json is missing */
						},
					},
				},
			});

			const result = await builder.getTopLevelSummaryInternal();
			expect(result).to.equal('');
		});
	});
});

// Minimal tests for exported functions to ensure they setup and call the builder
describe('Exported repoIndexDocBuilder functions', () => {
	let llm: sinon.SinonStubbedInstance<LLM>;
	// No need for builderInstanceStub if spying on prototype

	beforeEach(async () => {
		// Set up a mock filesystem needed for the functions to run
		mock({
			[MOCK_REPO_ROOT]: {
				[AI_INFO_FILENAME]: JSON.stringify([{ indexDocs: ['src/file.ts'] }]),
				src: { 'file.ts': 'content' },
			},
		});
		const fss = new FileSystemService(MOCK_REPO_ROOT);
		sinon.stub(fss, 'getVcsRoot').returns(MOCK_REPO_ROOT);

		llm = {
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

		// Configure the LLM stubs to return the data needed to prevent the error
		(llm.generateJson as sinon.SinonStub).resolves({
			short: 'One-sentence file summary',
			long: 'Detailed paragraph describing the file',
		});
		(llm.generateText as sinon.SinonStub).resolves('Mocked project overview');
	});

	afterEach(async () => {
		sinon.restore();
		mock.restore(); // Restore the real filesystem
	});

	it('buildIndexDocs exported function should run', async () => {
		const buildInternalSpy = sinon.spy(IndexDocBuilder.prototype, 'buildIndexDocsInternal');
		const fileSumStub = sinon.stub().resolves({ short: 'One-sentence file summary', long: 'Detailed paragraph', meta: { hash: 'h' }, path: '' });
		const folderSumStub = sinon.stub().resolves({ short: 'folder', long: 'folder', meta: { hash: 'h' }, path: '' });
		await buildIndexDocs(llm, fss, fileSumStub, folderSumStub);
		expect(buildInternalSpy.calledOnce).to.be.true;
		buildInternalSpy.restore(); // Restore spy on prototype
	});

	it('loadBuildDocsSummaries exported function should run', async () => {
		const loadInternalSpy = sinon.spy(IndexDocBuilder.prototype, 'loadBuildDocsSummariesInternal');
		await loadBuildDocsSummaries(fss);
		expect(loadInternalSpy.calledOnceWith()).to.be.true;
		loadInternalSpy.restore();
	});

	it('getRepositoryOverview exported function should run', async () => {
		const getOverviewInternalSpy = sinon.spy(IndexDocBuilder.prototype, 'getTopLevelSummaryInternal');
		await getRepositoryOverview(fss);
		expect(getOverviewInternalSpy.calledOnce).to.be.true;
		getOverviewInternalSpy.restore();
	});
});
