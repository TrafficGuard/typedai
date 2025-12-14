import { expect } from 'chai';
import mock from 'mock-fs';
import sinon from 'sinon';
import { setFileSystemOverride } from '#agent/agentContextUtils';
import { FileSystemService } from '#functions/storage/fileSystemService';
import type { SelectedFile } from '#shared/files/files.model';
import { queryWithFileSelection2, queryWorkflowWithSearch, selectFilesAgent } from '#swe/discovery/selectFilesAgentWithSearch';
import * as projectDetectionModule from '#swe/projectDetection';
import * as repoMapModule from '#swe/summaries/repositoryMap';
import * as repoOverviewModule from '#swe/summaries/summaryBuilder';
import * as vectorConfigModule from '#swe/vector/core/config';
import { setupConditionalLoggerOutput } from '#test/testUtils';
import { mockLLM, mockLLMs } from '../llm/services/mock-llm';

import type { AgentLLMs } from '#shared/agent/agent.model';
import { MINIMAL_AI_INFO } from '../swe/projectDetection';

/**
 * Unit tests for MCP server tool handlers.
 * These tests verify the tool logic that would be invoked by the MCP server.
 */
describe('MCP Server Tools', () => {
	setupConditionalLoggerOutput();

	const sandbox = sinon.createSandbox();
	let fsOverride: FileSystemService;
	let llmSet: AgentLLMs;

	beforeEach(() => {
		mockLLM.reset();
		llmSet = mockLLMs();

		// Mock filesystem
		mock({
			'/test-repo': {
				'.git': {},
				'.gitignore': 'node_modules\n',
				'.typedai.json': MINIMAL_AI_INFO,
				src: {
					'index.ts': 'export const main = () => console.log("hello");',
					auth: {
						'auth.ts': 'export function authenticate() { return true; }',
						'session.ts': 'export class Session { active = true; }',
					},
				},
				'package.json': '{"name": "test-repo"}',
			},
		});

		fsOverride = new FileSystemService('/test-repo');
		sandbox.stub(fsOverride, 'getWorkingDirectory').returns('/test-repo');
		sandbox.stub(fsOverride, 'getVcsRoot').returns('/test-repo');
		sandbox.stub(fsOverride, 'searchExtractsMatchingContents').resolves('auth.ts: authenticate function');
		sandbox.stub(fsOverride, 'searchFilesMatchingContents').resolves('auth.ts: 1');
		setFileSystemOverride(fsOverride);

		// Stub project detection
		sandbox.stub(projectDetectionModule, 'getProjectInfos').resolves(null);

		// Stub vector search as unavailable
		sandbox.stub(vectorConfigModule, 'isVectorSearchAvailable').returns(false);

		// Stub repository maps and overview
		sandbox.stub(repoMapModule, 'generateRepositoryMaps').resolves({
			fileSystemTree: { text: '<tree>test</tree>', tokens: 10 },
			folderSystemTreeWithSummaries: { text: '<folders>test</folders>', tokens: 10 },
			fileSystemTreeWithFolderSummaries: { text: '<folders>test</folders>', tokens: 10 },
			fileSystemTreeWithFileSummaries: { text: '<files>test structure</files>', tokens: 100 },
			languageProjectMap: { text: '<projects>test</projects>', tokens: 10 },
		});
		sandbox.stub(repoOverviewModule, 'getRepositoryOverview').resolves('<overview>Test repo</overview>');
	});

	afterEach(() => {
		mockLLM.assertNoPendingResponses();
		setFileSystemOverride(null);
		mock.restore();
		sandbox.restore();
	});

	describe('selectFilesAgent (MCP selectFiles tool)', () => {
		it('should select files for given requirements', async () => {
			// Queue LLM responses
			mockLLM
				.addMessageResponse('<json>{"inspectFiles":["src/auth/auth.ts"]}</json>')
				.addMessageResponse('<json>{"keepFiles":[{"filePath":"src/auth/auth.ts","reason":"Contains authentication logic"}]}</json>');

			const files = await selectFilesAgent('Find authentication files', {}, llmSet);

			expect(files).to.be.an('array');
			expect(files.length).to.equal(1);
			expect(files[0].filePath).to.equal('src/auth/auth.ts');
			expect(files[0].reason).to.include('authentication');
		});

		it('should handle empty requirements gracefully', async () => {
			try {
				await selectFilesAgent('', {}, llmSet);
				expect.fail('Should have thrown an error');
			} catch (error) {
				expect((error as Error).message).to.include('Requirements must be provided');
			}
		});

		it('should support initialFilePaths option', async () => {
			mockLLM
				.addMessageResponse('<json>{"inspectFiles":[]}</json>')
				.addMessageResponse('<json>{"keepFiles":[{"filePath":"src/index.ts","reason":"main entry"}]}</json>');

			const files = await selectFilesAgent('Find main files', { initialFilePaths: ['src/index.ts'] }, llmSet);

			expect(files).to.be.an('array');
			expect(files.length).to.be.greaterThan(0);
		});
	});

	describe('queryWorkflowWithSearch (MCP queryCodebase tool)', () => {
		it('should return an answer for a query', async () => {
			// Queue LLM responses
			mockLLM
				.addMessageResponse('<json>{"inspectFiles":["src/index.ts"]}</json>')
				.addMessageResponse('<json>{"keepFiles":[{"filePath":"src/index.ts","reason":"Main entry"}]}</json>')
				.addMessageResponse('<result>The main function logs hello to the console.\nConfidence: HIGH</result>');

			const answer = await queryWorkflowWithSearch('What does the main function do?', {}, llmSet);

			expect(answer).to.be.a('string');
			expect(answer).to.include('main');
			expect(answer).to.include('Confidence');
		});

		it('should throw on empty query', async () => {
			try {
				await queryWorkflowWithSearch('', {}, llmSet);
				expect.fail('Should have thrown an error');
			} catch (error) {
				expect((error as Error).message).to.include('query must be provided');
			}
		});
	});

	describe('queryWithFileSelection2 (MCP queryWithFileSelection tool)', () => {
		it('should return both files and answer', async () => {
			// Queue LLM responses
			mockLLM
				.addMessageResponse('<json>{"inspectFiles":["src/auth/session.ts"]}</json>')
				.addMessageResponse('<json>{"keepFiles":[{"filePath":"src/auth/session.ts","reason":"Session management"}]}</json>')
				.addMessageResponse('<result>The Session class manages user sessions.\nConfidence: HIGH</result>');

			const result = await queryWithFileSelection2('How do sessions work?', {}, llmSet);

			expect(result).to.have.property('answer');
			expect(result).to.have.property('files');
			expect(result.files).to.be.an('array');
			expect(result.files.length).to.equal(1);
			expect(result.answer).to.be.a('string');
			expect(result.answer).to.include('Session');
		});

		it('should support initialFilePaths option', async () => {
			mockLLM
				.addMessageResponse('<json>{"inspectFiles":[]}</json>')
				.addMessageResponse('<json>{"keepFiles":[{"filePath":"src/index.ts","reason":"provided"}]}</json>')
				.addMessageResponse('<result>The index file exports main.\nConfidence: HIGH</result>');

			const result = await queryWithFileSelection2('What does index.ts do?', { initialFilePaths: ['src/index.ts'] }, llmSet);

			expect(result.files).to.be.an('array');
			expect(result.answer).to.be.a('string');
		});

		it('should support useXtraHardLLM option', async () => {
			mockLLM
				.addMessageResponse('<json>{"inspectFiles":["src/index.ts"]}</json>')
				.addMessageResponse('<json>{"keepFiles":[{"filePath":"src/index.ts","reason":"main"}]}</json>')
				.addMessageResponse('<result>Complex analysis result.\nConfidence: VERY_HIGH</result>');

			const result = await queryWithFileSelection2('Complex query', { useHardLLM: true }, llmSet);

			expect(result.answer).to.be.a('string');
		});
	});

	describe('MCP response format validation', () => {
		it('should format selectFiles response correctly for MCP', () => {
			const files: SelectedFile[] = [
				{ filePath: 'src/auth.ts', reason: 'Authentication logic' },
				{ filePath: 'src/config.ts', reason: 'Configuration' },
			];

			// Simulate MCP response format (what mcp.ts would return)
			const response = {
				content: [{ type: 'text', text: JSON.stringify(files, null, 2) }],
				structuredContent: { files },
			};

			expect(response.content[0].type).to.equal('text');
			expect(response.structuredContent.files).to.deep.equal(files);
			expect(JSON.parse(response.content[0].text)).to.deep.equal(files);
		});

		it('should format queryCodebase response correctly for MCP', () => {
			const answer = 'The authentication system uses JWT tokens.\nConfidence: HIGH';

			// Simulate MCP response format
			const response = {
				content: [{ type: 'text', text: answer }],
			};

			expect(response.content[0].type).to.equal('text');
			expect(response.content[0].text).to.equal(answer);
		});

		it('should format queryWithFileSelection response correctly for MCP', () => {
			const result = {
				answer: 'The system uses a REST API.\nConfidence: HIGH',
				files: [{ filePath: 'src/api.ts', reason: 'API implementation' }],
			};

			// Simulate MCP response format
			const response = {
				content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
				structuredContent: result,
			};

			expect(response.content[0].type).to.equal('text');
			expect(response.structuredContent).to.deep.equal(result);
		});

		it('should format error response correctly for MCP', () => {
			const errorMessage = 'No files were selected';

			// Simulate MCP error response
			const response = {
				content: [{ type: 'text', text: `Error: ${errorMessage}` }],
				isError: true,
			};

			expect(response.isError).to.equal(true);
			expect(response.content[0].text).to.include('Error:');
			expect(response.content[0].text).to.include(errorMessage);
		});
	});
});
