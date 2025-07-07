import { join } from 'node:path';
import { expect } from 'chai';
import mockFs from 'mock-fs';
import * as sinon from 'sinon';
import { FileSystemService } from '#functions/storage/fileSystemService';
import type { IFileSystemService } from '#shared/files/fileSystemService';
import { setupConditionalLoggerOutput } from '#test/testUtils';
import type { EditBlock, ValidationIssue } from '../coderTypes';
import {
	type MetaRequests,
	type SessionContext,
	buildExternalChangeReflection,
	buildFailureReflection,
	buildMetaRequestReflection,
	buildValidationReflection,
} from './reflectionGenerator';

const MOCK_REPO_ROOT = '/repo';

describe('ReflectionGenerator', () => {
	setupConditionalLoggerOutput();

	let mockFss: IFileSystemService;
	let sessionContext: SessionContext;

	beforeEach(() => {
		mockFs({
			[MOCK_REPO_ROOT]: {
				'file1.ts': 'content of file1',
				'file2.js': 'some other content',
				'already-has-replace.txt': 'the new content is here',
			},
		});

		mockFss = new FileSystemService(MOCK_REPO_ROOT);
		sinon.stub(mockFss, 'getVcsRoot').returns(MOCK_REPO_ROOT);
		sessionContext = {
			workingDir: MOCK_REPO_ROOT,
			absFnamesInChat: new Set(),
		};
	});

	afterEach(() => {
		sinon.restore();
		mockFs.restore();
	});

	describe('buildValidationReflection', () => {
		it('should generate a reflection for a single validation issue', () => {
			const issues: ValidationIssue[] = [{ file: 'path/to/file.ts', reason: 'File not found' }];
			const reflection = buildValidationReflection(issues);
			expect(reflection).to.contain('There were issues with the file paths or structure of your proposed changes:');
			expect(reflection).to.contain('- File "path/to/file.ts": File not found');
			expect(reflection).to.contain('Please correct these issues and resubmit your changes.');
		});

		it('should generate a reflection for multiple validation issues', () => {
			const issues: ValidationIssue[] = [
				{ file: 'file1.ts', reason: 'Issue A' },
				{ file: 'file2.ts', reason: 'Issue B' },
			];
			const reflection = buildValidationReflection(issues);
			expect(reflection).to.contain('- File "file1.ts": Issue A');
			expect(reflection).to.contain('- File "file2.ts": Issue B');
		});
	});

	describe('buildFailureReflection', () => {
		it('should generate a report for a single failed edit block', async () => {
			const failedEdits: EditBlock[] = [{ filePath: 'file1.ts', originalText: 'old', updatedText: 'new' }];
			const reflection = await buildFailureReflection(failedEdits, 0, mockFss, MOCK_REPO_ROOT);
			expect(reflection).to.contain('# 1 SEARCH/REPLACE block failed to match!');
			expect(reflection).to.contain('SearchReplaceNoExactMatch');
			expect(reflection).to.contain('<<<<<<< SEARCH\nold\n=======\nnew\n>>>>>>> REPLACE');
		});

		it('should generate a report for multiple failed edit blocks with correct pluralization', async () => {
			const failedEdits: EditBlock[] = [
				{ filePath: 'file1.ts', originalText: 'old1', updatedText: 'new1' },
				{ filePath: 'file2.ts', originalText: 'old2', updatedText: 'new2' },
			];
			const reflection = await buildFailureReflection(failedEdits, 0, mockFss, MOCK_REPO_ROOT);
			expect(reflection).to.contain('# 2 SEARCH/REPLACE blocks failed to match!');
		});

		it('should include a note if the replacement text is already in the file', async () => {
			const failedEdits: EditBlock[] = [{ filePath: 'already-has-replace.txt', originalText: 'old', updatedText: 'new content' }];
			const reflection = await buildFailureReflection(failedEdits, 0, mockFss, MOCK_REPO_ROOT);
			expect(reflection).to.contain('NOTE: The REPLACE lines are already present in already-has-replace.txt.');
		});

		it('should include a summary of passed blocks if any', async () => {
			const failedEdits: EditBlock[] = [{ filePath: 'file1.ts', originalText: 'old', updatedText: 'new' }];
			const reflection = await buildFailureReflection(failedEdits, 5, mockFss, MOCK_REPO_ROOT);
			expect(reflection).to.contain('# The other 5 SEARCH/REPLACE blocks were applied successfully.');
			expect(reflection).to.contain("Don't re-send them.");
		});
	});

	describe('buildMetaRequestReflection', () => {
		it('should generate a reflection for requested files, separating new and existing', () => {
			sessionContext.absFnamesInChat.add(join(MOCK_REPO_ROOT, 'existing.ts'));
			const metaRequests: MetaRequests = {
				requestedFiles: [
					{ filePath: 'new.ts', reason: 'test' },
					{ filePath: 'existing.ts', reason: 'test' },
				],
			};

			const { reflection, addedFiles } = buildMetaRequestReflection(metaRequests, sessionContext);

			expect(reflection).to.contain('I have added the 1 file(s) you requested to the chat: new.ts');
			expect(reflection).to.contain('The following file(s) you requested were already in the chat: existing.ts');
			expect(addedFiles).to.deep.equal(['new.ts']);
		});

		it('should generate a reflection for requested queries and package installs', () => {
			const metaRequests: MetaRequests = {
				requestedQueries: [{ query: 'find all todos' }],
				requestedPackageInstalls: [{ packageName: 'uuid', reason: 'test' }],
			};

			const { reflection } = buildMetaRequestReflection(metaRequests, sessionContext);

			expect(reflection).to.contain('You asked 1 quer(y/ies): "find all todos"');
			expect(reflection).to.contain('You requested to install 1 package(s): "uuid"');
		});

		it('should skip invalid file paths in meta requests gracefully', () => {
			const metaRequests: MetaRequests = {
				requestedFiles: [
					{ filePath: 'valid.ts', reason: 'test' },
					{ filePath: null as any, reason: 'test' },
					{ filePath: 'another.ts', reason: 'test' },
				],
			};

			const { reflection, addedFiles } = buildMetaRequestReflection(metaRequests, sessionContext);

			expect(reflection).to.contain('I have added the 2 file(s) you requested to the chat: valid.ts, another.ts');
			expect(addedFiles).to.deep.equal(['valid.ts', 'another.ts']);
		});
	});

	describe('buildExternalChangeReflection', () => {
		it('should generate a reflection for externally changed files', () => {
			const changedFiles = ['path/to/file1.ts', 'path/to/file2.ts'];
			const reflection = buildExternalChangeReflection(changedFiles);
			expect(reflection).to.contain('The following file(s) were modified after the edit blocks were generated:');
			expect(reflection).to.contain(changedFiles.join(', '));
			expect(reflection).to.contain('Please regenerate the edits using the updated content.');
		});
	});
});
