import chai, { expect } from 'chai';
import chaiAsPromised from 'chai-as-promised';
import sinon from 'sinon';
import type { VibeRepository } from '#vibe/vibeRepository';
import { VibeServiceImpl } from '#vibe/vibeServiceImpl';
import type { CreateVibeSessionData, VibeSession } from '#vibe/vibeTypes';

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

	// --- Tests for existing methods can go here ---

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
						lastAgentActivity: sinon.match.number,
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
});
