import chai, { expect } from 'chai';
import chaiAsPromised from 'chai-as-promised';
import sinon from 'sinon';
import * as agentContextLocalStorage from '#agent/agentContextLocalStorage';
import { FileSystemService } from '#functions/storage/fileSystemService';
import { InMemoryCodeTaskRepository } from '#modules/memory/inMemoryCodeTaskRepository';
import type { CodeTask, CodeTaskStatus } from '#shared/model/codeTask.model';
import { setupConditionalLoggerOutput } from '#test/testUtils';
import { CodeTaskCreation } from './codeTaskCreation';
import type { CodeTaskRepository } from './codeTaskRepository';
import { getCodeTaskRepositoryPath } from './codeTaskRepositoryPath';

chai.use(chaiAsPromised);

describe('CodeTaskCreation', () => {
	setupConditionalLoggerOutput();

	let codeTaskRepo: CodeTaskRepository;
	let codeTaskCreation: CodeTaskCreation;
	let mockFss: sinon.SinonStubbedInstance<FileSystemService>;
	let getFileSystemStub: sinon.SinonStub;
	let updateCodeTaskSpy: sinon.SinonSpy;

	const userId = 'test-user-id';
	const codeTaskId = 'test-codeTask-id';

	beforeEach(() => {
		codeTaskRepo = new InMemoryCodeTaskRepository();
		updateCodeTaskSpy = sinon.spy(codeTaskRepo, 'updateCodeTask');

		mockFss = sinon.createStubInstance(FileSystemService);
		// Assume a method like setupCodeTaskWorkspace exists and returns relevant info
		(mockFss as any).setupCodeTaskWorkspace = sinon.stub().resolves({
			commitSha: 'abcdef1234567890',
			actualRepositoryName: 'typedai-from-clone',
			defaultBranch: 'main',
		});
		getFileSystemStub = sinon.stub(agentContextLocalStorage, 'getFileSystem').returns(mockFss);

		codeTaskCreation = new CodeTaskCreation(codeTaskRepo);
	});

	afterEach(() => {
		sinon.restore();
	});

	/**
	 * Create a CodeTask with specific values set required for a test, and defaulting the others
	 * @param overrides
	 */
	const createCodeTask = (overrides: Partial<CodeTask> = {}): CodeTask => {
		const now = Date.now();
		const defaults: CodeTask = {
			id: codeTaskId,
			userId: userId,
			title: 'Test CodeTask',
			instructions: 'Do the thing',
			repositorySource: 'github',
			repositoryId: 'owner/repo',
			targetBranch: 'main',
			workingBranch: 'feat/test',
			createWorkingBranch: true,
			useSharedRepos: false,
			status: 'initializing',
			lastAgentActivity: now - 10000,
			createdAt: now - 20000,
			updatedAt: now - 10000,
			error: null,
			// Other fields can be added as needed
		};
		return { ...defaults, ...overrides };
	};

	describe('_runCodeTaskInitialization', () => {
		it('should initialize workspace, update codeTask status, and store repository details', async () => {
			const initialCodeTask = createCodeTask({
				repositorySource: 'github',
				repositoryId: 'TrafficGuard/typedai',
				repositoryName: 'TypedAI',
				targetBranch: 'develop',
				workingBranch: 'codeTask/init-test',
				createWorkingBranch: true,
				useSharedRepos: true,
			});
			await codeTaskRepo.createCodeTask(initialCodeTask);

			await codeTaskCreation._runCodeTaskInitialization(userId, codeTaskId);

			const expectedPath = getCodeTaskRepositoryPath(initialCodeTask);

			// verify .git folder exists in the expectedPath
			// verify with git the branch is as expected
		});
	});
});
