import { createHash } from 'node:crypto';
import { promises as fsAsync } from 'node:fs';
import path from 'node:path';
import chai, { expect } from 'chai';
import chaiSubset from 'chai-subset';
import mock from 'mock-fs';
import sinon from 'sinon';
import { getFileSystem, llms } from '#agent/agentContextLocalStorage';
import { typedaiDirName } from '#app/appDirs';
import { FileSystemService } from '#functions/storage/fileSystemService';
import { logger } from '#o11y/logger';
import { AI_INFO_FILENAME } from '#swe/projectDetection';
import { buildIndexDocs, loadBuildDocsSummaries, getRepositoryOverview } from '#swe/index/repoIndexDocBuilder';
import * as llmSummaries from './llmSummaries'; // To stub its functions

// Enable chai-subset
chai.use(chaiSubset);

const MOCK_REPO_ROOT = '/test-repo';

function hash(content: string): string {
	return createHash('md5').update(content).digest('hex');
}

describe('repoIndexDocBuilder', () => {
	let getFileSystemStub: sinon.SinonStub;
	let llmsStub: sinon.SinonStub;
	let mockLlm: any;
	let generateFileSummaryStub: sinon.SinonStub;
	let generateFolderSummaryStub: sinon.SinonStub;
	let loggerInfoStub: sinon.SinonStub;
	let loggerWarnStub: sinon.SinonStub;
	let loggerErrorStub: sinon.SinonStub;
	let loggerDebugStub: sinon.SinonStub;
	let fss: FileSystemService;

	beforeEach(() => {
		fss = new FileSystemService(); // Real FSS, will operate on mock-fs
		// process.cwd() is mocked by mock-fs, so FSS will use the mock root

		getFileSystemStub = sinon.stub(await import('#agent/agentContextLocalStorage'), 'getFileSystem');
		getFileSystemStub.returns(fss);

		mockLlm = {
			generateJson: sinon.stub(),
			generateText: sinon.stub(),
		};
		llmsStub = sinon.stub(await import('#agent/agentContextLocalStorage'), 'llms');
		llmsStub.returns({
			easy: mockLlm,
			medium: mockLlm, // Assuming medium uses same mock for simplicity
		});

		generateFileSummaryStub = sinon.stub(llmSummaries, 'generateFileSummary');
		generateFolderSummaryStub = sinon.stub(llmSummaries, 'generateFolderSummary');

		loggerInfoStub = sinon.stub(logger, 'info');
		loggerWarnStub = sinon.stub(logger, 'warn');
		loggerErrorStub = sinon.stub(logger, 'error');
		loggerDebugStub = sinon.stub(logger, 'debug');

		// Default LLM responses
		generateFileSummaryStub.resolves({ short: 'Mocked file short', long: 'Mocked file long' });
		generateFolderSummaryStub.resolves({ short: 'Mocked folder short', long: 'Mocked folder long' });
		mockLlm.generateText.resolves('Mocked project overview');
	});

	afterEach(() => {
		sinon.restore();
		mock.restore();
	});

	describe('buildIndexDocs', () => {
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
					[typedaiDirName]: { // Pre-create .typedai/docs to avoid initial creation logs if any
						docs: {}
					}
				},
			});
            // FileSystemService's working directory is set by mock-fs's process.cwd()
            // If fss is created after mock(), it should pick up MOCK_REPO_ROOT
            // Forcing it here to be sure, as order of beforeEach parts might matter
            fss.setWorkingDirectoryUnsafe(MOCK_REPO_ROOT);


			await buildIndexDocs();

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
			expect(generateFileSummaryStub.callCount).to.equal(3); // file1.ts, file2.ts, file3.ts
			expect(generateFolderSummaryStub.callCount).to.equal(3); // src/swe/sub, src/swe, src
			expect(mockLlm.generateText.callCount).to.equal(1); // project summary

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
							'existing.ts.json': JSON.stringify({ path: 'src/existing.ts', short: 's', long: 'l', meta: { hash: 'h1' } }),
							orphaned: { // This structure implies orphanedSummaryJsonPath is MOCK_REPO_ROOT/.typedai/docs/orphaned/file.ts.json
								'file.ts.json': JSON.stringify({ path: orphanedSummaryRelPath, short: 's', long: 'l', meta: { hash: 'h_orphan' } }),
							}
						},
					},
				},
			});
            fss.setWorkingDirectoryUnsafe(MOCK_REPO_ROOT);

			const orphanedSummaryFullPath = path.join(MOCK_REPO_ROOT, orphanedSummaryJsonPath);
			expect(await fsAsync.access(orphanedSummaryFullPath).then(() => true).catch(() => false), 'Orphaned summary should exist initially').to.be.true;

			await buildIndexDocs();

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
							src: {
								'file.ts.json': JSON.stringify({ path: 'src/file.ts', short: 's', long: 'l', meta: { hash: initialFileHash } }),
								'_index.json': JSON.stringify({ path: 'src', short: 's', long: 'l', meta: { hash: initialFolderChildrenHash } }),
							},
							'_project_summary.json': JSON.stringify({ projectOverview: 'overview', meta: { hash: initialProjectChildrenHash } }),
						}
					}
				},
			});
            fss.setWorkingDirectoryUnsafe(MOCK_REPO_ROOT);

			await buildIndexDocs();

			// LLM stubs should not have been called because summaries are up-to-date
			expect(generateFileSummaryStub.called, 'generateFileSummary should not be called').to.be.false;
			expect(generateFolderSummaryStub.called, 'generateFolderSummary should not be called').to.be.false;
			expect(mockLlm.generateText.called, 'generateText for project summary should not be called').to.be.false;
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
                            '_index.json': JSON.stringify({ path: 'src', short: 's', long: 'l', meta: { hash: 'folder_h' } }),
						},
                        '_project_summary.json': JSON.stringify({ projectOverview: 'overview', meta: { hash: 'project_h' } }),
					}
				},
			});
            fss.setWorkingDirectoryUnsafe(MOCK_REPO_ROOT);

			// Simulate file content change
			await fsAsync.writeFile(path.join(MOCK_REPO_ROOT, 'src/file.ts'), newFileContent);

			await buildIndexDocs();

			expect(generateFileSummaryStub.calledOnce, 'generateFileSummary should be called once for changed file').to.be.true;
			const summaryFile = JSON.parse(await fsAsync.readFile(path.join(MOCK_REPO_ROOT, fileSummaryJsonPath), 'utf-8'));
			expect(summaryFile.meta.hash).to.equal(hash(newFileContent));
            // Folder and project summaries should also be regenerated due to hash change propagation
            expect(generateFolderSummaryStub.called, 'generateFolderSummary for parent should be called').to.be.true;
            expect(mockLlm.generateText.calledOnce, 'generateText for project summary should be called').to.be.true;
		});


		it('should handle missing AI_INFO_FILENAME gracefully', async () => {
			mock({
				[MOCK_REPO_ROOT]: {
					// AI_INFO_FILENAME is missing
				},
			});
            fss.setWorkingDirectoryUnsafe(MOCK_REPO_ROOT);

			await expect(buildIndexDocs()).to.be.rejectedWith(Error, `${AI_INFO_FILENAME} not found`);
		});

		it('should handle empty indexDocs in AI_INFO_FILENAME', async () => {
			mock({
				[MOCK_REPO_ROOT]: {
					[AI_INFO_FILENAME]: JSON.stringify([{ indexDocs: [] }]),
					src: { 'file.ts': 'content' }
				},
			});
            fss.setWorkingDirectoryUnsafe(MOCK_REPO_ROOT);

			await buildIndexDocs();

			expect(loggerWarnStub.calledWithMatch('No indexDocs patterns found')).to.be.true;
			expect(generateFileSummaryStub.called).to.be.false;
			expect(generateFolderSummaryStub.called).to.be.false;
			// Project summary might still be generated (as "empty" or default)
			expect(mockLlm.generateText.calledOnce).to.be.true;
		});
	});

	describe('loadBuildDocsSummaries', () => {
		it('should load existing summaries', async () => {
			const summary1Path = 'src/file1.ts';
			const summary1Content = { path: summary1Path, short: 's1', long: 'l1', meta: { hash: 'h1' } };
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
            fss.setWorkingDirectoryUnsafe(MOCK_REPO_ROOT);

			const summaries = await loadBuildDocsSummaries();
			expect(summaries.size).to.equal(1);
			expect(summaries.get(summary1Path)).to.deep.equal(summary1Content);
		});

		it('should call buildIndexDocs if createIfNotExits is true and docs dir is missing', async () => {
			mock({
				[MOCK_REPO_ROOT]: {
					[AI_INFO_FILENAME]: JSON.stringify([{ indexDocs: ['src/file.ts'] }]), // Needed for buildIndexDocs
					src: { 'file.ts': 'content' }
					// .typedai/docs directory is missing
				}
			});
            fss.setWorkingDirectoryUnsafe(MOCK_REPO_ROOT);

            // Stub buildIndexDocs itself to check if it's called, not to re-run full logic
            const buildIndexDocsStub = sinon.stub(await import('#swe/index/repoIndexDocBuilder'), 'buildIndexDocs').resolves();

			await loadBuildDocsSummaries(true);

			expect(buildIndexDocsStub.calledOnce).to.be.true;
            buildIndexDocsStub.restore(); // Restore immediately as it's in the same module
		});
	});

    describe('getRepositoryOverview', () => {
        it('should return project overview from _project_summary.json', async () => {
            const overview = "Test Project Overview";
            mock({
                [MOCK_REPO_ROOT]: {
                    [typedaiDirName]: {
                        docs: {
                            '_project_summary.json': JSON.stringify({ projectOverview: overview, meta: { hash: 'h' } })
                        }
                    }
                }
            });
            fss.setWorkingDirectoryUnsafe(MOCK_REPO_ROOT);

            const result = await getRepositoryOverview();
            expect(result).to.equal(`<repository-overview>\n${overview}\n</repository-overview>\n`);
        });

        it('should return empty string if _project_summary.json is missing', async () => {
             mock({
                [MOCK_REPO_ROOT]: {
                    [typedaiDirName]: {
                        docs: {
                            // _project_summary.json is missing
                        }
                    }
                }
            });
            fss.setWorkingDirectoryUnsafe(MOCK_REPO_ROOT);
            const result = await getRepositoryOverview();
            expect(result).to.equal('');
        });
    });
});
