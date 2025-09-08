import { randomUUID } from 'node:crypto';
import chai, { expect } from 'chai';
import chaiAsPromised from 'chai-as-promised';
chai.use(chaiAsPromised);
import sinon from 'sinon';
import { LlmFunctionsImpl } from '#agent/LlmFunctionsImpl';
import type { AgentContextService } from '#agent/agentContextService/agentContextService';
import { Agent } from '#agent/autonomous/functions/agentFunctions';
import { clearCompletedHandlers, registerCompletedHandler } from '#agent/completionHandlerRegistry';
import { appContext } from '#app/applicationContext';
import * as functionSchema from '#functionSchema/functionDecorators';
import { FileSystemRead } from '#functions/storage/fileSystemRead';
import { MockLLM } from '#llm/services/mock-llm';
import { logger } from '#o11y/logger';
import {
	AGENT_PREVIEW_KEYS,
	type AgentCompleted,
	type AgentContext,
	type AgentLLMs,
	type AgentRunningState,
	AgentType,
	isExecuting,
	// TaskLevel, // Not explicitly used in AgentContext, but used in AgentLLMs
} from '#shared/agent/agent.model';
import type { AutonomousIteration } from '#shared/agent/agent.model';
import { NotAllowed, NotFound } from '#shared/errors'; // Added import
import type { FunctionCallResult, GenerationStats } from '#shared/llm/llm.model';
import type { ChatSettings, LLMServicesConfig, User } from '#shared/user/user.model';
import { setCurrentUser } from '#user/userContext';

// These tests must be implementation independent so we can ensure the same
// behaviour from various implementations of the AgentStateService interface

// --- Mock Data and Helpers ---

// Default Configs for User
const defaultLlmConfig: LLMServicesConfig = {
	openaiKey: undefined,
	anthropicKey: undefined,
	// ... other keys potentially undefined
};

const defaultChatSettings: ChatSettings = {
	enabledLLMs: { 'mock-llm-model': true },
	defaultLLM: 'mock-llm-model',
	temperature: 0.7,
};

const defaultFunctionConfig: Record<string, Record<string, any>> = {
	FileSystem: { basePath: '/tmp/test' },
};

function agentId(): string {
	return randomUUID();
}

export const testUser: User = {
	id: 'test-user-123',
	name: 'John Doe',
	email: 'test@example.com',
	enabled: true,
	createdAt: new Date(Date.now() - 86400000), // Yesterday
	lastLoginAt: new Date(),
	hilBudget: 1.5,
	hilCount: 10,
	llmConfig: defaultLlmConfig,
	chat: defaultChatSettings,
	functionConfig: defaultFunctionConfig,
};

export const otherUser: User = {
	id: 'other-user-456',
	name: 'John Doe',
	email: 'other@example.com',
	enabled: true,
	createdAt: new Date(Date.now() - 172800000), // Day before yesterday
	lastLoginAt: new Date(Date.now() - 3600000), // Hour ago
	hilBudget: 0.5,
	hilCount: 5,
	llmConfig: {}, // Empty config
	chat: {}, // Empty settings
	functionConfig: {},
};

// Dummy LLM class/object for AgentLLMs typing
// const mockLlm: LLM = {
// 	modelId: 'mock-llm-model',
// 	call: async () => ({ responseText: 'mock response', cost: 0.001 }),
// 	// Add other required LLM methods/properties if necessary
// }; // Cast to bypass strict checks if only modelId/call needed

const mockLlm = new MockLLM();
mockLlm.addResponse('mock response');

const defaultLlms: AgentLLMs = {
	easy: mockLlm,
	medium: mockLlm,
	hard: mockLlm,
	xhard: mockLlm,
};

// Keep track of created agent IDs (optional)
let createdAgentIds: string[] = [];

// Mock AgentCompleted handler
class MockAgentCompleted implements AgentCompleted {
	handlerId = 'mock-completed-handler';
	async notifyCompleted(agentContext: AgentContext): Promise<void> {
		logger.info(`MockAgentCompleted notified for agent ${agentContext.agentId}`);
	}
	agentCompletedHandlerId(): string {
		return this.handlerId;
	}
}

// Example function class for testing updateFunctions
class MockFunction {
	static functionName = 'mock_function';
	static description = 'A mock function';
	static parameters = { type: 'object', properties: {}, required: [] };
	async execute(args: any): Promise<any> {
		return { result: 'mock result', args };
	}
}
const mockFunctionInstance = new MockFunction();

const createMockAgentContext = (id: string, overrides: Partial<AgentContext> = {}, userObj: User = testUser): AgentContext => {
	const now = Date.now();
	// Ensure the user object passed in is used, default to testUser
	const currentUser = { ...userObj };

	const baseContext: AgentContext = {
		agentId: id,
		executionId: `exec-${id}-${now}`,
		typedAiRepoDir: '/test/repo/dir',
		traceId: `trace-${id}-${now}`,
		name: `Test Agent ${id}`,
		parentAgentId: undefined,
		user: currentUser,
		state: 'agent',
		callStack: ['initial_call'],
		error: undefined,
		// Use HIL settings from the User object by default
		hilBudget: currentUser.hilBudget,
		hilCount: currentUser.hilCount,
		cost: 0,
		budgetRemaining: currentUser.hilBudget,
		llms: defaultLlms,
		fileSystem: null,
		useSharedRepos: true,
		memory: { defaultMemory: 'some data' },
		lastUpdate: now - 5000,
		createdAt: now,
		metadata: { source: 'unit-test' },
		functions: new LlmFunctionsImpl(),
		completedHandler: undefined,
		pendingMessages: [],
		type: 'autonomous',
		subtype: 'codegen',
		iterations: 0,
		invoking: [],
		notes: [],
		userPrompt: 'Default user prompt',
		inputPrompt: 'Default input prompt string',
		messages: [{ role: 'user', content: 'Default initial message' }],
		functionCallHistory: [],
		childAgents: [],
	};

	// Merge overrides carefully
	const context: AgentContext = {
		...baseContext,
		...overrides,
		// Ensure nested objects/arrays are handled correctly if overridden
		user: overrides.user ?? baseContext.user,
		llms: overrides.llms ?? baseContext.llms,
		memory: overrides.memory ?? baseContext.memory,
		metadata: overrides.metadata ?? baseContext.metadata,
		functions: overrides.functions instanceof LlmFunctionsImpl ? overrides.functions : baseContext.functions,
		callStack: overrides.callStack ?? baseContext.callStack,
		pendingMessages: overrides.pendingMessages ?? baseContext.pendingMessages,
		invoking: overrides.invoking ?? baseContext.invoking,
		notes: overrides.notes ?? baseContext.notes,
		messages: overrides.messages ?? baseContext.messages,
		functionCallHistory: overrides.functionCallHistory ?? baseContext.functionCallHistory,
		childAgents: overrides.childAgents ?? baseContext.childAgents,
		// Ensure hilBudget/hilCount/budgetRemaining are consistent if user is overridden
		hilBudget: overrides.user?.hilBudget ?? currentUser.hilBudget,
		hilCount: overrides.user?.hilCount ?? currentUser.hilCount,
		// If budgetRemaining is explicitly overridden, use that, otherwise derive from hilBudget
		budgetRemaining: overrides.budgetRemaining ?? overrides.user?.hilBudget ?? currentUser.hilBudget,
	};

	createdAgentIds.push(id);
	return context;
};

// --- Generic Test Suite ---

export function runAgentStateServiceTests(
	createService: () => AgentContextService,
	beforeEachHook: () => Promise<void> | void = () => {},
	afterEachHook: () => Promise<void> | void = () => {},
): void {
	let service: AgentContextService;

	// Mock the function factory to return known classes
	const mockFunctionFactoryContent = {
		[MockFunction.name]: MockFunction,
		[Agent.name]: Agent, // Include default Agent functions if needed by LlmFunctions
		[FileSystemRead.name]: FileSystemRead, // Include default FS functions if needed
		// Add other functions used by default in LlmFunctions if necessary
	};

	beforeEach(async () => {
		createdAgentIds = [];
		await beforeEachHook();
		service = createService();

		// Stub external dependencies
		setCurrentUser(testUser);
		// Ensure functionFactory returns the classes needed by LlmFunctions.fromJSON and tests
		functionSchema.resetFunctionFactory();
		functionSchema.registerFunctionClasses(...Object.values(mockFunctionFactoryContent));

		// Register mock handlers needed for tests
		clearCompletedHandlers(); // Clear any handlers from previous tests
		registerCompletedHandler(new MockAgentCompleted()); // Register the mock handler instance

		// Ensure test users exist in the UserService instance used by the service
		const userServiceInstance = appContext().userService;
		try {
			await userServiceInstance.getUser(testUser.id);
		} catch (e) {
			await userServiceInstance.createUser(testUser);
		}
		try {
			await userServiceInstance.getUser(otherUser.id);
		} catch (e) {
			await userServiceInstance.createUser(otherUser);
		}
	});

	afterEach(async () => {
		sinon.restore();
		clearCompletedHandlers(); // Clean up registered handlers
		setCurrentUser(null); // clear override
		await afterEachHook();
	});

	describe('save and load', () => {
		it('should save a new agent context and load it back', async () => {
			const id = agentId();
			const mockCompletedHandler = new MockAgentCompleted();
			const funcHistory: FunctionCallResult[] = [
				{
					function_name: 'foo',
					parameters: { name: 'func1', arguments: '{"a": 1}' },
					stdout: 'result1',
					stderr: 'err',
					stdoutSummary: 'summ',
					stderrSummary: 'err',
				},
			];
			const contextFunctions = new LlmFunctionsImpl(); // Create LlmFunctions instance
			contextFunctions.addFunctionInstance(mockFunctionInstance, MockFunction.name); // Add our test function

			const context = createMockAgentContext(id, {
				user: testUser,
				cost: 0.25,
				budgetRemaining: testUser.hilBudget - 0.25,
				state: 'functions',
				memory: { dataKey: 'important data' },
				metadata: { project: 'X', runId: 123 },
				completedHandler: mockCompletedHandler,
				functions: contextFunctions,
				functionCallHistory: funcHistory,
				iterations: 3,
				notes: ['Processing complete', 'Check output'],
				callStack: ['start', 'process', 'invoke_func1'],
				messages: [
					{ role: 'user', content: 'Start processing' },
					{ role: 'assistant', content: 'Okay, calling func1' },
				],
				toolState: {
					LiveFiles: ['file1.txt'],
					FileSystemTree: [],
				},
			});

			await service.save(context);
			const loadedContext = await service.load(id); // load now throws on not found/not allowed

			expect(loadedContext).to.not.be.null; // This check is technically redundant now, but harmless
			if (!loadedContext) throw new Error('Loaded context is null');

			// --- Targeted Assertions for State Verification ---

			// Assert core identifiers and state
			expect(loadedContext.agentId).to.equal(context.agentId);
			expect(loadedContext.name).to.equal(context.name);
			expect(loadedContext.state).to.equal(context.state);
			expect(loadedContext.cost).to.equal(context.cost);
			expect(loadedContext.budgetRemaining).to.equal(context.budgetRemaining);

			// Assert user association (checking ID is sufficient after serialization)
			expect(loadedContext.user.id).to.equal(context.user.id);

			// Assert complex object serialization/deserialization
			expect(loadedContext.memory).to.deep.equal(context.memory);
			expect(loadedContext.metadata).to.deep.equal(context.metadata);
			expect(loadedContext.functionCallHistory).to.deep.equal(context.functionCallHistory);

			// Verify LlmFunctions deserialization
			expect(loadedContext.functions).to.be.instanceOf(LlmFunctionsImpl);
			expect(loadedContext.functions.getFunctionClassNames()).to.include(MockFunction.name); // Check the specific function added

			// Verify LLM deserialization (checking one is representative)
			expect(loadedContext.llms.easy.getId()).to.equal(context.llms.easy.getId());

			// Verify completedHandler state after load by checking its ID
			// The instance itself might be different, but it should be rehydrated correctly
			// based on the stored ID.
			expect(loadedContext.completedHandler).to.exist; // Check it's not null/undefined
			expect(loadedContext.completedHandler!.agentCompletedHandlerId()).to.equal(mockCompletedHandler.agentCompletedHandlerId());

			// Assert lastUpdate exists
			expect(loadedContext.lastUpdate).to.be.a('number');
		});

		it('should overwrite an existing agent context on save', async () => {
			const id = agentId();
			const context1 = createMockAgentContext(id, { name: 'V1', state: 'agent', iterations: 1 });
			await service.save(context1);
			const savedTime1 = (await service.load(id))!.lastUpdate;

			await new Promise((resolve) => setTimeout(resolve, 10)); // Ensure time passes

			const context2 = createMockAgentContext(id, { name: 'V2', state: 'completed', iterations: 2 });
			await service.save(context2);

			const loadedContext = await service.load(id);
			// Assert only the changed fields and lastUpdate
			expect(loadedContext!.name).to.equal('V2');
			expect(loadedContext!.state).to.equal('completed');
			expect(loadedContext!.iterations).to.equal(2);
			expect(loadedContext!.lastUpdate).to.be.greaterThan(savedTime1);
		});

		it('should return null when loading a non-existent agent', async () => {
			const id = agentId();
			expect(await service.load(id)).to.be.null;
		});

		it('should throw NotAllowed when trying to load an agent belonging to another user', async () => {
			const idForOtherUser = agentId();
			setCurrentUser(otherUser);
			const contextForOtherUser = createMockAgentContext(idForOtherUser, {}, otherUser);
			await service.save(contextForOtherUser);
			setCurrentUser(testUser); // Switch back to testUser

			await expect(service.load(idForOtherUser)).to.be.rejectedWith(NotAllowed);
		});

		it('should save and load parent/child relationships', async () => {
			const parentId = agentId();
			const childId = agentId();

			// Save parent first
			const parentContext = createMockAgentContext(parentId);
			await service.save(parentContext);

			// Save child second, referencing parent
			const childContext = createMockAgentContext(childId, { parentAgentId: parentId });
			// Assuming the save implementation handles adding the child to the parent's list
			await service.save(childContext);

			// Load and verify parent's childAgents list
			const loadedParent = await service.load(parentId);
			expect(loadedParent).to.not.be.null;
			expect(loadedParent!.childAgents).to.deep.equal([childId]);

			// Load and verify child's parentAgentId
			const loadedChild = await service.load(childId);
			expect(loadedChild).to.not.be.null;
			expect(loadedChild!.parentAgentId).to.equal(parentId);
		});

		it('should reject saving a child when parent does not exist', async () => {
			const parentId = agentId(); // Non-existent parent
			const childId = agentId();
			const childContext = createMockAgentContext(childId, { parentAgentId: parentId });

			// Expect the save operation to be rejected
			await expect(service.save(childContext)).to.be.rejected;
			// Verify the child was not saved due to the rejection
			expect(await service.load(childId)).to.be.null;
		});
	});

	describe('updateState', () => {
		it('should update only the state property of an agent', async () => {
			const id = agentId();
			const originalName = 'UpdateState Test Agent';
			const context = createMockAgentContext(id, { name: originalName, state: 'agent' });
			await service.save(context);

			const newState: AgentRunningState = 'hitl_feedback';
			await service.updateState(context, newState);

			// Verify the state was updated in the in-memory context object
			expect(context.state).to.equal(newState);

			// Load the context from the service to verify persistence
			const loadedContext = await service.load(id); // load now throws on not found/not allowed
			expect(loadedContext).to.not.be.null; // Redundant check
			// Assert the persisted state matches the new state
			expect(loadedContext!.state).to.equal(newState);
			// Assert one other property to ensure only state was updated
			expect(loadedContext!.name).to.equal(originalName);
		});
	});

	describe('list', () => {
		let agentId1: string;
		let agentId2: string;
		let otherUserAgentId: string;

		beforeEach(async () => {
			setCurrentUser(testUser);
			agentId1 = agentId();
			agentId2 = agentId();
			otherUserAgentId = agentId();

			await service.save(createMockAgentContext(agentId(), { name: 'Oldest', lastUpdate: Date.now() - 3000 }, testUser));
			await service.save(createMockAgentContext(agentId1, { name: 'Middle', lastUpdate: Date.now() - 2000 }, testUser));
			await service.save(createMockAgentContext(agentId2, { name: 'Newest', lastUpdate: Date.now() - 1000 }, testUser));

			// Save one for other user
			setCurrentUser(otherUser);
			await service.save(createMockAgentContext(otherUserAgentId, { name: 'Other User Agent', lastUpdate: Date.now() - 1500 }, otherUser));
			setCurrentUser(testUser); // Switch back
		});

		it('should list agent contexts for the current user, ordered by lastUpdate descending', async () => {
			setCurrentUser(testUser); // Ensure correct user context
			const contexts = await service.list();

			// Assert the correct number of agents for the current user
			expect(contexts).to.be.an('array').with.lengthOf(3);
			// Assert the order based on lastUpdate (using name as a proxy)
			expect(contexts.map((c) => c.name)).to.deep.equal(['Newest', 'Middle', 'Oldest']);

			// Assert that essential fields are present in each listed context
			// Note: The exact fields returned by list() might vary slightly by implementation,
			// but these are generally expected for a summary view.
			contexts.forEach((ctx) => {
				expect(ctx).to.include.keys(AGENT_PREVIEW_KEYS);
			});
		});

		it('should return an empty array if no agents exist for the current user', async () => {
			// Switch to a user guaranteed to have no agents saved in beforeEach
			setCurrentUser({ ...otherUser, id: 'no-agents-user-404' });
			const contexts = await service.list();
			expect(contexts).to.be.an('array').that.is.empty;
		});
	});

	describe('listRunning', () => {
		beforeEach(async () => {
			setCurrentUser(testUser); // Consistent user for saving

			// Running states based on isExecuting definition + non-terminal states
			await service.save(createMockAgentContext(agentId(), { state: 'workflow', lastUpdate: Date.now() - 1000 }));
			await service.save(createMockAgentContext(agentId(), { state: 'agent', lastUpdate: Date.now() - 3000 }));
			await service.save(createMockAgentContext(agentId(), { state: 'functions', lastUpdate: Date.now() - 500 }));
			await service.save(createMockAgentContext(agentId(), { state: 'hitl_tool', lastUpdate: Date.now() - 1500 }));
			// Non-executing but also non-terminal states often included in "running" lists
			await service.save(createMockAgentContext(agentId(), { state: 'hitl_feedback', lastUpdate: Date.now() - 2000 }));
			await service.save(createMockAgentContext(agentId(), { state: 'hitl_threshold', lastUpdate: Date.now() - 2500 }));
			await service.save(createMockAgentContext(agentId(), { state: 'child_agents', lastUpdate: Date.now() - 3500 }));
			await service.save(createMockAgentContext(agentId(), { state: 'error', lastUpdate: Date.now() - 4000 })); // Error state

			// Terminal states (should NOT be listed)
			await service.save(createMockAgentContext(agentId(), { state: 'completed', lastUpdate: Date.now() - 600 }));
			await service.save(createMockAgentContext(agentId(), { state: 'shutdown', lastUpdate: Date.now() - 700 }));
			await service.save(createMockAgentContext(agentId(), { state: 'timeout', lastUpdate: Date.now() - 800 }));
		});

		it('should list all non-terminal agent contexts, ordered by state ascending then lastUpdate descending', async () => {
			const contexts = await service.listRunning();

			// Expected running/active states based on beforeEach data and the Firestore/Postgres query:
			// Query sorts by state ASC, then lastUpdate DESC.
			// 'error' state is excluded by the service implementations.
			// States saved (excluding 'error' and other terminals):
			// agent (-3000), child_agents (-3500), functions (-500), hitl_feedback (-2000),
			// hitl_threshold (-2500), hitl_tool (-1500), workflow (-1000)
			// Sorted alphabetically by state:
			// agent, child_agents, functions, hitl_feedback, hitl_threshold, hitl_tool, workflow
			const expectedRunningStates: AgentRunningState[] = [
				'agent', // lastUpdate: -3000
				'child_agents', // lastUpdate: -3500
				'functions', // lastUpdate: -500
				'hitl_feedback', // lastUpdate: -2000
				'hitl_threshold', // lastUpdate: -2500
				'hitl_tool', // lastUpdate: -1500
				'workflow', // lastUpdate: -1000
			];

			// Assert the correct number of non-terminal agents found
			expect(contexts).to.be.an('array').with.lengthOf(expectedRunningStates.length); // Should be 7
			// Assert the order based on the compound sort (state ASC, lastUpdate DESC)
			expect(contexts.map((c) => c.state)).to.deep.equal(expectedRunningStates);

			// Verify that no terminal states (including 'error' as per service impl) are included
			contexts.forEach((ctx) => {
				expect(ctx.state).to.not.be.oneOf(['completed', 'shutdown', 'timeout', 'error']);
				expect(ctx).to.include.keys(['agentId', 'state', 'lastUpdate']);
			});
		});

		it('should return an empty array if no running agents exist', async () => {
			await beforeEachHook(); // Clear previous state via the hook
			service = createService(); // Recreate service after clearing
			// Save only agents with terminal states
			await service.save(createMockAgentContext(agentId(), { state: 'completed' }));
			await service.save(createMockAgentContext(agentId(), { state: 'shutdown' }));
			await service.save(createMockAgentContext(agentId(), { state: 'timeout' }));
			await service.save(createMockAgentContext(agentId(), { state: 'error' })); // Also save an error state one

			const contexts = await service.listRunning();
			expect(contexts).to.be.an('array').that.is.empty;
		});
	});

	describe('delete', () => {
		let agentIdCompleted: string;
		let agentIdError: string;
		let otherUserAgentId: string;
		let parentIdCompleted: string;
		let childId1: string;
		let childId2: string;
		let executingAgentId: string;

		beforeEach(async () => {
			// Ensure users exist in the UserService for the test run
			// 1. Clear previous state (if applicable via hook)
			createdAgentIds = [];
			await beforeEachHook(); // Assuming this clears Firestore/InMemory state
			service = createService(); // Recreate the service under test

			// 2. Stub dependencies: Stubs (currentUserStub, functionFactoryStub, loggerWarnStub)
			//    are created in the main beforeEach hook for runAgentStateServiceTests and should not be re-stubbed here
			//    to avoid Sinon errors about already wrapped functions. sinon.restore() in the main afterEach handles cleanup.

			// 3. Ensure users exist in the *correct* UserService instance for the test data.
			//    Get the instance that will be used by the service/deserialization via appContext.
			const userServiceInstance = appContext().userService;
			try {
				// Check if testUser exists, create if not
				await userServiceInstance.getUser(testUser.id);
			} catch (e) {
				await userServiceInstance.createUser(testUser);
			}
			try {
				// Check if otherUser exists, create if not
				await userServiceInstance.getUser(otherUser.id);
			} catch (e) {
				await userServiceInstance.createUser(otherUser);
			}

			// 4. Set the current user for subsequent save operations
			setCurrentUser(testUser);

			// Generate IDs
			agentIdCompleted = agentId();
			agentIdError = agentId();
			otherUserAgentId = agentId();
			parentIdCompleted = agentId();
			childId1 = agentId();
			childId2 = agentId();
			executingAgentId = agentId(); // State: 'agent' (isExecuting = true)

			// Deletable states for current user
			await service.save(createMockAgentContext(agentIdCompleted, { state: 'completed' }, testUser));
			await service.save(createMockAgentContext(agentIdError, { state: 'error' }, testUser));
			// Non-deletable state for current user
			await service.save(createMockAgentContext(executingAgentId, { state: 'agent' }, testUser));

			// Other user's agent - No need to stub currentUser if save uses the user from context
			await service.save(createMockAgentContext(otherUserAgentId, { state: 'completed' }, otherUser));

			// Parent with children (completed) for testUser
			await service.save(createMockAgentContext(parentIdCompleted, { childAgents: [childId1, childId2], state: 'completed' }, testUser));
			await service.save(createMockAgentContext(childId1, { parentAgentId: parentIdCompleted, state: 'completed' }, testUser));
			await service.save(createMockAgentContext(childId2, { parentAgentId: parentIdCompleted, state: 'completed' }, testUser));

			// 7. Ensure stub is correctly set for the actual test execution if needed
			//    (It's already set to testUser above, which is usually correct for delete tests)
			// currentUserStub.returns(testUser); // Already done in step 4
		});

		it('should delete specified agents belonging to the current user in non-executing states', async () => {
			setCurrentUser(testUser); // Ensure correct user context
			await service.delete([agentIdCompleted, agentIdError]);

			// Verify the specified agents are deleted
			expect(await service.load(agentIdCompleted)).to.be.null;
			expect(await service.load(agentIdError)).to.be.null;
		});

		it('should NOT delete agents belonging to other users', async () => {
			setCurrentUser(testUser); // Ensure correct user context
			await service.delete([agentIdCompleted, otherUserAgentId]);

			// Verify testUser's agent is deleted
			expect(await service.load(agentIdCompleted)).to.be.null;
			// Verify otherUser's agent is NOT deleted (load should now throw NotAllowed)
			await expect(service.load(otherUserAgentId)).to.be.rejectedWith(NotAllowed);
		});

		it('should NOT delete executing agents', async () => {
			setCurrentUser(testUser); // Ensure correct user context
			await service.delete([agentIdCompleted, executingAgentId]);

			// Verify the non-executing agent is deleted
			expect(await service.load(agentIdCompleted)).to.be.null;
			// Verify the executing agent is NOT deleted (load should NOT throw NotFound, but should return the agent)
			// Note: The delete logic filters out executing agents *before* attempting deletion.
			// So, loading the executing agent after the delete call should still succeed.
			const executingAgentAfterDelete = await service.load(executingAgentId);
			expect(executingAgentAfterDelete).to.not.be.null;
			expect(executingAgentAfterDelete!.agentId).to.equal(executingAgentId);
		});

		it('should delete a parent agent and its children when parent ID is provided (if parent is deletable)', async () => {
			setCurrentUser(testUser); // Ensure correct user context
			// Delete the parent (which is in 'completed' state)
			await service.delete([parentIdCompleted]);

			// Verify parent and all children are deleted
			expect(await service.load(parentIdCompleted)).to.be.null;
			expect(await service.load(childId1)).to.be.null;
			expect(await service.load(childId2)).to.be.null;
		});

		it('should NOT delete child agents if only child ID is provided (due to implementation filter)', async () => {
			setCurrentUser(testUser); // Ensure correct user context
			// Attempt to delete only a child agent
			await service.delete([childId1]);

			// Verify parent remains (load should succeed)
			const parentAfterDelete = await service.load(parentIdCompleted);
			expect(parentAfterDelete).to.not.be.null;
			expect(parentAfterDelete!.agentId).to.equal(parentIdCompleted);

			// Verify the targeted child *remains* because the implementation filters for !parentAgentId (load should succeed)
			const child1AfterDelete = await service.load(childId1);
			expect(child1AfterDelete).to.not.be.null;
			expect(child1AfterDelete!.agentId).to.equal(childId1);

			// Verify the other child remains (load should succeed)
			const child2AfterDelete = await service.load(childId2);
			expect(child2AfterDelete).to.not.be.null;
			expect(child2AfterDelete!.agentId).to.equal(childId2);
		});

		it('should handle non-existent IDs gracefully without error', async () => {
			const nonExistentId = agentId();
			setCurrentUser(testUser);

			// Attempt to delete an existing deletable agent and a non-existent one
			await expect(service.delete([agentIdCompleted, nonExistentId])).to.not.be.rejected;

			// Verify the existing deletable agent was actually deleted
			expect(await service.load(agentIdCompleted)).to.be.null;
			// Verify the non-existent ID still results in NotFound on load
			expect(await service.load(nonExistentId)).to.be.null;
		});
	});

	describe('updateFunctions', () => {
		let agentId1: string;
		let agentIdForOtherUser: string;

		beforeEach(async () => {
			agentId1 = agentId();
			agentIdForOtherUser = agentId();
			// Start with default functions (like Agent) + potentially FileSystemRead based on LlmFunctions constructor/fromJSON behavior
			setCurrentUser(testUser);
			await service.save(createMockAgentContext(agentId1, { functions: new LlmFunctionsImpl() }, testUser));

			// Save an agent for another user
			setCurrentUser(otherUser);
			await service.save(createMockAgentContext(agentIdForOtherUser, { functions: new LlmFunctionsImpl() }, otherUser));
			setCurrentUser(testUser); // Switch back
		});

		// No need for a specific afterEach here, as the main afterEach's sinon.restore() will handle it.

		it('should update the functions for an existing agent', async () => {
			const functionNames = [MockFunction.name]; // Use class name
			await service.updateFunctions(agentId1, functionNames);

			const loadedContextAfterUpdate = await service.load(agentId1); // load now throws on not found/not allowed
			expect(loadedContextAfterUpdate).to.not.be.null; // Redundant check
			expect(loadedContextAfterUpdate!.functions).to.be.instanceOf(LlmFunctionsImpl);

			const updatedFunctionNames = loadedContextAfterUpdate!.functions.getFunctionClassNames();
			// Verify the specified function was added
			expect(updatedFunctionNames).to.include(MockFunction.name);
			// Verify default 'Agent' function remains because updateFunctions creates a new LlmFunctions()
			expect(updatedFunctionNames).to.include(Agent.name);
			// Check the total number of functions expected (Agent + MockFunction)
			expect(updatedFunctionNames).to.have.lengthOf(2);
			// expect(updatedFunctionNames).to.not.include(FileSystemRead.name); // Depends on LlmFunctionsImpl defaults
		});

		it('should replace existing functions with the new list (empty list results in defaults)', async () => {
			// Add a function first to ensure replacement works
			await service.updateFunctions(agentId1, [MockFunction.name]);
			let context = await service.load(agentId1); // load now throws on not found/not allowed
			expect(context!.functions.getFunctionClassNames()).to.include(MockFunction.name);

			// Now update with an empty list
			await service.updateFunctions(agentId1, []);
			context = await service.load(agentId1); // load now throws on not found/not allowed
			expect(context!.functions).to.be.instanceOf(LlmFunctionsImpl);

			// Get the expected default function names added by LlmFunctions constructor
			const defaultFuncs = new LlmFunctionsImpl();
			// Assert that the agent's functions now only contain the defaults
			expect(context!.functions.getFunctionClassNames().sort()).to.deep.equal(defaultFuncs.getFunctionClassNames().sort());
		});

		// Modified test to expect NotFound error
		it('should throw NotFound if the agent does not exist', async () => {
			const nonExistentId = agentId();
			await expect(service.updateFunctions(nonExistentId, [MockFunction.name])).to.be.rejectedWith(NotFound);
		});

		// Added test for NotAllowed error
		it('should throw NotAllowed if trying to update functions for an agent not owned by current user', async () => {
			// agentIdForOtherUser was saved for otherUser in beforeEach
			setCurrentUser(testUser); // Ensure current user is testUser

			await expect(service.updateFunctions(agentIdForOtherUser, [MockFunction.name])).to.be.rejectedWith(NotAllowed);
		});

		it('should warn and skip if a function name is not found in the factory', async () => {
			const unknownFunctionName = 'UnknownFunctionClassForTest';
			// Ensure the unknown function is NOT in our mocked factory for the test
			expect(mockFunctionFactoryContent[unknownFunctionName]).to.be.undefined;

			// Attempt to update with a known and an unknown function
			await service.updateFunctions(agentId1, [MockFunction.name, unknownFunctionName]);

			// Load the agent state after the update attempt
			const updatedContext = await service.load(agentId1); // load now throws on not found/not allowed
			expect(updatedContext).to.not.be.null; // Redundant check

			// Assert the known function *was* added successfully
			expect(updatedContext!.functions.getFunctionClassNames()).to.include(MockFunction.name);
			// Assert the unknown function *was not* added
			expect(updatedContext!.functions.getFunctionClassNames()).to.not.include(unknownFunctionName);
		});
	});

	describe('saveIteration and loadIterations', () => {
		let agentIdForIterations: string;
		let agentIdForOtherUser: string;

		beforeEach(async () => {
			agentIdForIterations = agentId();
			agentIdForOtherUser = agentId();
			// Save a base agent context first, as iterations belong to an agent
			setCurrentUser(testUser);
			await service.save(createMockAgentContext(agentIdForIterations, {}, testUser));

			// Save an agent for another user and an iteration for it
			setCurrentUser(otherUser);
			await service.save(createMockAgentContext(agentIdForOtherUser, {}, otherUser));
			await service.saveIteration(createMockIteration(1, agentIdForOtherUser));
			setCurrentUser(testUser); // Switch back
		});

		const createMockIteration = (iterNum: number, agentIdToUse: string = agentIdForIterations): AutonomousIteration => ({
			agentId: agentIdToUse,
			iteration: iterNum,
			createdAt: Date.now(),
			functions: ['Agent', MockFunction.name],
			prompt: `Prompt for iteration ${iterNum}`,
			response: `Response for iteration ${iterNum}`,
			summary: `Summary for iteration ${iterNum}`,
			expandedUserRequest: `Expanded request for iteration ${iterNum}`,
			observationsReasoning: `Observations for iteration ${iterNum}`,
			agentPlan: `<plan>Plan for iteration ${iterNum}</plan>`,
			nextStepDetails: `Next step details for iteration ${iterNum}`,
			code: `print("Iteration ${iterNum}")`,
			executedCode: `print("Iteration ${iterNum}")`,
			draftCode: undefined,
			codeReview: undefined,
			images: [],
			functionCalls: [
				{
					function_name: MockFunction.name,
					parameters: { arg: iterNum },
					stdout: `Result ${iterNum}`,
				},
			],
			memory: { [`memoryKey${iterNum}`]: `memoryValue${iterNum}` },
			toolState: { [`toolKey${iterNum}`]: `toolValue${iterNum}`, LiveFiles: ['file1', 'file2'] },
			error: iterNum % 3 === 0 ? `Simulated error for iteration ${iterNum}` : undefined, // Add error sometimes
			stats: {} as GenerationStats,
			cost: 0.001,
		});

		it('should save multiple iterations for an agent', async () => {
			const iteration1 = createMockIteration(1);
			const iteration2 = createMockIteration(2);

			await service.saveIteration(iteration1);
			await service.saveIteration(iteration2);

			// Simple verification: load them back and check count
			const loadedIterations = await service.loadIterations(agentIdForIterations); // loadIterations now throws on agent not found/not allowed
			expect(loadedIterations).to.be.an('array').with.lengthOf(2);
		});

		it('should load iterations in correct numerical order', async () => {
			const iteration3 = createMockIteration(3);
			const iteration1 = createMockIteration(1);
			const iteration2 = createMockIteration(2);

			// Save out of order
			await service.saveIteration(iteration3);
			await service.saveIteration(iteration1);
			await service.saveIteration(iteration2);

			const loadedIterations = await service.loadIterations(agentIdForIterations); // loadIterations now throws on agent not found/not allowed

			expect(loadedIterations).to.be.an('array').with.lengthOf(3);
			expect(loadedIterations.map((i) => i.iteration)).to.deep.equal([1, 2, 3]);
			// Deep compare the first loaded iteration with the original data
			expect(loadedIterations[0]).to.deep.equal(iteration1);
			expect(loadedIterations[1]).to.deep.equal(iteration2);
			expect(loadedIterations[2]).to.deep.equal(iteration3);
		});

		it('should return an empty array if no iterations exist for the agent', async () => {
			// Create a new agent with no iterations saved
			const agentIdNoIterations = agentId();
			setCurrentUser(testUser);
			await service.save(createMockAgentContext(agentIdNoIterations, {}, testUser));

			const loadedIterations = await service.loadIterations(agentIdNoIterations); // loadIterations now throws on agent not found/not allowed
			expect(loadedIterations).to.be.an('array').that.is.empty;
		});

		// Modified test to expect NotFound error
		it('should throw NotFound when loading iterations for a non-existent agent', async () => {
			const nonExistentAgentId = agentId();
			await expect(service.loadIterations(nonExistentAgentId)).to.be.rejectedWith(NotFound);
		});

		// Added test for NotAllowed error
		it('should throw NotAllowed when loading iterations for an agent not owned by current user', async () => {
			// agentIdForOtherUser was saved for otherUser in beforeEach, with an iteration
			setCurrentUser(testUser); // Ensure current user is testUser

			await expect(service.loadIterations(agentIdForOtherUser)).to.be.rejectedWith(NotAllowed);
		});

		it('should reject saving an iteration with a non-positive iteration number', async () => {
			const invalidIterationZero = createMockIteration(0);
			const invalidIterationNegative = createMockIteration(-1);

			await expect(service.saveIteration(invalidIterationZero)).to.be.rejectedWith(/positive integer/i);
			await expect(service.saveIteration(invalidIterationNegative)).to.be.rejectedWith(/positive integer/i);
		});

		it('should save and load an iteration with detailed memory and toolState, including LiveFiles and FileStore info', async () => {
			const iterationNumber = 1;
			const originalMemory: Record<string, string> = {
				// Changed to Record
				previousSummary: 'The agent analyzed user requirements.',
				currentFocus: 'Generating initial code structure.',
				'complexKey.with.dots': 'value for complex key',
			};

			const originalToolState: Record<string, any> = {
				LiveFiles: { monitoredFiles: ['fileA.ts', 'fileB.js', 'src/test.py'], lastCheckTimestamp: Date.now() - 10000 },
				FileStore: {
					lastSavedFile: '/project/output/data.json',
					recentUploads: ['/tmp/upload1.zip', '/tmp/upload2.tar.gz'],
					metadataCache: {
						'/project/output/data.json': { size: 1024, type: 'application/json' },
					},
				},
				anotherTool: { configValue: 123, isActive: true, subSettings: { detail: 'xyz' } },
			};

			const originalStats: GenerationStats = {
				requestTime: Date.now() - 500,
				timeToFirstToken: 150,
				totalTime: 450,
				inputTokens: 200,
				outputTokens: 300,
				cost: 0.0005,
				llmId: 'mock-llm-model-for-iteration',
			};

			const originalIteration: AutonomousIteration = {
				agentId: agentIdForIterations,
				iteration: iterationNumber,
				createdAt: Date.now(),
				functions: ['Agent', MockFunction.name, 'LiveFiles_tool', 'FileStore_tool'],
				prompt: `Detailed prompt for iteration ${iterationNumber} with specific instructions.`,
				response: `Response for iteration ${iterationNumber}`,
				summary: `Detailed summary for iteration ${iterationNumber}.`,
				expandedUserRequest: `Elaborated user request for iteration ${iterationNumber}.`,
				observationsReasoning: `Observations and reasoning for iteration ${iterationNumber}: focused on file operations.`,
				agentPlan: '<plan><step>1. Monitor files using LiveFiles.</step><step>2. Save output using FileStore.</step></plan>',
				nextStepDetails: `Next step involves processing ${originalToolState.LiveFiles.monitoredFiles.length} files.`,
				code: `// Iteration ${iterationNumber} code\nconsole.log("Processing files");`,
				executedCode: `// Iteration ${iterationNumber} executed code\nconsole.log("Processing files");\n// Output: Files processed`,
				draftCode: `// Draft for iteration ${iterationNumber}\nlet x = 10;`,
				codeReview: 'Looks good, but consider edge cases for LiveFiles.',
				images: [{ type: 'image', mediaType: 'image/png', image: 'base64encodedimagedata...', filename: 'test.png', size: 2000 }],
				functionCalls: [
					{
						function_name: MockFunction.name,
						parameters: { tool_input: { file: 'fileA.ts' }, iteration: iterationNumber },
						stdout: `MockFunction result for iteration ${iterationNumber}`,
					},
					{
						function_name: 'LiveFiles_tool',
						parameters: { tool_input: { action: 'monitor', files: ['fileA.ts'] }, iteration: iterationNumber }, // Added iteration
						stdout: 'Monitoring fileA.ts',
					},
				],
				memory: originalMemory,
				toolState: originalToolState,
				error: undefined, // No error for this successful iteration
				stats: originalStats,
				cost: 0.002, // Added missing property
			};

			await service.saveIteration(originalIteration);

			const loadedIterations = await service.loadIterations(agentIdForIterations); // loadIterations now throws on agent not found/not allowed

			expect(loadedIterations).to.be.an('array').with.lengthOf(1);
			const loadedIteration = loadedIterations[0];

			// Perform a deep equality check for the entire iteration object
			// This is the most comprehensive way to ensure all fields, including nested Maps and objects, are preserved.
			expect(loadedIteration).to.deep.equal(originalIteration);

			// Explicit checks for memory and toolState to be certain about Record reconstruction
			expect(loadedIteration.memory).to.be.an('object').and.not.be.instanceOf(Map);
			expect(loadedIteration.toolState).to.be.an('object').and.not.be.instanceOf(Map);

			// To be absolutely sure about Record contents:
			expect(loadedIteration.memory).to.deep.equal(originalMemory);
			expect(loadedIteration.toolState).to.deep.equal(originalToolState);

			// Check a nested property within toolState
			expect(loadedIteration.toolState!.FileStore.metadataCache['/project/output/data.json'].size).to.equal(1024); // Access as Record
		});

		// Optional: Test saving iteration for non-existent agent (depends on desired behavior - Firestore might allow it)
		// it('should handle saving an iteration for a non-existent agent gracefully (or throw)', async () => {
		// 	const nonExistentAgentId = agentId();
		// 	const iteration1 = createMockIteration(1, nonExistentAgentId);
		// 	// Depending on implementation, this might throw or succeed but be orphaned.
		// 	// For Firestore subcollections, it usually succeeds.
		// 	await expect(service.saveIteration(iteration1)).to.not.be.rejected;
		// 	// Verify it can be loaded back even if parent doesn't exist
		// 	const loaded = await service.loadIterations(nonExistentAgentId); // This will now throw NotFound
		// 	expect(loaded).to.be.an('array').with.lengthOf(1); // This assertion is now incorrect
		// 	expect(loaded[0]).to.deep.equal(iteration1); // This assertion is now incorrect
		// });
	});

	// Added describe block for getAgentIterationDetail tests
	describe('getAgentIterationDetail', () => {
		let agentIdForIterations: string;
		let otherUsersAgentId: string;
		const iterationNumber = 1;

		beforeEach(async () => {
			agentIdForIterations = agentId();
			otherUsersAgentId = agentId();
			setCurrentUser(testUser);
			await service.save(createMockAgentContext(agentIdForIterations, {}, testUser));
			await service.saveIteration(createMockIteration(iterationNumber, agentIdForIterations));

			// Save an agent and iteration for another user
			setCurrentUser(otherUser);
			await service.save(createMockAgentContext(otherUsersAgentId, {}, otherUser));
			await service.saveIteration(createMockIteration(iterationNumber, otherUsersAgentId));
			setCurrentUser(testUser); // Switch back
		});

		const createMockIteration = (iterNum: number, agentIdToUse: string): AutonomousIteration => ({
			agentId: agentIdToUse,
			iteration: iterNum,
			createdAt: Date.now(),
			functions: ['Agent'],
			prompt: `Prompt ${iterNum}`,
			response: `Response ${iterNum}`,
			summary: `Summary ${iterNum}`,
			expandedUserRequest: `Expanded ${iterNum}`,
			observationsReasoning: `Reasoning ${iterNum}`,
			agentPlan: `Plan ${iterNum}`,
			nextStepDetails: `Next ${iterNum}`,
			code: `Code ${iterNum}`,
			executedCode: `Executed ${iterNum}`,
			draftCode: `Draft ${iterNum}`,
			codeReview: `Review ${iterNum}`,
			images: [],
			functionCalls: [],
			memory: {},
			toolState: {},
			error: undefined,
			stats: {} as GenerationStats,
			cost: 0.001,
		});

		it('should return the iteration detail if agent and iteration exist and are owned by the current user', async () => {
			const detail = await service.getAgentIterationDetail(agentIdForIterations, iterationNumber);
			expect(detail).to.not.be.null;
			expect(detail!.agentId).to.equal(agentIdForIterations);
			expect(detail!.iteration).to.equal(iterationNumber);
		});

		// Modified test to expect NotFound error
		it('should throw NotFound if agent does not exist', async () => {
			const nonExistentAgentId = agentId();
			await expect(service.getAgentIterationDetail(nonExistentAgentId, iterationNumber)).to.be.rejectedWith(NotFound);
		});

		// Added test for NotAllowed error
		it('should throw NotAllowed if agent is not owned by current user', async () => {
			// otherUsersAgentId was saved for otherUser in beforeEach
			setCurrentUser(testUser); // Ensure current user is testUser

			await expect(service.getAgentIterationDetail(otherUsersAgentId, iterationNumber)).to.be.rejectedWith(NotAllowed);
		});

		// Modified test to expect NotFound error
		it('should throw NotFound if agent exists but iteration does not', async () => {
			const nonExistentIterationNumber = 999;
			await expect(service.getAgentIterationDetail(agentIdForIterations, nonExistentIterationNumber)).to.be.rejectedWith(NotFound);
		});
	});

	// Added describe block for getAgentIterationSummaries tests
	describe('getAgentIterationSummaries', () => {
		let agentIdForIterations: string;
		let otherUsersAgentId: string;

		beforeEach(async () => {
			agentIdForIterations = agentId();
			otherUsersAgentId = agentId();
			setCurrentUser(testUser);
			await service.save(createMockAgentContext(agentIdForIterations, {}, testUser));
			await service.saveIteration(createMockIteration(1, agentIdForIterations)); // Save at least one iteration
			await service.saveIteration(createMockIteration(2, agentIdForIterations));

			// Save an agent and iteration for another user
			setCurrentUser(otherUser);
			await service.save(createMockAgentContext(otherUsersAgentId, {}, otherUser));
			await service.saveIteration(createMockIteration(1, otherUsersAgentId));
			setCurrentUser(testUser); // Switch back
		});

		const createMockIteration = (iterNum: number, agentIdToUse: string): AutonomousIteration => ({
			agentId: agentIdToUse,
			iteration: iterNum,
			createdAt: Date.now(),
			functions: ['Agent'],
			prompt: `Prompt ${iterNum}`,
			response: `Response ${iterNum}`,
			summary: `Summary ${iterNum}`,
			expandedUserRequest: `Expanded ${iterNum}`,
			observationsReasoning: `Reasoning ${iterNum}`,
			agentPlan: `Plan ${iterNum}`,
			nextStepDetails: `Next ${iterNum}`,
			code: `Code ${iterNum}`,
			executedCode: `Executed ${iterNum}`,
			draftCode: `Draft ${iterNum}`,
			codeReview: `Review ${iterNum}`,
			images: [],
			functionCalls: [],
			memory: {},
			toolState: {},
			error: iterNum === 2 ? 'Simulated Error' : undefined, // Add error to one iteration
			stats: {} as GenerationStats,
			cost: 0.001 * iterNum,
		});

		it('should return iteration summaries for the agent owned by the current user', async () => {
			const summaries = await service.getAgentIterationSummaries(agentIdForIterations);
			expect(summaries).to.be.an('array').with.lengthOf(2);
			expect(summaries.map((s) => s.iteration)).to.deep.equal([1, 2]);
			expect(summaries[0].summary).to.equal('Summary 1');
			expect(summaries[1].error).to.equal('Simulated Error');
			expect(summaries[1].cost).to.equal(0.002);
		});

		// Modified test to expect NotFound error
		it('should throw NotFound if agent does not exist', async () => {
			const nonExistentAgentId = agentId();
			await expect(service.getAgentIterationSummaries(nonExistentAgentId)).to.be.rejectedWith(NotFound);
		});

		// Added test for NotAllowed error
		it('should throw NotAllowed if agent is not owned by current user', async () => {
			// otherUsersAgentId was saved for otherUser in beforeEach
			setCurrentUser(testUser); // Ensure current user is testUser

			await expect(service.getAgentIterationSummaries(otherUsersAgentId)).to.be.rejectedWith(NotAllowed);
		});

		it('should return empty array if agent exists but has no iterations (and not throw NotFound for iterations)', async () => {
			const agentWithNoIterationsId = agentId();
			setCurrentUser(testUser);
			await service.save(createMockAgentContext(agentWithNoIterationsId, {}, testUser));
			// Do not save any iterations for this agent

			const summaries = await service.getAgentIterationSummaries(agentWithNoIterationsId); // getAgentIterationSummaries now throws on agent not found/not allowed
			expect(summaries).to.be.an('array').that.is.empty;
		});
	});
}
