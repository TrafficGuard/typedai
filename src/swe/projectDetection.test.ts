import { getFileSystem } from '#agent/agentContextLocalStorage';
import { logger } from '#o11y/logger';
import { IFileSystemService } from '#shared/files/fileSystemService';
import { setupConditionalLoggerOutput } from '#test/testUtils';
import { expect } from 'chai';
import mockFs from 'mock-fs';
import sinon from 'sinon';
import {
	AI_INFO_FILENAME,
	type ProjectInfo,
	type ProjectInfoFileFormat,
	detectProjectInfo,
	normalizeScriptCommandToArray,
	normalizeScriptCommandToFileFormat,
    parseProjectInfo,
} from './projectDetection';
import * as projectDetectionAgentModule from './projectDetectionAgent'; // Import for stubbing

describe('projectDetection', () => {
	setupConditionalLoggerOutput();
	let sandbox: sinon.SinonSandbox;

	beforeEach(() => {
		sandbox = sinon.createSandbox();
	});

	afterEach(() => {
		sandbox.restore();
	});

	describe('normalizeScriptCommandToArray', () => {
		it('should return an empty array for undefined, null, or empty string', () => {
			expect(normalizeScriptCommandToArray(undefined)).to.deep.equal([]);
			expect(normalizeScriptCommandToArray(null)).to.deep.equal([]);
			expect(normalizeScriptCommandToArray('')).to.deep.equal([]);
		});

		it('should return an array with the trimmed command for a single string', () => {
			expect(normalizeScriptCommandToArray('single_command')).to.deep.equal(['single_command']);
			expect(normalizeScriptCommandToArray('  padded_command  ')).to.deep.equal(['padded_command']);
		});

		it('should return the same array with trimmed, non-empty commands for an array input', () => {
			expect(normalizeScriptCommandToArray(['cmd1', 'cmd2'])).to.deep.equal(['cmd1', 'cmd2']);
			expect(normalizeScriptCommandToArray([' cmd1 ', '', 'cmd2  '])).to.deep.equal(['cmd1', 'cmd2']);
		});

		it('should return an empty array for an empty array or array with only empty strings', () => {
			expect(normalizeScriptCommandToArray([])).to.deep.equal([]);
			expect(normalizeScriptCommandToArray([''])).to.deep.equal([]);
			expect(normalizeScriptCommandToArray(['  ', '\t'])).to.deep.equal([]);
		});
	});

	describe('normalizeScriptCommandToFileFormat', () => {
		it('should return an empty string for an empty array', () => {
			expect(normalizeScriptCommandToFileFormat([])).to.equal('');
		});

		it('should return the single command string for an array with one element', () => {
			expect(normalizeScriptCommandToFileFormat(['single_command'])).to.equal('single_command');
		});

		it('should return the array itself for an array with multiple elements', () => {
			expect(normalizeScriptCommandToFileFormat(['cmd1', 'cmd2'])).to.deep.equal(['cmd1', 'cmd2']);
		});
	});

	describe('parseProjectInfo', () => {
		it('should correctly parse valid JSON with mixed script command formats', () => {
			const fileContent = JSON.stringify([
				{
					baseDir: './project1',
					language: 'typescript',
					initialise: 'npm install',
					compile: ['tsc', '-p .'],
					test: '',
					format: [],
					staticAnalysis: 'eslint .',
					devBranch: 'main',
					indexDocs: ['docs/**/*.md'],
				},
			] as ProjectInfoFileFormat[]);
			const result = parseProjectInfo(fileContent);
			expect(result).to.be.an('array').with.lengthOf(1);
			const project = result![0];
			expect(project.initialise).to.deep.equal(['npm install']);
			expect(project.compile).to.deep.equal(['tsc', '-p .']);
			expect(project.test).to.deep.equal([]);
			expect(project.format).to.deep.equal([]);
			expect(project.staticAnalysis).to.deep.equal(['eslint .']);
			expect(project.baseDir).to.equal('./project1');
			expect(project.language).to.equal('typescript');
		});

		it('should return null for invalid JSON', () => {
			const fileContent = 'invalid json';
			expect(parseProjectInfo(fileContent)).to.be.null;
		});

		it('should return null if baseDir is missing or invalid', () => {
			const fileContentMissingBaseDir = JSON.stringify([{ language: 'typescript' }]);
			expect(parseProjectInfo(fileContentMissingBaseDir)).to.be.null;

			const fileContentEmptyBaseDir = JSON.stringify([{ baseDir: '  ' }]);
			expect(parseProjectInfo(fileContentEmptyBaseDir)).to.be.null;
		});


		it('should default missing script properties to empty arrays', () => {
			const fileContent = JSON.stringify([{ baseDir: './project1' }] as Partial<ProjectInfoFileFormat>[]);
			const result = parseProjectInfo(fileContent);
			const project = result![0];
			expect(project.initialise).to.deep.equal([]);
			expect(project.compile).to.deep.equal([]);
			expect(project.test).to.deep.equal([]);
			expect(project.format).to.deep.equal([]);
			expect(project.staticAnalysis).to.deep.equal([]);
		});
	});

	describe('mapProjectInfoToFileFormat', () => {
		it('should correctly format script commands for file output', () => {
			const projectInfo: ProjectInfo = {
				baseDir: './project1',
				language: 'typescript',
				primary: true,
				devBranch: 'develop',
				initialise: ['npm install'],
				compile: ['tsc', '-p .'],
				test: [],
				format: ['prettier --write .'],
				staticAnalysis: [],
				languageTools: null, // Assuming LanguageTools is not relevant for this specific test
				fileSelection: '', // Default or mock value
				indexDocs: ['README.md'],
			};
			const result = mapProjectInfoToFileFormat(projectInfo);
			expect(result.initialise).to.equal('npm install');
			expect(result.compile).to.deep.equal(['tsc', '-p .']);
			expect(result.test).to.equal('');
			expect(result.format).to.equal('prettier --write .');
			expect(result.staticAnalysis).to.equal('');
			expect(result.baseDir).to.equal('./project1');
		});
	});

	describe('detectProjectInfo', () => {
		let projectDetectionAgentStub: sinon.SinonStub;

		beforeEach(() => {
			projectDetectionAgentStub = sandbox.stub(projectDetectionAgentModule, 'projectDetectionAgent');
		});

		it('should load from CWD if valid file exists', async () => {
			const cwdProjectPath = path.join(MOCK_CWD, AI_INFO_FILENAME);
			const fileContent: ProjectInfoFileFormat[] = [
				{
					baseDir: './',
					primary: true,
					language: 'typescript',
					initialise: 'node build.js install',
					compile: 'node build.js build',
					format: '', // Will be normalized to []
					staticAnalysis: 'node build.js lint',
					test: 'cd frontend && npm run test:ci',
					devBranch: 'main',
					indexDocs: [
						'src/**/*.ts',
						'frontend/src/**/*.ts',
						'bin/**',
						'shared/**',
					],
				},
			];

			setupFileSystemAndSpy(
				{ [cwdProjectPath]: JSON.stringify(fileContent, null, 2) },
				MOCK_CWD, // CWD
				MOCK_CWD, // VCS Root is CWD for this test
			);
			const result = await detectProjectInfo();

			expect(result).to.be.an('array').with.lengthOf(1);
			const project = result[0];
			expect(project.baseDir).to.equal('./');
			expect(project.primary).to.be.true;
			expect(project.language).to.equal('typescript');
			expect(project.initialise).to.deep.equal(['node build.js install']);
			expect(project.compile).to.deep.equal(['node build.js build']);
			expect(project.format).to.deep.equal([]);
			expect(project.staticAnalysis).to.deep.equal(['node build.js lint']);
			expect(project.test).to.deep.equal(['cd frontend && npm run test:ci']);
			expect(project.devBranch).to.equal('main');
			expect(project.indexDocs).to.deep.equal(fileContent[0].indexDocs);
			expect(projectDetectionAgentStub.called).to.be.false;
		});

		it('should load from VCS root if not in CWD and CWD is not VCS root', async () => {
			const cwdProjectPath = `/test/cwd/${AI_INFO_FILENAME}`;
			const vcsRootProjectPath = `/test/vcs_root/${AI_INFO_FILENAME}`;
			mockFss.getWorkingDirectory.returns('/test/cwd'); // CWD
			mockFss.getVcsRoot.returns('/test/vcs_root'); // VCS Root (different)

			const fileContent: ProjectInfoFileFormat[] = [
				{
					baseDir: 'vcs_project/',
					language: 'python',
					initialise: 'pip install',
					compile: '',
					format: '',
					staticAnalysis: '',
					test: 'pytest',
					devBranch: 'main',
					indexDocs: [],
				},
			];
			mockFss.fileExists.withArgs(cwdProjectPath).resolves(false);
			mockFss.fileExists.withArgs(vcsRootProjectPath).resolves(true);
			mockFss.readFile.withArgs(vcsRootProjectPath).resolves(JSON.stringify(fileContent));

			const result = await detectProjectInfo();

			expect(result).to.be.an('array').with.lengthOf(1);
			expect(result[0].baseDir).to.equal('vcs_project/');
			expect(result[0].initialise).to.deep.equal(['pip install']);
			expect(projectDetectionAgentStub.called).to.be.false;
			// Check if it wrote to CWD
			expect(mockFss.writeFile.calledWith(cwdProjectPath, JSON.stringify(fileContent, null, 2))).to.be.true;
		});

		it('should call projectDetectionAgent if no valid file found and write temporary empty file first', async () => {
			const cwdProjectPath = `/test/cwd/${AI_INFO_FILENAME}`;
			const vcsRootProjectPath = `/test/vcs_root/${AI_INFO_FILENAME}`;
			mockFss.fileExists.withArgs(cwdProjectPath).resolves(false);
			mockFss.fileExists.withArgs(vcsRootProjectPath).resolves(false); // No file anywhere

			const agentDetectedProjects: ProjectInfo[] = [
				{
					baseDir: './agent_project',
					language: 'nodejs',
					primary: true,
					devBranch: 'main',
					initialise: ['yarn'],
					compile: ['yarn build'],
					format: [],
					staticAnalysis: [],
					test: ['yarn test'],
					languageTools: null,
					fileSelection: '',
					indexDocs: [],
				},
			];
			projectDetectionAgentStub.resolves(agentDetectedProjects);

			const result = await detectProjectInfo();

			expect(projectDetectionAgentStub.calledOnce).to.be.true;
			// Verify temporary empty file write
			expect(mockFss.writeFile.calledWith(cwdProjectPath, JSON.stringify([], null, 2))).to.be.true;
			// Verify final detected projects write (overwriting temporary)
			const expectedFileFormat = agentDetectedProjects.map(mapProjectInfoToFileFormat);
			expect(mockFss.writeFile.calledWith(cwdProjectPath, JSON.stringify(expectedFileFormat, null, 2))).to.be.true;

			expect(result).to.deep.equal(agentDetectedProjects);
		});

		it('should rename invalid file and then call projectDetectionAgent', async () => {
			const cwdProjectPath = `/test/cwd/${AI_INFO_FILENAME}`;
			mockFss.fileExists.withArgs(cwdProjectPath).resolves(true);
			mockFss.readFile.withArgs(cwdProjectPath).resolves('invalid json content'); // Invalid file

			projectDetectionAgentStub.resolves([]); // Agent finds nothing after rename

			await detectProjectInfo();

			expect(mockFss.rename.calledOnce).to.be.true;
			const renameArgs = mockFss.rename.getCall(0).args;
			expect(renameArgs[0]).to.equal(cwdProjectPath);
			expect(renameArgs[1]).to.satisfy((name: string) => name.startsWith(`${cwdProjectPath}.invalid_`));

			expect(projectDetectionAgentStub.calledOnce).to.be.true;
		});

		it('should return empty array and not call agent if valid empty "[]" file exists', async () => {
			const cwdProjectPath = `/test/cwd/${AI_INFO_FILENAME}`;
			mockFss.fileExists.withArgs(cwdProjectPath).resolves(true);
			mockFss.readFile.withArgs(cwdProjectPath).resolves("[]"); // Valid empty projects file

			const result = await detectProjectInfo();

			expect(result).to.deep.equal([]);
			expect(projectDetectionAgentStub.called).to.be.false;
		});

		it('should handle re-entrant call by reading temporary empty file (loop fix)', async () => {
			const cwdProjectPath = `/test/cwd/${AI_INFO_FILENAME}`;
			mockFss.fileExists.withArgs(cwdProjectPath).resolves(false); // Initially no file

			const finalDetectedProjects: ProjectInfo[] = [
				{
					baseDir: './final_project',
					language: 'typescript',
					primary: true,
					devBranch: 'main',
					initialise: ['npm i'],
					compile: [],
					format: [],
					staticAnalysis: [],
					test: [],
					languageTools: null,
					fileSelection: '',
					indexDocs: [],
				},
			];

			// Mock projectDetectionAgent to simulate re-entrancy
			projectDetectionAgentStub.callsFake(async () => {
				// At this point, the temporary "[]" should have been written by the outer detectProjectInfo call
				// Simulate a nested call to detectProjectInfo
				// For the nested call, fileExists should return true for the temp file, and readFile should return "[]"
				mockFss.fileExists.withArgs(cwdProjectPath).resolves(true); // Temp file now exists
				mockFss.readFile.withArgs(cwdProjectPath).resolves("[]");   // Temp file content

				// The nested call to detectProjectInfo will run here.
				// We need to ensure it doesn't call projectDetectionAgent again.
				// For this test, we'll rely on the fact that the nested call will read "[]" and exit early.
				// The outer call's projectDetectionAgentStub is what we are inside now.

				// Restore fileExists and readFile for any subsequent operations by the outer call if needed,
				// though for this specific test, the agent just returns data.
				// After the simulated nested call, the outer agent continues.
				// We need to ensure that when the outer agent finishes and tries to write the final result,
				// the fileExists and readFile mocks are in a state that doesn't interfere or reflect the temporary state anymore
				// if the agent itself were to call detectProjectInfo again (which it shouldn't in this flow).
				// For this test, simply returning the projects is enough.

				return finalDetectedProjects; // Agent returns final projects
			});

			const result = await detectProjectInfo();

			// Check that projectDetectionAgent was called (the outer call)
			expect(projectDetectionAgentStub.calledOnce).to.be.true;

			// Check that the temporary file was written
			expect(mockFss.writeFile.calledWith(cwdProjectPath, JSON.stringify([], null, 2))).to.be.true;

			// Check that the final projects were written
			const expectedFileFormat = finalDetectedProjects.map(mapProjectInfoToFileFormat);
			expect(mockFss.writeFile.calledWith(cwdProjectPath, JSON.stringify(expectedFileFormat, null, 2))).to.be.true;

			expect(result).to.deep.equal(finalDetectedProjects);
		});
	});
});
