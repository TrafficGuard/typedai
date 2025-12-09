import chai, { expect } from 'chai';
import chaiAsPromised from 'chai-as-promised';
import sinon from 'sinon';
import * as agentContextLocalStorage from '#agent/agentContextUtils';
import { appContext } from '#app/applicationContext';
import type { ApplicationContext } from '#app/applicationTypes';
import { FileSystemService } from '#functions/storage/fileSystemService';
import { InMemoryCodeTaskRepository } from '#modules/memory/inMemoryCodeTaskRepository';
import type { CodeTask, CodeTaskStatus } from '#shared/codeTask/codeTask.model';
import { setupConditionalLoggerOutput } from '#test/testUtils';
import { CodeTaskCreation } from './codeTaskCreation';
import type { CodeTaskRepository } from './codeTaskRepository';
import { getCodeTaskRepositoryPath } from './codeTaskRepositoryPath';

chai.use(chaiAsPromised);

// Define a helper interface for the ApplicationContext that includes agentService
// This is used to inform TypeScript about the expected shape of agentService for stubbing purposes in this test.
interface AgentServiceWithStartAgent {
	startAgent: (...args: any[]) => Promise<{ agentId: string; execution: Promise<any> }>;
}

interface TestApplicationContext extends ApplicationContext {
	agentService: AgentServiceWithStartAgent;
}

describe.skip('CodeTaskCreation', () => {
	setupConditionalLoggerOutput();

	let codeTaskRepo: CodeTaskRepository;
	let codeTaskCreation: CodeTaskCreation;
	let mockFss: sinon.SinonStubbedInstance<FileSystemService>;
	let getFileSystemStub: sinon.SinonStub;
	let updateCodeTaskSpy: sinon.SinonSpy;
	let startAgentStub: sinon.SinonStub;

	const userId = 'test-user-id';
	const codeTaskId = 'test-codeTask-id';

	beforeEach(async () => {
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

		// Stub appContext().agentService.startAgent()
		// We use a type assertion here because the base ApplicationContext type might not include agentService,
		// but it's expected to be present in the test environment (e.g., in InMemoryApplicationContext).
		startAgentStub = sinon.stub((appContext() as unknown as TestApplicationContext).agentService, 'startAgent').resolves({
			agentId: 'mock-agent-id-from-stub',
			execution: Promise.resolve('mock-execution-result-from-stub'),
		});

		// Ensure the test user exists for CodeTaskCreation tests
		const userService = appContext().userService;
		try {
			// Attempt to get the user to see if it already exists
			await userService.getUser(userId);
		} catch (error: any) {
			// Check if the error is because the user was not found
			// Making the error check more robust by checking for a common part of the expected error message.
			if (error.message?.toLowerCase().includes('no user found')) {
				// If user not found, create them
				await userService.createUser({
					id: userId, // This is the 'test-user-id'
					email: `${userId}@example.com`, // Provide a unique email
					name: 'Test User for CodeTask',
					enabled: true,
				});
			} else {
				// If it's some other error, re-throw it as it's unexpected
				console.error('Unexpected error while checking/creating user in test setup:', error);
				throw error;
			}
		}

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
