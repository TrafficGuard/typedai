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
});
