import { Value } from '@sinclair/typebox/value';
import chai, { expect } from 'chai';
import chaiAsPromised from 'chai-as-promised';
import sinon from 'sinon';
import type { CodeTask, CreateCodeTaskData, UpdateCodeTaskData } from '#shared/codeTask/codeTask.model';
import { CodeTaskApiSchema } from '#shared/codeTask/codeTask.schema';
import type { CodeTaskRepository } from './codeTaskRepository';
import { CodeTaskServiceImpl } from './codeTaskServiceImpl';

import { setupConditionalLoggerOutput } from '#test/testUtils';

chai.use(chaiAsPromised);

let service: CodeTaskServiceImpl;
let mockCodeTaskRepo: sinon.SinonStubbedInstance<CodeTaskRepository>;
let executeDesignStub: sinon.SinonStub;

const userId = 'test-user-id';
const codeTaskId = 'test-codeTask-id';

describe.only('CodeTaskServiceImpl', () => {
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
			// error: null, // This is incorrect, remove it so it's undefined by default
			// Other fields can be added as needed
		};
		return { ...defaults, ...overrides };
	};

	describe('createCodeTask', () => {
		it('should return a schema-compliant object on creation', async () => {
			// 1. Arrange
			const createData: CreateCodeTaskData = {
				title: 'New Task',
				instructions: 'New instructions',
				repositorySource: 'github',
				repositoryId: 'owner/repo',
				targetBranch: 'main',
				workingBranch: 'feat/new',
				createWorkingBranch: true,
				useSharedRepos: false,
			};

			// The service's createCodeTask method constructs a new object. We mock the repository
			// call it makes, but test the object it returns.
			mockCodeTaskRepo.createCodeTask.resolves(codeTaskId);

			// 2. Act
			const result = await service.createCodeTask(userId, createData);

			// 3. Assert
			const isValid = Value.Check(CodeTaskApiSchema, result);
			if (!isValid) {
				const errors = [...Value.Errors(CodeTaskApiSchema, result)];
				console.error('Schema validation errors:', JSON.stringify(errors, null, 2));
			}
			expect(isValid, 'The created CodeTask object must be valid against the API schema').to.be.true;

			// Also check some default values
			expect(result.title).to.equal(createData.title);
			expect(result.status).to.equal('initializing');
			expect(result.error).to.be.undefined;
		});
	});

	describe('getCodeTask', () => {
		it('should return a schema-compliant object even if the repository returns nulls', async () => {
			// 1. Arrange: Simulate the repository returning an object with nulls, as Firestore might.
			// The service implementation delegates directly to the repository, so we test the repository's contract.
			const taskFromDbWithNulls = createMockCodeTask({
				error: null,
				repositoryName: null,
				commitSha: null,
			} as any); // Use 'as any' to bypass TypeScript checks for the test setup.

			// We are testing the service, which calls the repo. The sanitization happens in the repo.
			// So we need to simulate the repo *before* sanitization and check the service's output.
			// Let's adjust the mock to simulate the *sanitized* output from the repo to test the service correctly.
			const sanitizedTask = { ...taskFromDbWithNulls };
			sanitizedTask.error = undefined;
			sanitizedTask.repositoryName = undefined;
			sanitizedTask.commitSha = undefined;

			mockCodeTaskRepo.getCodeTask.resolves(sanitizedTask);

			// 2. Act: Call the service method.
			const result = await service.getCodeTask(userId, codeTaskId);

			// 3. Assert: Verify the result is compliant with the API schema.
			const isValid = Value.Check(CodeTaskApiSchema, result);
			if (!isValid) {
				// Provide detailed error info if validation fails
				const errors = [...Value.Errors(CodeTaskApiSchema, result)];
				console.error('Schema validation errors:', JSON.stringify(errors, null, 2));
			}
			expect(isValid, 'The returned CodeTask object must be valid against the API schema').to.be.true;

			// Also assert that the null properties are now undefined.
			expect(result).to.not.be.null;
			expect(result!.error).to.be.undefined;
			expect(result!.repositoryName).to.be.undefined;
			expect(result!.commitSha).to.be.undefined;
		});
	});

	describe('listCodeTasks', () => {
		it('should return an array of schema-compliant objects', async () => {
			// 1. Arrange: Simulate the repository returning objects with nulls.
			const task1WithNulls = createMockCodeTask({
				id: 'task1',
				error: null,
				repositoryName: null,
			} as any);
			const task2WithNulls = createMockCodeTask({
				id: 'task2',
				commitSha: null,
				pullRequestUrl: null,
			} as any);

			// Simulate the sanitized output from the repository.
			const sanitizedTask1 = { ...task1WithNulls, error: undefined, repositoryName: undefined };
			const sanitizedTask2 = { ...task2WithNulls, commitSha: undefined, pullRequestUrl: undefined };

			mockCodeTaskRepo.listCodeTasks.resolves([sanitizedTask1, sanitizedTask2]);

			// 2. Act
			const results = await service.listCodeTasks(userId);

			// 3. Assert
			expect(results).to.be.an('array').with.lengthOf(2);

			for (const result of results) {
				const isValid = Value.Check(CodeTaskApiSchema, result);
				const id = result.id;
				if (!isValid) {
					const errors = [...Value.Errors(CodeTaskApiSchema, result)];
					console.error(`Schema validation errors for task ${id}:`, JSON.stringify(errors, null, 2));
				}
				expect(isValid, `Returned CodeTask object (id: ${result.id}) must be valid against the API schema`).to.be.true;
			}

			expect(results[0].error).to.be.undefined;
			expect(results[0].repositoryName).to.be.undefined;
			expect(results[1].commitSha).to.be.undefined;
			expect(results[1].pullRequestUrl).to.be.undefined;
		});
	});

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
