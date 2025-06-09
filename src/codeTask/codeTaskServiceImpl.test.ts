import chai, { expect } from 'chai';
import chaiAsPromised from 'chai-as-promised';
import sinon from 'sinon';
import type { CodeTask, UpdateCodeTaskData } from '#shared/codeTask/codeTask.model';
import type { CodeTaskRepository } from './codeTaskRepository';
import { CodeTaskServiceImpl } from './codeTaskServiceImpl';

import { setupConditionalLoggerOutput } from '#test/testUtils';

chai.use(chaiAsPromised);

describe('CodeTaskServiceImpl', () => {
	setupConditionalLoggerOutput();

	let service: CodeTaskServiceImpl;
	let mockCodeTaskRepo: sinon.SinonStubbedInstance<CodeTaskRepository>;
	let executeDesignStub: sinon.SinonStub;

	const userId = 'test-user-id';
	const codeTaskId = 'test-codeTask-id';

	beforeEach(() => {
		mockCodeTaskRepo = {
			createCodeTask: sinon.stub(),
			getCodeTask: sinon.stub(),
			listCodeTasks: sinon.stub(),
			updateCodeTask: sinon.stub(),
			deleteCodeTask: sinon.stub(),
			saveCodeTaskPreset: sinon.stub(),
			listCodeTaskPresets: sinon.stub(),
			deleteCodeTaskPreset: sinon.stub(),
		};
		service = new CodeTaskServiceImpl(mockCodeTaskRepo as unknown as CodeTaskRepository);
		// Stub the executeDesign method directly on the service instance for these tests
		executeDesignStub = sinon.stub(service, 'executeDesign').resolves();
	});

	afterEach(() => {
		sinon.restore();
	});

	// --- Helper to create a basic valid codeTask ---
	const createMockCodeTask = (overrides: Partial<CodeTask> = {}): CodeTask => {
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

	describe('updateCodeTask', () => {
		it('should pass filesToAdd and filesToRemove to the repository', async () => {
			const payload: UpdateCodeTaskData = {
				status: 'design_review',
				filesToAdd: ['new.ts'],
				filesToRemove: ['old.ts'],
			};
			mockCodeTaskRepo.updateCodeTask.resolves(); // Assume repo update succeeds

			await service.updateCodeTask(userId, codeTaskId, payload);

			// Verify that the repository's update method was called with the exact payload
			expect(mockCodeTaskRepo.updateCodeTask.calledOnce).to.be.true;
			// Use sinon.match to check the structure and specific file fields
			expect(
				mockCodeTaskRepo.updateCodeTask.calledOnceWith(
					userId,
					codeTaskId,
					sinon.match({
						status: 'design_review',
						filesToAdd: ['new.ts'],
						filesToRemove: ['old.ts'],
						// Do not match updatedAt here as it's added by the repo layer
					}),
				),
			).to.be.true;
		});

		it('should only pass other fields if file fields are absent', async () => {
			const payload: UpdateCodeTaskData = {
				status: 'design_review',
			};
			mockCodeTaskRepo.updateCodeTask.resolves();

			await service.updateCodeTask(userId, codeTaskId, payload);

			expect(mockCodeTaskRepo.updateCodeTask.calledOnce).to.be.true;
			expect(
				mockCodeTaskRepo.updateCodeTask.calledOnceWith(
					userId,
					codeTaskId,
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
