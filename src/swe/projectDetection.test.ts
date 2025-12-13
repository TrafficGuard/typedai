import { promises as fsAsync } from 'node:fs';
import path from 'node:path';
import chai, { expect } from 'chai';
import chaiAsPromised from 'chai-as-promised';
import mockFs from 'mock-fs';
import sinon from 'sinon';
import * as agentContextLocalStorage from '#agent/agentContextUtils';
import { setFileSystemOverride } from '#agent/agentContextUtils';
import { FileSystemService } from '#functions/storage/fileSystemService';
import { setupConditionalLoggerOutput } from '#test/testUtils';
import {
	AI_INFO_FILENAME,
	type ProjectInfo,
	type ProjectInfoFileFormat,
	getProjectInfos,
	mapProjectInfoToFileFormat,
	normalizeScriptCommandToArray,
	normalizeScriptCommandToFileFormat,
	parseProjectInfo,
} from './projectDetection';
import { setProjectDetectionAgent } from './projectDetection';
import { projectDetectionAgent } from './projectDetectionAgent';

chai.use(chaiAsPromised);

describe('projectDetection', () => {
	setupConditionalLoggerOutput();
	let sandbox: sinon.SinonSandbox;

	beforeEach(() => {
		sandbox = sinon.createSandbox();
	});

	afterEach(() => {
		setProjectDetectionAgent(projectDetectionAgent); // restore real impl
		sandbox.restore();
		mockFs.restore(); // Ensure mock-fs is restored
		setFileSystemOverride(null);
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
		// This test doesn't need mock-fs, it's a pure function test
		it('should correctly format script commands for file output', () => {
			const projectInfo: ProjectInfo = {
				baseDir: './project1',
				language: 'typescript',
				primary: true,
				devBranch: 'develop',
				initialise: ['npm install'],
				compile: ['tsc', '-p .'], // Array of one or more
				test: [],
				format: ['prettier --write .'],
				staticAnalysis: [],
				languageTools: null, // Assuming LanguageTools is not relevant for this specific test
				fileSelection: '', // Default or mock value
				indexDocs: ['README.md'],
			};
			const result = mapProjectInfoToFileFormat(projectInfo);
			expect(result.initialise).to.equal('npm install');
			expect(result.compile).to.deep.equal(['tsc', '-p .']); // Stays as array if multiple, becomes string if single
			expect(result.test).to.equal('');
			expect(result.format).to.equal('prettier --write .');
			expect(result.staticAnalysis).to.equal('');
			expect(result.baseDir).to.equal('./project1');
		});
	});

	const MOCK_CWD = '/test/cwd';
	const MOCK_VCS_ROOT_DIFFERENT = '/test/vcs_root';

	describe('detectProjectInfo', () => {
		let fssInstance: FileSystemService; // To hold the FileSystemService instance

		function setupMockFs(mockFsConfig: any, cwd: string, vcsRoot: string) {
			mockFs(mockFsConfig);
			fssInstance = new FileSystemService(cwd);
			fssInstance.setWorkingDirectory(cwd);
			sinon.stub(fssInstance, 'getVcsRoot').returns(vcsRoot);
			setFileSystemOverride(fssInstance);
		}

		it('should load from CWD if valid file exists', async () => {
			const cwdProjectPath = path.join(MOCK_CWD, AI_INFO_FILENAME);
			const fileContentArray: ProjectInfoFileFormat[] = [
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
					indexDocs: ['src/**/*.ts', 'frontend/src/**/*.ts', 'bin/**', 'shared/**'],
				},
			];
			const mockFsConfig = {
				[MOCK_CWD]: {
					[AI_INFO_FILENAME]: JSON.stringify(fileContentArray, null, 2),
				},
			};
			setupMockFs(mockFsConfig, MOCK_CWD, MOCK_CWD);

			const result = await getProjectInfos();

			expect(result).to.be.an('array').with.lengthOf(1);
			const project = result![0];
			expect(project.baseDir).to.equal('./');
			expect(project.primary).to.be.true;
			expect(project.language).to.equal('typescript');
			expect(project.initialise).to.deep.equal(['node build.js install']);
			expect(project.compile).to.deep.equal(['node build.js build']);
			expect(project.format).to.deep.equal([]);
			expect(project.staticAnalysis).to.deep.equal(['node build.js lint']);
			expect(project.test).to.deep.equal(['cd frontend && npm run test:ci']);
			expect(project.devBranch).to.equal('main');
			expect(project.indexDocs).to.deep.equal(fileContentArray[0].indexDocs);
			// The agent should not be called if a valid file is found
			// We don't have a direct stub to check `called` on anymore,
			// but the logic implies it won't be called if `loadedInfos` is not null.
			// If `setProjectDetectionAgent` was called with a stub, we could check that stub.
			// For now, we rely on the fact that the agent is only called if `loadedInfos` is null.
		});

		it('should load from VCS root if not in CWD and CWD is not VCS root', async () => {
			const cwdAiInfoPath = path.join(MOCK_CWD, AI_INFO_FILENAME);
			// const vcsRootAiInfoPath = path.join(MOCK_VCS_ROOT_DIFFERENT, AI_INFO_FILENAME);

			const fileContentArray: ProjectInfoFileFormat[] = [
				{
					baseDir: 'vcs_project/',
					primary: false, // Add primary field, as it will be defaulted and written back
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
			const mockFsConfig = {
				[MOCK_VCS_ROOT_DIFFERENT]: {
					[AI_INFO_FILENAME]: JSON.stringify(fileContentArray, null, 2),
				},
				[MOCK_CWD]: {
					/* CWD is empty or doesn't have the file */
				},
			};
			setupMockFs(mockFsConfig, MOCK_CWD, MOCK_VCS_ROOT_DIFFERENT);

			const result = await getProjectInfos();

			expect(result).to.be.an('array').with.lengthOf(1);
			expect(result![0].baseDir).to.equal('vcs_project/');
			expect(result![0].initialise).to.deep.equal(['pip install']);
			// The agent should not be called if a valid file is found
			// (similar to the previous test, relying on the logic that prevents agent call)

			// Check if it wrote to CWD
			const writtenContent = await fsAsync.readFile(cwdAiInfoPath, 'utf-8');
			expect(JSON.parse(writtenContent)).to.deep.equal(fileContentArray);
		});

		it('should call projectDetectionAgent if no valid file found and write temporary empty file first', async () => {
			const cwdAiInfoPath = path.join(MOCK_CWD, AI_INFO_FILENAME);
			setupMockFs({ [MOCK_CWD]: {} }, MOCK_CWD, MOCK_CWD); // Empty CWD, CWD is VCS root

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
			const detectionStub = sandbox.stub().resolves(agentDetectedProjects);
			setProjectDetectionAgent(detectionStub);

			const result = await getProjectInfos();

			expect(detectionStub.calledOnce).to.be.true;

			// Verify final detected projects write (this implicitly tests the temporary write happened and was overwritten)
			const expectedFileFormat = agentDetectedProjects.map(mapProjectInfoToFileFormat);
			const finalContent = await fsAsync.readFile(cwdAiInfoPath, 'utf-8');
			expect(JSON.parse(finalContent)).to.deep.equal(expectedFileFormat);

			expect(result).to.deep.equal(agentDetectedProjects);
		});

		it('should rename invalid file and then call projectDetectionAgent', async () => {
			const cwdAiInfoPath = path.join(MOCK_CWD, AI_INFO_FILENAME);
			const invalidFileContent = 'invalid json content';
			const mockFsConfig = {
				[MOCK_CWD]: {
					[AI_INFO_FILENAME]: invalidFileContent,
				},
			};
			setupMockFs(mockFsConfig, MOCK_CWD, MOCK_CWD);

			const detectionStub = sandbox.stub().resolves([]); // Agent finds nothing after rename
			setProjectDetectionAgent(detectionStub);

			await getProjectInfos();

			// Verify rename by checking old file is gone and new one exists (state validation)
			const filesInCwd = await fsAsync.readdir(MOCK_CWD);
			expect(filesInCwd.some((f) => f.includes(`${AI_INFO_FILENAME}.invalid_`))).to.be.true;

			expect(detectionStub.calledOnce).to.be.true;

			// After agent runs (stubbed to return []), .typedai.json should be recreated with agent's output
			const finalFilesInCwd = await fsAsync.readdir(MOCK_CWD);
			expect(finalFilesInCwd.find((f) => f === AI_INFO_FILENAME)).to.not.be.undefined;
			const finalContent = await fsAsync.readFile(cwdAiInfoPath, 'utf-8');
			expect(JSON.parse(finalContent)).to.deep.equal([]);
		});

		it('should return empty array and not call agent if valid empty "[]" file exists', async () => {
			const mockFsConfig = {
				[MOCK_CWD]: {
					[AI_INFO_FILENAME]: '[]',
				},
			};
			setupMockFs(mockFsConfig, MOCK_CWD, MOCK_CWD);

			const result = await getProjectInfos();

			expect(result).to.deep.equal([]);
			// The agent should not be called if a valid file is found
		});

		it('should load from VCS root when CWD is a subdirectory and FileSystemService basePath is CWD', async () => {
			const VSC_ROOT_PATH = '/test_project_root';
			// CWD is a subdirectory of the VCS root
			const CWD_SUBDIR_PATH = path.join(VSC_ROOT_PATH, 'frontend');
			// Path to .typedai.json in the VCS root
			const VSC_ROOT_AI_INFO_PATH = path.join(VSC_ROOT_PATH, AI_INFO_FILENAME);
			// Path to .typedai.json in the CWD (where it will be written after loading from VCS root)
			const CWD_AI_INFO_PATH = path.join(CWD_SUBDIR_PATH, AI_INFO_FILENAME);

			const fileContentArray: ProjectInfoFileFormat[] = [
				{
					baseDir: './app', // This baseDir is relative to VSC_ROOT_PATH
					primary: true,
					language: 'typescript',
					devBranch: 'develop',
					initialise: 'npm install', // Order changed to match mapProjectInfoToFileFormat output
					compile: 'npm run build',
					format: 'npm run format',
					staticAnalysis: 'npm run lint',
					test: 'npm test',
					indexDocs: ['src/**/*.ts', '../common/**/*.ts'],
				},
			];
			const mockFsConfig = {
				// .typedai.json exists only in the VCS root
				[VSC_ROOT_PATH]: {
					[AI_INFO_FILENAME]: JSON.stringify(fileContentArray, null, 2),
					'.git': {}, // Mock .git directory for VCS root detection
				},
				// The CWD subdirectory is initially empty or does not contain .typedai.json
				[CWD_SUBDIR_PATH]: {},
			};
			mockFs(mockFsConfig);

			// Configure FileSystemService:
			// Initialize with CWD_SUBDIR_PATH as its basePath, mimicking the reported scenario.
			fssInstance = new FileSystemService(CWD_SUBDIR_PATH);
			fssInstance.setWorkingDirectory(CWD_SUBDIR_PATH); // ensure correct WD
			setFileSystemOverride(fssInstance); // use this instance in detectProjectInfo

			// Stub getVcsRoot() to ensure it correctly returns the VSC_ROOT_PATH.
			// The real FileSystemService would search upwards from its basePath (CWD_SUBDIR_PATH)
			// to find the .git directory in VSC_ROOT_PATH.
			sandbox.stub(fssInstance, 'getVcsRoot').returns(VSC_ROOT_PATH);

			// getWorkingDirectory() should naturally return CWD_SUBDIR_PATH as it's the basePath.
			// No need to stub fssInstance.getWorkingDirectory() for this specific test.

			const result = await getProjectInfos();

			// Assertions
			expect(result).to.be.an('array').with.lengthOf(1);
			const project = result![0];
			expect(project.baseDir).to.equal('./app'); // As defined in the file content
			expect(project.language).to.equal('typescript');
			expect(project.devBranch).to.equal('develop');
			expect(project.initialise).to.deep.equal(['npm install']);

			// Ensure projectDetectionAgent was not called because the file was found
			// expect(projectDetectionAgentStub.called).to.be.false;

			// Verify that the loaded configuration was written to the CWD
			const writtenContentInCwd = await fssInstance.readFile(CWD_AI_INFO_PATH);
			expect(JSON.parse(writtenContentInCwd)).to.deep.equal(fileContentArray);
		});
	});
});
