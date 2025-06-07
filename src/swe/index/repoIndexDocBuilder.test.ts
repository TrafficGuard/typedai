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
import { AI_INFO_FILENAME } from '#swe/projectDetection';
import { IndexDocBuilder, buildIndexDocs, loadBuildDocsSummaries, getRepositoryOverview } from '#swe/index/repoIndexDocBuilder';
import * as llmSummaries from './llmSummaries'; // To stub its functions
import { LLM as LLMClientInterface, GenerateJsonOptions, GenerateTextOptions, GenerateTextWithJsonResponse, LlmMessage, SystemUserPrompt, TextStreamPart, GenerationStats } from '#shared/llm/llm.model';

// Enable chai-subset
chai.use(chaiSubset);

const MOCK_REPO_ROOT = '/test-repo';

function hash(content: string): string {
	return createHash('md5').update(content).digest('hex');
}

describe('IndexDocBuilder', () => {
	let builder: IndexDocBuilder;
	let mockFss: FileSystemService;
	let mockEasyLlmClient: sinon.SinonStubbedInstance<LLMClientInterface>;
	let mockMediumLlmClient: sinon.SinonStubbedInstance<LLMClientInterface>;
	let generateFileSummaryStub: sinon.SinonStub;
	let generateFolderSummaryStub: sinon.SinonStub;
	let loggerInfoStub: sinon.SinonStub;
	let loggerWarnStub: sinon.SinonStub;
	let loggerErrorStub: sinon.SinonStub;
	let loggerDebugStub: sinon.SinonStub;

	beforeEach(async () => {
		// Mock the filesystem first. Specific structures per test.
		mock({ [MOCK_REPO_ROOT]: {} });

		mockFss = new FileSystemService();
		// FileSystemService constructor uses process.cwd(), which mock-fs changes.
		// Explicitly set working directory if needed, or ensure it's correct.
		// Forcing it here to be sure, as order of beforeEach parts might matter
		mockFss.setWorkingDirectoryUnsafe(MOCK_REPO_ROOT);


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
		} as sinon.SinonStubbedInstance<LLMClientInterface>;
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
		} as sinon.SinonStubbedInstance<LLMClientInterface>;
		
		generateFileSummaryStub = sinon.stub(llmSummaries, 'generateFileSummary');
		generateFolderSummaryStub = sinon.stub(llmSummaries, 'generateFolderSummary');

		loggerInfoStub = sinon.stub(logger, 'info');
		loggerWarnStub = sinon.stub(logger, 'warn');
		loggerErrorStub = sinon.stub(logger, 'error');
		loggerDebugStub = sinon.stub(logger, 'debug');
		
		builder = new IndexDocBuilder(mockFss, { easy: mockEasyLlmClient, medium: mockMediumLlmClient });

		// Default responses for llmSummaries stubs
		// These stubs are for the helper functions in llmSummaries.ts, not direct LLM client calls
		generateFileSummaryStub.resolves({ path: '', short: 'Mocked file short', long: 'Mocked file long', meta: { hash: 'file_hash_placeholder'} });
		generateFolderSummaryStub.resolves({ path: '', short: 'Mocked folder short', long: 'Mocked folder long', meta: { hash: 'folder_hash_placeholder'} });
		
		// Default responses for direct LLM client calls (e.g., project overview)
		mockEasyLlmClient.generateText.resolves('Mocked project overview');
	});

	afterEach(() => {
		sinon.restore();
		mock.restore();
	});

	describe('buildIndexDocsInternal', () => {
		it('should correctly generate summaries for files and folders matching wildcard patterns', async () => {
			const file1Content = 'content of file1.ts';
			const file2Content = 'content of file2.ts';
			const file3Content = 'content of file3.ts';

			const aiConfig = [{ indexDocs: ['src/swe/**/*.ts'] }];
			mock({
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
					[typedaiDirName]: { docs: {} }
				},
			});
            // mockFss's working directory is set in beforeEach after mock()
            // Re-initialize builder if mock structure changes CWD expectations for FSS significantly,
            // but here it should be fine as MOCK_REPO_ROOT is consistent.

			await builder.buildIndexDocsInternal();

			// Verify file summaries
			const summaryFile1Path = path.join(MOCK_REPO_ROOT, typedaiDirName, 'docs', 'src/swe/file1.ts.json');
			const summaryFile2Path = path.join(MOCK_REPO_ROOT, typedaiDirName, 'docs', 'src/swe/file2.ts.json');
			const summaryFile3Path = path.join(MOCK_REPO_ROOT, typedaiDirName, 'docs', 'src/swe/sub/file3.ts.json');

			expect(await fsAsync.access(summaryFile1Path).then(() => true).catch(() => false), 'file1.ts.json should exist').to.be.true;
			expect(await fsAsync.access(summaryFile2Path).then(() => true).catch(() => false), 'file2.ts.json should exist').to.be.true;
			expect(await fsAsync.access(summaryFile3Path).then(() => true).catch(() => false), 'file3.ts.json should exist').to.be.true;

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

			expect(await fsAsync.access(summaryFolderSubPath).then(() => true).catch(() => false), 'src/swe/sub/_index.json should exist').to.be.true;
			expect(await fsAsync.access(summaryFolderSwePath).then(() => true).catch(() => false), 'src/swe/_index.json should exist').to.be.true;
			expect(await fsAsync.access(summaryFolderSrcPath).then(() => true).catch(() => false), 'src/_index.json should exist').to.be.true;

			const summaryFolderSub = JSON.parse(await fsAsync.readFile(summaryFolderSubPath, 'utf-8'));
			const expectedSubChildrenHash = hash(`src/swe/sub/file3.ts.json:${hash(file3Content)}`);
			expect(summaryFolderSub).to.containSubset({
				path: 'src/swe/sub',
				short: 'Mocked folder short',
				long: 'Mocked folder long',
				meta: { hash: expectedSubChildrenHash },
			});

			// Verify project summary
			const projectSummaryPath = path.join(MOCK_REPO_ROOT, typedaiDirName, 'docs', '_project_summary.json');
			expect(await fsAsync.access(projectSummaryPath).then(() => true).catch(() => false), '_project_summary.json should exist').to.be.true;
			const projectSummary = JSON.parse(await fsAsync.readFile(projectSummaryPath, 'utf-8'));
			expect(projectSummary.projectOverview).to.equal('Mocked project overview');

			// Verify LLM calls
			// generateFileSummaryStub is called with the LLM client instance
			expect(generateFileSummaryStub.callCount).to.equal(3);
			expect(generateFolderSummaryStub.callCount).to.equal(3);
			expect(mockEasyLlmClient.generateText.callCount).to.equal(1); // Project overview uses easy LLM

			// Check that non-matching files/folders were not processed
			const nonMatchingFileSummaryPath = path.join(MOCK_REPO_ROOT, typedaiDirName, 'docs', 'src/other.js.json');
			expect(await fsAsync.access(nonMatchingFileSummaryPath).then(() => true).catch(() => false), 'src/other.js.json should not exist').to.be.false;

			const nonMatchingFolderSummaryPath = path.join(MOCK_REPO_ROOT, typedaiDirName, 'docs', 'another/_index.json');
			expect(await fsAsync.access(nonMatchingFolderSummaryPath).then(() => true).catch(() => false), 'another/_index.json should not exist').to.be.false;
		});

		it('should delete orphaned summary files', async () => {
			const orphanedSummaryRelPath = 'orphaned/file.ts';
			const orphanedSummaryJsonPath = path.join(typedaiDirName, 'docs', `${orphanedSummaryRelPath}.json`);

			mock({
				[MOCK_REPO_ROOT]: {
					[AI_INFO_FILENAME]: JSON.stringify([{ indexDocs: ['src/**/*.ts'] }]),
					src: {
						'existing.ts': 'content',
					},
					[typedaiDirName]: {
						docs: {
							// Note: The path in the JSON should be relative to MOCK_REPO_ROOT
							'src': { // This structure for existing.ts.json
                                'existing.ts.json': JSON.stringify({ path: 'src/existing.ts', short: 's', long: 'l', meta: { hash: 'h1' } }),
                            },
							'orphaned': { // This structure for orphaned/file.ts.json
								'file.ts.json': JSON.stringify({ path: orphanedSummaryRelPath, short: 's', long: 'l', meta: { hash: 'h_orphan' } }),
							},
						},
					},
				},
			});
            // mockFss CWD set in beforeEach

			const orphanedSummaryFullPath = path.join(MOCK_REPO_ROOT, typedaiDirName, 'docs', 'orphaned/file.ts.json');
			expect(await fsAsync.access(orphanedSummaryFullPath).then(() => true).catch(() => false), 'Orphaned summary should exist initially').to.be.true;

			await builder.buildIndexDocsInternal();

			expect(await fsAsync.access(orphanedSummaryFullPath).then(() => true).catch(() => false), 'Orphaned summary should be deleted').to.be.false;
			const existingSummaryFullPath = path.join(MOCK_REPO_ROOT, typedaiDirName, 'docs', 'src/existing.ts.json');
			expect(await fsAsync.access(existingSummaryFullPath).then(() => true).catch(() => false), 'Existing summary should still exist').to.be.true;
        });

		it('should not regenerate summaries if content and children hashes are unchanged', async () => {
			const fileContent = 'content of file.ts';
			const aiConfig = [{ indexDocs: ['src/file.ts'] }];
			const fileSummaryPath = path.join(typedaiDirName, 'docs', 'src/file.ts.json');
			const folderSummaryPath = path.join(typedaiDirName, 'docs', 'src/_index.json');
			const projectSummaryPath = path.join(typedaiDirName, 'docs', '_project_summary.json');

			const initialFileHash = hash(fileContent);
			const initialFolderChildrenHash = hash(`src/file.ts.json:${initialFileHash}`);
			const initialProjectChildrenHash = hash(`src/_index.json:${initialFolderChildrenHash}`);


			mock({
				[MOCK_REPO_ROOT]: {
					[AI_INFO_FILENAME]: JSON.stringify(aiConfig),
					src: {
						'file.ts': fileContent,
					},
					[typedaiDirName]: {
						docs: {
							// Paths in JSON are relative to MOCK_REPO_ROOT
							'src': {
								'file.ts.json': JSON.stringify({ path: 'src/file.ts', short: 's', long: 'l', meta: { hash: initialFileHash } }),
								'_index.json': JSON.stringify({ path: 'src', short: 's', long: 'l', meta: { hash: initialFolderChildrenHash } }),
							},
							'_project_summary.json': JSON.stringify({ projectOverview: 'overview', meta: { hash: initialProjectChildrenHash } }),
						}
					}
				},
			});
            // mockFss CWD set in beforeEach

			await builder.buildIndexDocsInternal();

			// LLM stubs should not have been called because summaries are up-to-date
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

			mock({
				[MOCK_REPO_ROOT]: {
					[AI_INFO_FILENAME]: JSON.stringify(aiConfig),
					src: {
						'file.ts': oldFileContent,
					},
					[typedaiDirName]: {
						docs: {
							src: {
								'file.ts.json': JSON.stringify({ path: fileSummaryRelPath, short: 's', long: 'l', meta: { hash: hash(oldFileContent) } }),
							},
							// Minimal folder/project summaries for hash propagation
							// Merged 'src' properties
                            src: {
                                'file.ts.json': JSON.stringify({ path: fileSummaryRelPath, short: 's', long: 'l', meta: { hash: hash(oldFileContent) } }),
                                '_index.json': JSON.stringify({ path: 'src', short: 's', long: 'l', meta: { hash: 'folder_h' } }),
                            },
						},
                        '_project_summary.json': JSON.stringify({ projectOverview: 'overview', meta: { hash: 'project_h' } }),
					}
				},
			});
            // mockFss CWD set in beforeEach

			// Simulate file content change
			await fsAsync.writeFile(path.join(MOCK_REPO_ROOT, 'src/file.ts'), newFileContent);

			await builder.buildIndexDocsInternal();

			expect(generateFileSummaryStub.calledOnce, 'generateFileSummary helper should be called once for changed file').to.be.true;
			const summaryFile = JSON.parse(await fsAsync.readFile(path.join(MOCK_REPO_ROOT, fileSummaryJsonPath), 'utf-8'));
			expect(summaryFile.meta.hash).to.equal(hash(newFileContent));
            // Folder and project summaries should also be regenerated due to hash change propagation
            expect(generateFolderSummaryStub.called, 'generateFolderSummary helper for parent should be called').to.be.true;
            expect(mockEasyLlmClient.generateText.calledOnce, 'Easy LLM generateText for project summary should be called').to.be.true;
		});


		it('should handle missing AI_INFO_FILENAME gracefully', async () => {
			// mock.restore(); // Clear previous mock
			mock({
				[MOCK_REPO_ROOT]: {
					// AI_INFO_FILENAME is missing
				},
			});
            // mockFss CWD set in beforeEach
            // Re-create builder as mockFss might be stale if CWD changed due to mock.restore()
            builder = new IndexDocBuilder(mockFss, { easy: mockEasyLlmClient, medium: mockMediumLlmClient });


			await expect(builder.buildIndexDocsInternal()).to.be.rejectedWith(Error, `${AI_INFO_FILENAME} not found`);
		});

		it('should handle empty indexDocs in AI_INFO_FILENAME', async () => {
			// mock.restore();
			mock({
				[MOCK_REPO_ROOT]: {
					[AI_INFO_FILENAME]: JSON.stringify([{ indexDocs: [] }]),
					src: { 'file.ts': 'content' }
				},
			});
            builder = new IndexDocBuilder(mockFss, { easy: mockEasyLlmClient, medium: mockMediumLlmClient });


			await builder.buildIndexDocsInternal();

			expect(loggerWarnStub.calledWithMatch('No indexDocs patterns found')).to.be.true;
			expect(generateFileSummaryStub.called).to.be.false;
			expect(generateFolderSummaryStub.called).to.be.false;
			// Project summary might still be generated (as "empty" or default)
			expect(mockEasyLlmClient.generateText.calledOnce).to.be.true;
		});
	});

	describe('loadBuildDocsSummariesInternal', () => {
		it('should load existing summaries', async () => {
			const summary1Path = 'src/file1.ts';
			const summary1Content = { path: summary1Path, short: 's1', long: 'l1', meta: { hash: 'h1' } };
			// mock.restore();
			mock({
				[MOCK_REPO_ROOT]: {
					[typedaiDirName]: {
						docs: {
							'src': {
								'file1.ts.json': JSON.stringify(summary1Content),
							},
							'_project_summary.json': JSON.stringify({ projectOverview: 'overview', meta: { hash: 'ph' } })
						}
					}
				}
			});
            builder = new IndexDocBuilder(mockFss, { easy: mockEasyLlmClient, medium: mockMediumLlmClient });


			const summaries = await builder.loadBuildDocsSummariesInternal();
			expect(summaries.size).to.equal(1);
			expect(summaries.get(summary1Path)).to.deep.equal(summary1Content);
		});

		it('should call buildIndexDocsInternal if createIfNotExits is true and docs dir is missing', async () => {
			// mock.restore();
			mock({
				[MOCK_REPO_ROOT]: {
					[AI_INFO_FILENAME]: JSON.stringify([{ indexDocs: ['src/file.ts'] }]), 
					src: { 'file.ts': 'content' }
					// .typedai/docs directory is missing
				}
			});
            builder = new IndexDocBuilder(mockFss, { easy: mockEasyLlmClient, medium: mockMediumLlmClient });
            const buildInternalStub = sinon.stub(builder, 'buildIndexDocsInternal').resolves();


			await builder.loadBuildDocsSummariesInternal(true);

			expect(buildInternalStub.calledOnce).to.be.true;
		});
	});

    describe('getTopLevelSummaryInternal', () => {
        it('should return project overview from _project_summary.json', async () => {
            const overview = "Test Project Overview";
            // mock.restore();
            mock({
                [MOCK_REPO_ROOT]: {
                    [typedaiDirName]: {
                        docs: {
                            '_project_summary.json': JSON.stringify({ projectOverview: overview, meta: { hash: 'h' } })
                        }
                    }
                }
            });
            builder = new IndexDocBuilder(mockFss, { easy: mockEasyLlmClient, medium: mockMediumLlmClient });

            const result = await builder.getTopLevelSummaryInternal();
            expect(result).to.equal(overview);
        });

        it('should return empty string if _project_summary.json is missing', async () => {
            //  mock.restore();
             mock({
                [MOCK_REPO_ROOT]: {
                    [typedaiDirName]: {
                        docs: { /* _project_summary.json is missing */ }
                    }
                }
            });
            builder = new IndexDocBuilder(mockFss, { easy: mockEasyLlmClient, medium: mockMediumLlmClient });
            const result = await builder.getTopLevelSummaryInternal();
            expect(result).to.equal('');
        });
    });
});

// Minimal tests for exported functions to ensure they setup and call the builder
describe('Exported repoIndexDocBuilder functions', () => {
    let mockFssInstance: FileSystemService;
    let mockEasyLlm: sinon.SinonStubbedInstance<LLMClientInterface>; // Use LLMClientInterface
    let mockMediumLlm: sinon.SinonStubbedInstance<LLMClientInterface>; // Use LLMClientInterface
    let builderInstanceStub: sinon.SinonStubbedInstance<IndexDocBuilder>;
    let getFileSystemOriginal: any;
    let llmsOriginal: any;

    beforeEach(async () => {
        mockFssInstance = sinon.createStubInstance(FileSystemService);
        // Create full stubs for LLM clients
        mockEasyLlm = {
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
        } as sinon.SinonStubbedInstance<LLMClientInterface>;
        mockMediumLlm = {
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
        } as sinon.SinonStubbedInstance<LLMClientInterface>;

        // Stub the IndexDocBuilder constructor to control the instance and its methods
        // This is tricky. Instead, we'll spy on the methods of the actual instance if needed,
        // or trust the unit tests for IndexDocBuilder cover the internal logic.
        // For these exported function tests, we mainly care that they call the builder.
        // A simple way is to stub the builder's methods.
        builderInstanceStub = sinon.createStubInstance(IndexDocBuilder) as sinon.SinonStubbedInstance<IndexDocBuilder>;

        // This is a bit of a hack: replace the class with a stub returning our controlled instance.
        // This won't work directly for `new IndexDocBuilder(...)` unless we stub the module.
        // Awaiting a better way or focusing on testing the builder methods thoroughly.
        // For now, these tests will be high-level, ensuring the exported functions run.
    });

    afterEach(async () => {
        sinon.restore();
        mock.restore(); // If any test uses mock-fs
    });

    it('buildIndexDocs exported function should run', async () => {
        // To truly test this, we'd need to spy on IndexDocBuilder.prototype.buildIndexDocsInternal
        // or ensure the stubs for getFileSystem/llms are picked up and it doesn't crash.
        // This is more of an integration smoke test for the exported function.
        // For now, we assume if IndexDocBuilder is tested, this will work.
        // A more robust test would involve deeper mocking of the constructor or prototype.
        // Let's make it call a spy for now.
        const buildInternalSpy = sinon.spy(IndexDocBuilder.prototype, 'buildIndexDocsInternal');
        await buildIndexDocs();
        expect(buildInternalSpy.calledOnce).to.be.true;
    });

    it('loadBuildDocsSummaries exported function should run', async () => {
        const loadInternalSpy = sinon.spy(IndexDocBuilder.prototype, 'loadBuildDocsSummariesInternal');
        await loadBuildDocsSummaries(false);
        expect(loadInternalSpy.calledOnceWith(false)).to.be.true;
    });

    it('getRepositoryOverview exported function should run', async () => {
        const getOverviewInternalSpy = sinon.spy(IndexDocBuilder.prototype, 'getTopLevelSummaryInternal');
        (mockEasyLlm.generateText as sinon.SinonStub).resolves("overview"); // Ensure it returns something
        await getRepositoryOverview();
        expect(getOverviewInternalSpy.calledOnce).to.be.true;
    });
});
