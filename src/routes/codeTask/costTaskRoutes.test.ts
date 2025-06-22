import { expect } from 'chai';
import type { FastifyInstance } from 'fastify';
import sinon, { type SinonStub } from 'sinon';
import { initInMemoryApplicationContext } from '#app/applicationContext';
import { CodeTaskServiceImpl } from '#codeTask/codeTaskServiceImpl';
import { initFastify } from '#fastify/fastifyApp';
import type { CodeTask, CreateCodeTaskData } from '#shared/codeTask/codeTask.model';
import type { User } from '#shared/user/user.model';
import { setupConditionalLoggerOutput } from '#test/testUtils';
import * as userContext from '#user/userContext';
import { codeTaskRoutes } from './codeTaskRoutes';

describe.skip('CodeTask Routes - POST /api/codeTask', () => {
	setupConditionalLoggerOutput();
	let fastify: FastifyInstance;
	let createCodeTaskStub: SinonStub;
	let currentUserStub: SinonStub;

	const mockUser: User = {
		id: 'test-user-id',
		name: 'John Doe',
		email: 'test@example.com',
		// name: 'Test User', // name is not a property of User
		enabled: true,
		createdAt: new Date(),
		// updatedAt: new Date(), // updatedAt is not a property of User
		hilBudget: 0,
		hilCount: 0,
		chat: {
			// chat settings are part of User, but the exact structure might vary or be optional
			enabledLLMs: {},
			defaultLLM: 'default-llm',
		},
		functionConfig: {}, // functionConfig is part of User
		llmConfig: {}, // llmConfig is part of User
	};

	const mockSuccessfulCodeTask: Partial<CodeTask> = {
		id: 'mock-codeTask-id',
		userId: mockUser.id,
		title: 'Mock CodeTask',
		instructions: 'Mock Instructions',
		repositorySource: 'github',
		repositoryId: 'owner/repo', // This will be asserted based on test case
		targetBranch: 'main',
		workingBranch: 'feat/test',
		createWorkingBranch: true,
		useSharedRepos: false,
		status: 'initializing',
		createdAt: Date.now(),
		updatedAt: Date.now(),
		lastAgentActivity: Date.now(),
	};

	beforeEach(async () => {
		const context = initInMemoryApplicationContext();
		currentUserStub = sinon.stub(userContext, 'currentUser').returns(mockUser);

		fastify = await initFastify({
			routes: [codeTaskRoutes],
			// instanceDecorators: context.instanceDecorators, // instanceDecorators is not a property of context
			// requestDecorators: context.requestDecorators, // requestDecorators is not a property of context
			instanceDecorators: context, // Assuming context itself contains instance decorators
			requestDecorators: {}, // Assuming no specific request decorators for this test setup
		});

		createCodeTaskStub = sinon.stub(CodeTaskServiceImpl.prototype, 'createCodeTask');
		// Make the stub return a copy to avoid modification issues if the object is reused
		createCodeTaskStub.callsFake(async (userId: string, codeTaskData: CreateCodeTaskData) => {
			return {
				...mockSuccessfulCodeTask,
				userId,
				title: codeTaskData.title,
				instructions: codeTaskData.instructions,
				repositorySource: codeTaskData.repositorySource,
				repositoryId: codeTaskData.repositoryFullPath, // Key part for assertion - CodeTask.repositoryId is populated from CreateCodeTaskData.repositoryFullPath
				repositoryName: codeTaskData.repositoryName,
				targetBranch: codeTaskData.targetBranch,
				workingBranch: codeTaskData.workingBranch,
				createWorkingBranch: codeTaskData.createWorkingBranch,
				useSharedRepos: codeTaskData.useSharedRepos,
			} as CodeTask;
		});
	});

	afterEach(async () => {
		sinon.restore();
		if (fastify) {
			await fastify.close();
		}
	});

	const basePayload: Omit<CreateCodeTaskData, 'repositorySource' | 'repositoryFullPath' | 'repositoryName'> = {
		title: 'Test CodeTask',
		instructions: 'Do something cool',
		targetBranch: 'main',
		workingBranch: 'feature/test',
		createWorkingBranch: true,
		useSharedRepos: false,
	};

	it('should use repositoryId directly if provided', async () => {
		const payload: CreateCodeTaskData = {
			...basePayload,
			repositorySource: 'github',
			repositoryFullPath: 'owner/direct-id',
		};

		const response = await fastify.inject({
			method: 'POST',
			url: '/api/codeTask',
			payload,
		});

		expect(response.statusCode).to.equal(201);
		expect(createCodeTaskStub.calledOnce).to.be.true;
		const callArg = createCodeTaskStub.firstCall.args[1] as CreateCodeTaskData;
		expect(callArg.repositoryFullPath).to.equal('owner/direct-id');
	});

	it('should derive repositoryId from repositoryName for GitHub if repositoryFullPath is not provided', async () => {
		const payload: CreateCodeTaskData = {
			...basePayload,
			repositorySource: 'github',
			repositoryName: 'owner/github-name',
		};

		const response = await fastify.inject({
			method: 'POST',
			url: '/api/codeTask',
			payload,
		});

		expect(response.statusCode).to.equal(201);
		expect(createCodeTaskStub.calledOnce).to.be.true;
		const callArg = createCodeTaskStub.firstCall.args[1] as CreateCodeTaskData;
		expect(callArg.repositoryFullPath).to.equal('owner/github-name');
		// Also check that the response from the stub reflects this derived ID
		const responseBody = JSON.parse(response.payload);
		expect(responseBody.repositoryId).to.equal('owner/github-name'); // CodeTask.repositoryId is populated from CreateCodeTaskData.repositoryFullPath
	});

	it('should derive repositoryId from repositoryName for GitLab if repositoryFullPath is not provided', async () => {
		const payload: CreateCodeTaskData = {
			...basePayload,
			repositorySource: 'gitlab',
			repositoryName: 'group/gitlab-name',
		};

		const response = await fastify.inject({
			method: 'POST',
			url: '/api/codeTask',
			payload,
		});

		expect(response.statusCode).to.equal(201);
		expect(createCodeTaskStub.calledOnce).to.be.true;
		const callArg = createCodeTaskStub.firstCall.args[1] as CreateCodeTaskData;
		expect(callArg.repositoryFullPath).to.equal('group/gitlab-name');
		const responseBody = JSON.parse(response.payload);
		expect(responseBody.repositoryId).to.equal('group/gitlab-name'); // CodeTask.repositoryId is populated from CreateCodeTaskData.repositoryFullPath
	});

	it('should return 400 if repositoryFullPath is not provided and repositoryName is missing for GitHub', async () => {
		const payload: CreateCodeTaskData = {
			...basePayload,
			repositorySource: 'github',
		};

		const response = await fastify.inject({
			method: 'POST',
			url: '/api/codeTask',
			payload,
		});

		expect(response.statusCode).to.equal(400);
		const responseBody = JSON.parse(response.payload);
		expect(responseBody.error).to.contain('repositoryFullPath is required');
		expect(createCodeTaskStub.called).to.be.false;
	});

	it('should return 400 if repositoryFullPath is not provided for "local" source (no derivation)', async () => {
		const payload: CreateCodeTaskData = {
			...basePayload,
			repositorySource: 'local',
		};

		const response = await fastify.inject({
			method: 'POST',
			url: '/api/codeTask',
			payload,
		});

		expect(response.statusCode).to.equal(400);
		const responseBody = JSON.parse(response.payload);
		expect(responseBody.error).to.contain('repositoryFullPath is required');
		expect(createCodeTaskStub.called).to.be.false;
	});

	it('should derive repositoryId from repositoryName if repositoryFullPath is an empty string for GitHub', async () => {
		const payload: CreateCodeTaskData = {
			...basePayload,
			repositorySource: 'github',
			repositoryFullPath: '',
			repositoryName: 'owner/github-fallback',
		};

		const response = await fastify.inject({
			method: 'POST',
			url: '/api/codeTask',
			payload,
		});

		expect(response.statusCode).to.equal(201);
		expect(createCodeTaskStub.calledOnce).to.be.true;
		const callArg = createCodeTaskStub.firstCall.args[1] as CreateCodeTaskData;
		expect(callArg.repositoryFullPath).to.equal('owner/github-fallback');
		const responseBody = JSON.parse(response.payload);
		expect(responseBody.repositoryId).to.equal('owner/github-fallback'); // CodeTask.repositoryId is populated from CreateCodeTaskData.repositoryFullPath
	});

	it('should prioritize provided repositoryFullPath over repositoryName for GitHub', async () => {
		const payload: CreateCodeTaskData = {
			...basePayload,
			repositorySource: 'github',
			repositoryFullPath: 'owner/direct-id-priority',
			repositoryName: 'owner/github-name-ignored',
		};

		const response = await fastify.inject({
			method: 'POST',
			url: '/api/codeTask',
			payload,
		});

		expect(response.statusCode).to.equal(201);
		expect(createCodeTaskStub.calledOnce).to.be.true;
		const callArg = createCodeTaskStub.firstCall.args[1] as CreateCodeTaskData;
		expect(callArg.repositoryFullPath).to.equal('owner/direct-id-priority');
		const responseBody = JSON.parse(response.payload);
		expect(responseBody.repositoryId).to.equal('owner/direct-id-priority'); // CodeTask.repositoryId is populated from CreateCodeTaskData.repositoryFullPath
	});
});
