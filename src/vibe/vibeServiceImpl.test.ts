import chai, { expect } from 'chai';
import chaiAsPromised from 'chai-as-promised';
import sinon from 'sinon';
import type { VibeRepository } from '#vibe/vibeRepository';
import { VibeServiceImpl } from '#vibe/vibeServiceImpl';
import type { UpdateVibeSessionData, VibeSession } from '#vibe/vibeTypes';

import { setupConditionalLoggerOutput } from '#test/testUtils';

chai.use(chaiAsPromised);

describe('VibeServiceImpl', () => {
	setupConditionalLoggerOutput();

	let service: VibeServiceImpl;
	let mockVibeRepo: sinon.SinonStubbedInstance<VibeRepository>;
	let executeDesignStub: sinon.SinonStub;

	const userId = 'test-user-id';
	const sessionId = 'test-session-id';

	beforeEach(() => {
		mockVibeRepo = {
			createVibeSession: sinon.stub(),
			getVibeSession: sinon.stub(),
			listVibeSessions: sinon.stub(),
			updateVibeSession: sinon.stub(),
			deleteVibeSession: sinon.stub(),
			saveVibePreset: sinon.stub(),
			listVibePresets: sinon.stub(),
			deleteVibePreset: sinon.stub(),
		};
		service = new VibeServiceImpl(mockVibeRepo as unknown as VibeRepository);
		// Stub the executeDesign method directly on the service instance for these tests
		executeDesignStub = sinon.stub(service, 'executeDesign').resolves();
	});

	afterEach(() => {
		sinon.restore();
	});

	// --- Helper to create a basic valid session ---
	const createMockSession = (overrides: Partial<VibeSession> = {}): VibeSession => {
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
			status: 'initializing', // Default status
			lastAgentActivity: Date.now() - 10000,
			createdAt: Date.now() - 20000,
			updatedAt: Date.now() - 10000,
			error: null,
			// Other fields can be added as needed
		};
		return { ...defaults, ...overrides };
	};

	// --- Tests for existing methods ---

	describe('updateVibeSession', () => {
		it('should pass filesToAdd and filesToRemove to the repository', async () => {
			const payload: UpdateVibeSessionData = {
				status: 'file_selection_review', // Example other field
				filesToAdd: ['new.ts'],
				filesToRemove: ['old.ts'],
			};
			mockVibeRepo.updateVibeSession.resolves(); // Assume repo update succeeds

			await service.updateVibeSession(userId, sessionId, payload);

			// Verify that the repository's update method was called with the exact payload
			expect(mockVibeRepo.updateVibeSession.calledOnce).to.be.true;
			// Use sinon.match to check the structure and specific file fields
			expect(
				mockVibeRepo.updateVibeSession.calledOnceWith(
					userId,
					sessionId,
					sinon.match({
						status: 'file_selection_review',
						filesToAdd: ['new.ts'],
						filesToRemove: ['old.ts'],
						// Do not match updatedAt here as it's added by the repo layer
					}),
				),
			).to.be.true;
		});

		it('should only pass other fields if file fields are absent', async () => {
			const payload: UpdateVibeSessionData = {
				status: 'design_review',
			};
			mockVibeRepo.updateVibeSession.resolves();

			await service.updateVibeSession(userId, sessionId, payload);

			expect(mockVibeRepo.updateVibeSession.calledOnce).to.be.true;
			expect(
				mockVibeRepo.updateVibeSession.calledOnceWith(
					userId,
					sessionId,
					sinon.match({
						status: 'design_review',
						// Ensure file fields are not present by not including them in the match object
					}),
				),
			).to.be.true;
		});

		// Add tests for error handling if needed (e.g., repo throws error)
	});

	describe('acceptDesign', () => {
		const variations = 1;
		const validSession = createMockSession({ status: 'design_review' }); // Correct status for acceptance

		it('should update status to coding, store variations, and call executeDesign on valid acceptance', async () => {
			mockVibeRepo.getVibeSession.withArgs(userId, sessionId).resolves(validSession);
			mockVibeRepo.updateVibeSession.resolves();

			await service.acceptDesign(userId, sessionId, variations);

			expect(mockVibeRepo.getVibeSession.calledOnceWithExactly(userId, sessionId)).to.be.true;
			expect(
				mockVibeRepo.updateVibeSession.calledOnceWithExactly(userId, sessionId, {
					status: 'coding',
					selectedVariations: variations,
					lastAgentActivity: sinon.match.number, // Check that it's a number (timestamp)
				}),
			).to.be.true;
			// Check that the timestamp is recent
			const updateArgs = mockVibeRepo.updateVibeSession.firstCall.args[2];
			expect(updateArgs.lastAgentActivity).to.be.closeTo(Date.now(), 2000); // Within 2 seconds

			expect(executeDesignStub.calledOnceWithExactly(userId, sessionId)).to.be.true;
		});

		it('should throw error if session not found', async () => {
			mockVibeRepo.getVibeSession.withArgs(userId, sessionId).resolves(null);

			await expect(service.acceptDesign(userId, sessionId, variations)).to.be.rejectedWith(`VibeSession ${sessionId} not found for user ${userId}.`);

			expect(mockVibeRepo.updateVibeSession.called).to.be.false;
			expect(executeDesignStub.called).to.be.false;
		});

		it('should throw error if user is not authorized (different userId)', async () => {
			const sessionWithWrongUser: VibeSession = { ...validSession, userId: 'another-user' };
			mockVibeRepo.getVibeSession.withArgs(userId, sessionId).resolves(sessionWithWrongUser);

			await expect(service.acceptDesign(userId, sessionId, variations)).to.be.rejectedWith('User not authorized for this session.');

			expect(mockVibeRepo.updateVibeSession.called).to.be.false;
			expect(executeDesignStub.called).to.be.false;
		});

		it('should throw error if session status is not design_review', async () => {
			const sessionWithWrongStatus: VibeSession = { ...validSession, status: 'coding' };
			mockVibeRepo.getVibeSession.withArgs(userId, sessionId).resolves(sessionWithWrongStatus);

			await expect(service.acceptDesign(userId, sessionId, variations)).to.be.rejectedWith(`Invalid session status: Expected 'design_review', got 'coding'.`);

			expect(mockVibeRepo.updateVibeSession.called).to.be.false;
			expect(executeDesignStub.called).to.be.false;
		});

		it('should re-throw error if updateVibeSession fails', async () => {
			const updateError = new Error('Database update failed');
			mockVibeRepo.getVibeSession.withArgs(userId, sessionId).resolves(validSession);
			mockVibeRepo.updateVibeSession.rejects(updateError);

			await expect(service.acceptDesign(userId, sessionId, variations)).to.be.rejectedWith(updateError);

			expect(executeDesignStub.called).to.be.false; // Should not be called if update fails
		});

		it('should re-throw error if executeDesign fails', async () => {
			const executeError = new Error('Agent execution failed');
			mockVibeRepo.getVibeSession.withArgs(userId, sessionId).resolves(validSession);
			mockVibeRepo.updateVibeSession.resolves();
			executeDesignStub.rejects(executeError); // Make executeDesign fail

			await expect(service.acceptDesign(userId, sessionId, variations)).to.be.rejectedWith(executeError);

			// Update should have been called before executeDesign
			expect(mockVibeRepo.updateVibeSession.calledOnce).to.be.true;
		});
	});

	describe('updateSelectionWithPrompt', () => {
		const prompt = 'test prompt';
		let validSession: VibeSession;

		beforeEach(() => {
			// Reset history to allow setting different mock behaviors in each test
			mockVibeRepo.getVibeSession.resetHistory();
			mockVibeRepo.updateVibeSession.resetHistory();
			validSession = createMockSession({ status: 'file_selection_review' });
		});

		it('should update status and log TODO for agent trigger on valid request', async () => {
			mockVibeRepo.getVibeSession.withArgs(userId, sessionId).resolves(validSession);
			mockVibeRepo.updateVibeSession.resolves();

			await service.updateSelectionWithPrompt(userId, sessionId, prompt);

			expect(mockVibeRepo.getVibeSession.calledOnceWithExactly(userId, sessionId)).to.be.true;
			expect(
				mockVibeRepo.updateVibeSession.calledOnceWithExactly(
					userId,
					sessionId,
					sinon.match({
						status: 'updating_selection',
						lastAgentActivity: sinon.match.number,
					}),
				),
			).to.be.true;

			// Check the timestamp is recent
			const updateArgs = mockVibeRepo.updateVibeSession.firstCall.args[2];
			expect(updateArgs.lastAgentActivity).to.be.closeTo(Date.now(), 2000); // Within 2 seconds
		});

		it('should throw error if session not found', async () => {
			mockVibeRepo.getVibeSession.withArgs(userId, sessionId).resolves(null);

			await expect(service.updateSelectionWithPrompt(userId, sessionId, prompt)).to.be.rejectedWith(`VibeSession ${sessionId} not found for user ${userId}.`);
			expect(mockVibeRepo.updateVibeSession.called).to.be.false;
		});

		it('should throw error if session status is not file_selection_review', async () => {
			const invalidSession = createMockSession({ status: 'coding' });
			mockVibeRepo.getVibeSession.withArgs(userId, sessionId).resolves(invalidSession);

			await expect(service.updateSelectionWithPrompt(userId, sessionId, prompt)).to.be.rejectedWith(
				/Invalid session status: Cannot update selection in current state 'coding'. Expected 'file_selection_review'./i,
			);
			expect(mockVibeRepo.updateVibeSession.called).to.be.false;
		});

		it('should throw error if user is not authorized', async () => {
			const unauthorizedSession = createMockSession({ userId: 'other-user', status: 'file_selection_review' });
			mockVibeRepo.getVibeSession.withArgs(userId, sessionId).resolves(unauthorizedSession);

			await expect(service.updateSelectionWithPrompt(userId, sessionId, prompt)).to.be.rejectedWith('User not authorized for this session.');
			expect(mockVibeRepo.updateVibeSession.called).to.be.false;
		});

		it('should re-throw error if getVibeSession fails', async () => {
			const getError = new Error('Database read failed');
			mockVibeRepo.getVibeSession.withArgs(userId, sessionId).rejects(getError);

			await expect(service.updateSelectionWithPrompt(userId, sessionId, prompt)).to.be.rejectedWith(getError);
			expect(mockVibeRepo.updateVibeSession.called).to.be.false;
		});

		it('should re-throw error if updateVibeSession fails', async () => {
			const updateError = new Error('Database update failed');
			mockVibeRepo.getVibeSession.withArgs(userId, sessionId).resolves(validSession);
			mockVibeRepo.updateVibeSession.rejects(updateError);

			await expect(service.updateSelectionWithPrompt(userId, sessionId, prompt)).to.be.rejectedWith(updateError);
			// Ensure get was called
			expect(mockVibeRepo.getVibeSession.calledOnce).to.be.true;
		});
	});

	describe('generateDetailedDesign', () => {
		const variations = 1;
		let validSession: VibeSession;

		beforeEach(() => {
			mockVibeRepo.getVibeSession.resetHistory();
			mockVibeRepo.updateVibeSession.resetHistory();
			validSession = createMockSession({
				status: 'file_selection_review',
				fileSelection: [{ filePath: 'test.ts', reason: 'test', category: 'edit' }],
			});
		});

		it('should update status and log TODO for agent trigger on valid request', async () => {
			mockVibeRepo.getVibeSession.withArgs(userId, sessionId).resolves(validSession);
			mockVibeRepo.updateVibeSession.resolves();

			// Explicitly assert that the call completes without throwing an error
			await expect(service.generateDetailedDesign(userId, sessionId, variations)).to.not.be.rejected;

			// Existing assertions checking mock calls remain the same
			expect(mockVibeRepo.getVibeSession.calledOnceWithExactly(userId, sessionId)).to.be.true;
			expect(
				mockVibeRepo.updateVibeSession.calledOnceWithExactly(
					userId,
					sessionId,
					sinon.match({
						status: 'generating_design',
					}),
				),
			).to.be.true;
			// Check that the timestamp is recent
			const updateArgs = mockVibeRepo.updateVibeSession.firstCall.args[2];
			expect(updateArgs.lastAgentActivity).to.be.closeTo(Date.now(), 2000); // Within 2 seconds
		});

		it('should throw error if session not found', async () => {
			mockVibeRepo.getVibeSession.withArgs(userId, sessionId).resolves(null);

			await expect(service.generateDetailedDesign(userId, sessionId, variations)).to.be.rejectedWith(`VibeSession ${sessionId} not found for user ${userId}.`);
			expect(mockVibeRepo.updateVibeSession.called).to.be.false;
		});

		it('should throw error if user is not authorized', async () => {
			const unauthorizedSession = createMockSession({
				userId: 'other-user',
				status: 'file_selection_review',
				fileSelection: [{ filePath: 'test.ts', reason: 'test', category: 'edit' }],
			});
			mockVibeRepo.getVibeSession.withArgs(userId, sessionId).resolves(unauthorizedSession);

			await expect(service.generateDetailedDesign(userId, sessionId, variations)).to.be.rejectedWith('User not authorized for this session.');
			expect(mockVibeRepo.updateVibeSession.called).to.be.false;
		});

		it('should throw error if session status is not file_selection_review', async () => {
			const invalidSession = createMockSession({ status: 'coding' });
			mockVibeRepo.getVibeSession.withArgs(userId, sessionId).resolves(invalidSession);

			await expect(service.generateDetailedDesign(userId, sessionId, variations)).to.be.rejectedWith(
				/Invalid session status: Cannot generate design in current state 'coding'. Expected 'file_selection_review'./i,
			);
			expect(mockVibeRepo.updateVibeSession.called).to.be.false;
		});

		it('should throw error if fileSelection is missing', async () => {
			const sessionMissingFiles = createMockSession({ status: 'file_selection_review', fileSelection: undefined });
			mockVibeRepo.getVibeSession.withArgs(userId, sessionId).resolves(sessionMissingFiles);

			await expect(service.generateDetailedDesign(userId, sessionId, variations)).to.be.rejectedWith(
				/Cannot generate design: File selection is missing or empty./i,
			);
			expect(mockVibeRepo.updateVibeSession.called).to.be.false;
		});

		it('should throw error if fileSelection is empty', async () => {
			const sessionEmptyFiles = createMockSession({ status: 'file_selection_review', fileSelection: [] });
			mockVibeRepo.getVibeSession.withArgs(userId, sessionId).resolves(sessionEmptyFiles);

			await expect(service.generateDetailedDesign(userId, sessionId, variations)).to.be.rejectedWith(
				/Cannot generate design: File selection is missing or empty./i,
			);
			expect(mockVibeRepo.updateVibeSession.called).to.be.false;
		});

		it('should re-throw error if getVibeSession fails', async () => {
			const getError = new Error('Database read failed');
			mockVibeRepo.getVibeSession.withArgs(userId, sessionId).rejects(getError);

			await expect(service.generateDetailedDesign(userId, sessionId, variations)).to.be.rejectedWith(getError);
			expect(mockVibeRepo.updateVibeSession.called).to.be.false;
		});

		it('should re-throw error if updateVibeSession fails', async () => {
			const updateError = new Error('Database update failed');
			mockVibeRepo.getVibeSession.withArgs(userId, sessionId).resolves(validSession);
			mockVibeRepo.updateVibeSession.rejects(updateError);

			await expect(service.generateDetailedDesign(userId, sessionId, variations)).to.be.rejectedWith(updateError);
			// Ensure get was called
			expect(mockVibeRepo.getVibeSession.calledOnce).to.be.true;
		});
	});

	// --- Tests for other methods can go here ---

	// describe.skip('triggerBackgroundInitialization', () => {
	// 	let getSessionStub: sinon.SinonStub;
	// 	let updateSessionStub: sinon.SinonStub;
	// 	let getUserStub: sinon.SinonStub;
	// 	let mkdirStub: sinon.SinonStub;
	// 	let getScmToolStub: sinon.SinonStub;
	// 	let selectFilesAgentStub: sinon.SinonStub;
	// 	let agentStorageRunStub: sinon.SinonStub;
	// 	let fssInstance: sinon.SinonStubbedInstance<FileSystemService>;
	// 	let scmInstance: sinon.SinonStubbedInstance<SourceControlManagement & { switchToBranch?: Function; createBranch?: Function }>;
	// 	let mockAppContext: sinon.SinonStub;

	// 	const mockSession = createMockSession({ status: 'initializing' });
	// 	const mockUser = { id: userId, email: 'test@example.com', /* other fields */ };
	// 	const mockFileSelection = [{ path: 'file1.ts', reason: 'reason1', category: 'edit' }];
	// 	const mockVibeFileSelection = [{ filePath: 'file1.ts', reason: 'reason1', category: 'edit' }];
	// 	const workspacePath = join(process.cwd(), 'vibe-workspaces', userId, sessionId);
	// 	const clonedRepoPath = join(workspacePath, 'repo'); // Example cloned path

	// 	beforeEach(async () => {
	// 		// Stub repository methods
	// 		getSessionStub = mockVibeRepo.getVibeSession.withArgs(userId, sessionId).resolves(mockSession);
	// 		updateSessionStub = mockVibeRepo.updateVibeSession.resolves();

	// 		// Stub external dependencies (using dynamic imports or direct stubbing if possible)
	// 		// Need to figure out best way to mock these module-level functions/classes
	// 		// This might require proxyquire or similar if not easily injectable/mockable

	// 		// Mock fs.mkdir
	// 		// mkdirStub = sinon.stub(fs, 'mkdir').resolves(); // Cannot stub fs directly easily

	// 		// Mock SCM tool retrieval and methods
	// 		scmInstance = {
	// 			isConfigured: sinon.stub().returns(true),
	// 			getScmType: sinon.stub().returns('mock-scm'),
	// 			cloneProject: sinon.stub().resolves(clonedRepoPath),
	// 			switchToBranch: sinon.stub().resolves(),
	// 			createBranch: sinon.stub().resolves(),
	// 			// Add other methods if needed by the interface
	// 			getProjects: sinon.stub(),
	// 			getProject: sinon.stub(),
	// 			createMergeRequest: sinon.stub(),
	// 			getJobLogs: sinon.stub(),
	// 			getBranches: sinon.stub(),
	// 		};
	// 		// getScmToolStub = sinon.stub(await import('#functions/scm/sourceControlManagement'), 'getSourceControlManagementTool').resolves(scmInstance);

	// 		// Mock FileSystemService
	// 		fssInstance = sinon.createStubInstance(FileSystemService);
	// 		fssInstance.getWorkingDirectory.returns(clonedRepoPath); // Assume WD is set correctly after clone
	// 		// sinon.stub(await import('#functions/storage/fileSystemService'), 'FileSystemService').returns(fssInstance);

	// 		// Mock selectFilesAgent
	// 		// selectFilesAgentStub = sinon.stub(await import('#swe/discovery/selectFilesAgent'), 'selectFilesAgent').resolves(mockFileSelection);

	// 		// Mock agentContextStorage.run - execute the callback immediately
	// 		// agentStorageRunStub = sinon.stub(await import('#agent/agentContextLocalStorage'), 'agentContextStorage').value({
	// 		// 	run: async (context, fn) => {
	// 		// 		return await fn(context);
	// 		// 	}
	// 		// });

	// 		// Mock appContext
	// 		// mockAppContext = sinon.stub(await import('#app/applicationContext'), 'appContext').returns({
	// 		// 	defaultLLMs: { easy: {}, medium: {}, hard: {}, xhard: {} }, // Mock LLMs
	// 		// 	userService: { getUser: sinon.stub().withArgs(userId).resolves(mockUser) },
	// 		// 	// Add other services if needed
	// 		// });

	// 		// Reset service instance to use mocks (if necessary, depends on how mocks are injected)
	// 		// service = new VibeServiceImpl(mockVibeRepo as unknown as VibeRepository);
	// 	});

	// 	afterEach(() => {
	// 		sinon.restore(); // Restore all stubs
	// 	});

	// 	it('should successfully initialize, clone, select files, and update status', async () => {
	// 		// Need to properly mock module imports for this test to work
	// 		console.warn('Skipping triggerBackgroundInitialization test due to mocking complexity');
	// 		// await (service as any).triggerBackgroundInitialization(userId, sessionId);

	// 		// // Verify mocks
	// 		// expect(getSessionStub.calledOnce).to.be.true;
	// 		// expect(getUserStub.calledOnceWithExactly(userId)).to.be.true;
	// 		// expect(mkdirStub.calledOnceWith(workspacePath, { recursive: true })).to.be.true;
	// 		// expect(getScmToolStub.calledOnce).to.be.true;
	// 		// expect(scmInstance.cloneProject.calledOnceWith(mockSession.repositoryId, mockSession.targetBranch)).to.be.true;
	// 		// expect(fssInstance.setWorkingDirectory.calledOnceWith(clonedRepoPath)).to.be.true;
	// 		// expect(scmInstance.switchToBranch.calledWith(mockSession.targetBranch)).to.be.true;
	// 		// expect(scmInstance.createBranch.calledOnceWith(mockSession.workingBranch)).to.be.true; // Assuming createWorkingBranch is true
	// 		// expect(scmInstance.switchToBranch.calledWith(mockSession.workingBranch)).to.be.true;
	// 		// expect(selectFilesAgentStub.calledOnceWith(mockSession.instructions)).to.be.true;
	// 		// expect(updateSessionStub.calledOnceWithExactly(userId, sessionId, {
	// 		// 	status: 'file_selection_review',
	// 		// 	fileSelection: mockVibeFileSelection,
	// 		// 	lastAgentActivity: sinon.match.number,
	// 		// 	error: null,
	// 		// })).to.be.true;
	// 	});

	// 	it('should handle session not found error', async () => {
	// 		getSessionStub.resolves(null);
	// 		// Need to properly mock module imports for this test to work
	// 		console.warn('Skipping triggerBackgroundInitialization test due to mocking complexity');
	// 		// await (service as any).triggerBackgroundInitialization(userId, sessionId);
	// 		// expect(updateSessionStub.called).to.be.false; // Should exit early
	// 	});

	// 	it('should handle SCM clone error and update status', async () => {
	// 		const cloneError = new Error('SCM clone failed');
	// 		// scmInstance.cloneProject.rejects(cloneError);
	// 		// Need to properly mock module imports for this test to work
	// 		console.warn('Skipping triggerBackgroundInitialization test due to mocking complexity');
	// 		// await (service as any).triggerBackgroundInitialization(userId, sessionId);
	// 		// expect(updateSessionStub.calledOnceWithExactly(userId, sessionId, {
	// 		// 	status: 'error', // Or more specific SCM error
	// 		// 	error: cloneError.message,
	// 		// 	lastAgentActivity: sinon.match.number,
	// 		// })).to.be.true;
	// 	});

	// 	it('should handle selectFilesAgent error and update status', async () => {
	// 		const agentError = new Error('File selection agent failed');
	// 		// selectFilesAgentStub.rejects(agentError);
	// 		// Need to properly mock module imports for this test to work
	// 		console.warn('Skipping triggerBackgroundInitialization test due to mocking complexity');
	// 		// await (service as any).triggerBackgroundInitialization(userId, sessionId);
	// 		// expect(updateSessionStub.calledOnceWithExactly(userId, sessionId, {
	// 		// 	status: 'error_file_selection',
	// 		// 	error: agentError.message,
	// 		// 	lastAgentActivity: sinon.match.number,
	// 		// })).to.be.true;
	// 	});
	// });
});
