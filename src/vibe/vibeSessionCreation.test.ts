import chai, { expect } from 'chai';
import chaiAsPromised from 'chai-as-promised';
import sinon from 'sinon';
import * as agentContextLocalStorage from '#agent/agentContextLocalStorage';
import { FileSystemService } from '#functions/storage/fileSystemService';
import { InMemoryVibeRepository } from '#modules/memory/inMemoryVibeRepository';
import type { VibeSession, VibeStatus } from '#shared/model/vibe.model';
import { setupConditionalLoggerOutput } from '#test/testUtils';
import type { VibeRepository } from '#vibe/vibeRepository';
import { getVibeRepositoryPath } from '#vibe/vibeRepositoryPath';
import { VibeSessionCreation } from '#vibe/vibeSessionCreation';

chai.use(chaiAsPromised);

describe('VibeSessionCreation', () => {
	setupConditionalLoggerOutput();

	let vibeRepo: VibeRepository;
	let vibeCreation: VibeSessionCreation;
	let mockFss: sinon.SinonStubbedInstance<FileSystemService>;
	let getFileSystemStub: sinon.SinonStub;
	let updateVibeSessionSpy: sinon.SinonSpy;

	const userId = 'test-user-id';
	const sessionId = 'test-session-id';

	beforeEach(() => {
		vibeRepo = new InMemoryVibeRepository();
		updateVibeSessionSpy = sinon.spy(vibeRepo, 'updateVibeSession');

		mockFss = sinon.createStubInstance(FileSystemService);
		// Assume a method like setupVibeWorkspace exists and returns relevant info
		(mockFss as any).setupVibeWorkspace = sinon.stub().resolves({
			commitSha: 'abcdef1234567890',
			actualRepositoryName: 'typedai-from-clone',
			defaultBranch: 'main',
		});
		getFileSystemStub = sinon.stub(agentContextLocalStorage, 'getFileSystem').returns(mockFss);

		vibeCreation = new VibeSessionCreation(vibeRepo);
	});

	afterEach(() => {
		sinon.restore();
	});

	/**
	 * Create a VibeSession with specific values set required for a test, and defaulting the others
	 * @param overrides
	 */
	const createSession = (overrides: Partial<VibeSession> = {}): VibeSession => {
		const now = Date.now();
		const defaults: VibeSession = {
			id: sessionId,
			userId: userId,
			title: 'Test Session',
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

	describe('_runSessionInitialization', () => {
		it('should initialize workspace, update session status, and store repository details', async () => {
			const initialSession = createSession({
				repositorySource: 'github',
				repositoryId: 'TrafficGuard/typedai',
				repositoryName: 'TypedAI',
				targetBranch: 'develop',
				workingBranch: 'vibe/init-test',
				createWorkingBranch: true,
				useSharedRepos: true,
			});
			await vibeRepo.createVibeSession(initialSession);

			await vibeCreation._runSessionInitialization(userId, sessionId);

			const expectedPath = getVibeRepositoryPath(initialSession);

			// verify .git folder exists in the expectedPath
			// verify with git the branch is as expected
		});
	});
});
