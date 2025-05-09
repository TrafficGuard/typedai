import type { FastifyInstance } from 'fastify';
import { expect } from 'chai';
import sinon, { type SinonStub } from 'sinon';

// TypedAI specific imports
import { vibeRoutes } from './vibeRoutes';
import { initFastify } from '../../fastify/fastifyApp';
import { initInMemoryApplicationContext } from '../../app/applicationContext';
import { VibeServiceImpl } from '../../vibe/vibeServiceImpl';
import type { CreateVibeSessionData, VibeSession } from '../../vibe/vibeTypes';
import * as userContext from '../../user/userService/userContext';
import { setupConditionalLoggerOutput } from '../../test/testUtils';
import type { User } from '#user/user'; // For currentUser mock

describe('Vibe Routes - POST /api/vibe', () => {
    setupConditionalLoggerOutput();
    let fastify: FastifyInstance;
    let createVibeSessionStub: SinonStub;
    let currentUserStub: SinonStub;

    const mockUser: User = {
        id: 'test-user-id',
        email: 'test@example.com',
        // name: 'Test User', // name is not a property of User
        enabled: true,
        createdAt: new Date(),
        // updatedAt: new Date(), // updatedAt is not a property of User
        hilBudget: 0,
        hilCount: 0,
        chat: { // chat settings are part of User, but the exact structure might vary or be optional
            enabledLLMs: {},
            defaultLLM: 'default-llm',
        },
        functionConfig: {}, // functionConfig is part of User
        llmConfig: {}, // llmConfig is part of User
    };


    const mockSuccessfulSession: Partial<VibeSession> = {
        id: 'mock-session-id',
        userId: mockUser.id,
        title: 'Mock Session',
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
            routes: [vibeRoutes],
            // instanceDecorators: context.instanceDecorators, // instanceDecorators is not a property of context
            // requestDecorators: context.requestDecorators, // requestDecorators is not a property of context
            instanceDecorators: context, // Assuming context itself contains instance decorators
            requestDecorators: {}, // Assuming no specific request decorators for this test setup
        });

        createVibeSessionStub = sinon.stub(VibeServiceImpl.prototype, 'createVibeSession');
        // Make the stub return a copy to avoid modification issues if the object is reused
        createVibeSessionStub.callsFake(async (userId: string, sessionData: CreateVibeSessionData) => {
            return {
                ...mockSuccessfulSession,
                userId,
                title: sessionData.title,
                instructions: sessionData.instructions,
                repositorySource: sessionData.repositorySource,
                repositoryId: sessionData.repositoryId, // Key part for assertion
                repositoryName: sessionData.repositoryName,
                targetBranch: sessionData.targetBranch,
                workingBranch: sessionData.workingBranch,
                createWorkingBranch: sessionData.createWorkingBranch,
                useSharedRepos: sessionData.useSharedRepos,
            } as VibeSession;
        });
    });

    afterEach(async () => {
        sinon.restore();
        if (fastify) {
            await fastify.close();
        }
    });

    const basePayload: Omit<CreateVibeSessionData, 'repositorySource' | 'repositoryId' | 'repositoryName'> = {
        title: 'Test Session',
        instructions: 'Do something cool',
        targetBranch: 'main',
        workingBranch: 'feature/test',
        createWorkingBranch: true,
        useSharedRepos: false,
    };

    it('should use repositoryId directly if provided', async () => {
        const payload: CreateVibeSessionData = {
            ...basePayload,
            repositorySource: 'github',
            repositoryId: 'owner/direct-id',
        };

        const response = await fastify.inject({
            method: 'POST',
            url: '/api/vibe',
            payload,
        });

        expect(response.statusCode).to.equal(201);
        expect(createVibeSessionStub.calledOnce).to.be.true;
        const callArg = createVibeSessionStub.firstCall.args[1] as CreateVibeSessionData;
        expect(callArg.repositoryId).to.equal('owner/direct-id');
    });

    it('should derive repositoryId from repositoryName for GitHub if repositoryId is not provided', async () => {
        const payload: CreateVibeSessionData = {
            ...basePayload,
            repositorySource: 'github',
            repositoryName: 'owner/github-name',
        };

        const response = await fastify.inject({
            method: 'POST',
            url: '/api/vibe',
            payload,
        });

        expect(response.statusCode).to.equal(201);
        expect(createVibeSessionStub.calledOnce).to.be.true;
        const callArg = createVibeSessionStub.firstCall.args[1] as CreateVibeSessionData;
        expect(callArg.repositoryId).to.equal('owner/github-name');
        // Also check that the response from the stub reflects this derived ID
        const responseBody = JSON.parse(response.payload);
        expect(responseBody.repositoryId).to.equal('owner/github-name');
    });

    it('should derive repositoryId from repositoryName for GitLab if repositoryId is not provided', async () => {
        const payload: CreateVibeSessionData = {
            ...basePayload,
            repositorySource: 'gitlab',
            repositoryName: 'group/gitlab-name',
        };

        const response = await fastify.inject({
            method: 'POST',
            url: '/api/vibe',
            payload,
        });

        expect(response.statusCode).to.equal(201);
        expect(createVibeSessionStub.calledOnce).to.be.true;
        const callArg = createVibeSessionStub.firstCall.args[1] as CreateVibeSessionData;
        expect(callArg.repositoryId).to.equal('group/gitlab-name');
        const responseBody = JSON.parse(response.payload);
        expect(responseBody.repositoryId).to.equal('group/gitlab-name');
    });

    it('should return 400 if repositoryId is not provided and repositoryName is missing for GitHub', async () => {
        const payload: CreateVibeSessionData = {
            ...basePayload,
            repositorySource: 'github',
        };

        const response = await fastify.inject({
            method: 'POST',
            url: '/api/vibe',
            payload,
        });

        expect(response.statusCode).to.equal(400);
        const responseBody = JSON.parse(response.payload);
        expect(responseBody.error).to.contain("repositoryId is required");
        expect(createVibeSessionStub.called).to.be.false;
    });

    it('should return 400 if repositoryId is not provided for "local" source (no derivation)', async () => {
        const payload: CreateVibeSessionData = {
            ...basePayload,
            repositorySource: 'local',
        };

        const response = await fastify.inject({
            method: 'POST',
            url: '/api/vibe',
            payload,
        });

        expect(response.statusCode).to.equal(400);
        const responseBody = JSON.parse(response.payload);
        expect(responseBody.error).to.contain("repositoryId is required");
        expect(createVibeSessionStub.called).to.be.false;
    });

    it('should derive repositoryId from repositoryName if repositoryId is an empty string for GitHub', async () => {
        const payload: CreateVibeSessionData = {
            ...basePayload,
            repositorySource: 'github',
            repositoryId: '',
            repositoryName: 'owner/github-fallback',
        };

        const response = await fastify.inject({
            method: 'POST',
            url: '/api/vibe',
            payload,
        });

        expect(response.statusCode).to.equal(201);
        expect(createVibeSessionStub.calledOnce).to.be.true;
        const callArg = createVibeSessionStub.firstCall.args[1] as CreateVibeSessionData;
        expect(callArg.repositoryId).to.equal('owner/github-fallback');
        const responseBody = JSON.parse(response.payload);
        expect(responseBody.repositoryId).to.equal('owner/github-fallback');
    });

    it('should prioritize provided repositoryId over repositoryName for GitHub', async () => {
        const payload: CreateVibeSessionData = {
            ...basePayload,
            repositorySource: 'github',
            repositoryId: 'owner/direct-id-priority',
            repositoryName: 'owner/github-name-ignored',
        };

        const response = await fastify.inject({
            method: 'POST',
            url: '/api/vibe',
            payload,
        });

        expect(response.statusCode).to.equal(201);
        expect(createVibeSessionStub.calledOnce).to.be.true;
        const callArg = createVibeSessionStub.firstCall.args[1] as CreateVibeSessionData;
        expect(callArg.repositoryId).to.equal('owner/direct-id-priority');
        const responseBody = JSON.parse(response.payload);
        expect(responseBody.repositoryId).to.equal('owner/direct-id-priority');
    });
});
