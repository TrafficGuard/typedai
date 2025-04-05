import { randomUUID } from 'crypto';
import chai, { expect } from 'chai';
import chaiAsPromised from 'chai-as-promised';
chai.use(chaiAsPromised);
import sinon from 'sinon';
import { LlmFunctions } from '#agent/LlmFunctions'; // Adjust path as needed
import {
	AgentCompleted,
	AgentContext,
	AgentLLMs,
	AgentRunningState,
	AgentType,
	isExecuting,
	// TaskLevel, // Not explicitly used in AgentContext, but used in AgentLLMs
} from '#agent/agentContextTypes'; // Adjust path as needed
// Assume FileSystemService is importable if needed, or handle its absence
// import { FileSystemService } from '#system/fileSystemService';
// Assume Agent class is importable if needed for LlmFunctions default
import { Agent } from '#agent/agentFunctions';
import { AgentStateService } from '#agent/agentStateService/agentStateService'; // Adjust path as needed
import { clearCompletedHandlers, getCompletedHandler, registerCompletedHandler } from '#agent/completionHandlerRegistry'; // Adjust path if needed
import * as functionSchema from '#functionSchema/functionDecorators'; // Adjust path as needed
import { FileSystemRead } from '#functions/storage/fileSystemRead'; // Adjust path as needed
import { FunctionCallResult, LLM, LlmMessage } from '#llm/llm'; // Adjust path as needed
import { MockLLM } from '#llm/services/mock-llm'; // Adjust path as needed
import { logger } from '#o11y/logger'; // Adjust path as needed
import { ChatSettings, LLMServicesConfig, User } from '#user/user'; // Adjust path as needed
import * as userContext from '#user/userService/userContext';
import { appContext } from '../../applicationContext';

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

const testUser: User = {
	id: 'test-user-123',
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

const otherUser: User = {
	id: 'other-user-456',
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
		user: currentUser, // Use the provided or default User object
		state: 'agent', // Use string literal type
		callStack: ['initial_call'],
		error: undefined,
		// Use HIL settings from the User object by default
		hilBudget: currentUser.hilBudget,
		hilCount: currentUser.hilCount,
		cost: 0,
		budgetRemaining: currentUser.hilBudget, // Initialize remaining budget
		llms: defaultLlms,
		fileSystem: null, // Assume null if FileSystemService not mocked/provided
		memory: { defaultMemory: 'some data' },
		lastUpdate: now - 5000,
		metadata: { source: 'unit-test' },
		functions: new LlmFunctions(), // Instantiate LlmFunctions
		completedHandler: undefined,
		pendingMessages: [],
		type: 'codegen',
		iterations: 0,
		invoking: [],
		notes: [],
		userPrompt: 'Default user prompt',
		inputPrompt: 'Default input prompt string', // Ensure it's a string
		messages: [{ role: 'user', content: 'Default initial message' }],
		functionCallHistory: [],
		liveFiles: [],
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
		functions: overrides.functions instanceof LlmFunctions ? overrides.functions : baseContext.functions,
		callStack: overrides.callStack ?? baseContext.callStack,
		pendingMessages: overrides.pendingMessages ?? baseContext.pendingMessages,
		invoking: overrides.invoking ?? baseContext.invoking,
		notes: overrides.notes ?? baseContext.notes,
		messages: overrides.messages ?? baseContext.messages,
		functionCallHistory: overrides.functionCallHistory ?? baseContext.functionCallHistory,
		liveFiles: overrides.liveFiles ?? baseContext.liveFiles,
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
	createService: () => AgentStateService,
	beforeEachHook: () => Promise<void> | void = () => {},
	afterEachHook: () => Promise<void> | void = () => {},
) {
	let service: AgentStateService;
	let currentUserStub: sinon.SinonStub;
	let functionFactoryStub: sinon.SinonStub;
	let loggerWarnStub: sinon.SinonStub;

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
		currentUserStub = sinon.stub(userContext, 'currentUser').returns(testUser);
		// Ensure functionFactory returns the classes needed by LlmFunctions.fromJSON and tests
		functionFactoryStub = sinon.stub(functionSchema, 'functionFactory').returns(mockFunctionFactoryContent);
		loggerWarnStub = sinon.stub(logger, 'warn');

		// Register mock handlers needed for tests
		clearCompletedHandlers(); // Clear any handlers from previous tests
		registerCompletedHandler(new MockAgentCompleted()); // Register the mock handler instance
	});

	afterEach(async () => {
		sinon.restore();
		clearCompletedHandlers(); // Clean up registered handlers
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
			const contextFunctions = new LlmFunctions(); // Create LlmFunctions instance
			contextFunctions.addFunctionInstance(mockFunctionInstance, MockFunction.name); // Add our test function

			const context = createMockAgentContext(id, {
				user: testUser, // Use the fully typed user
				cost: 0.25,
				budgetRemaining: testUser.hilBudget - 0.25,
				state: 'functions', // Use string literal
				memory: { dataKey: 'important data' },
				metadata: { project: 'X', runId: 123 },
				completedHandler: mockCompletedHandler,
				functions: contextFunctions, // Assign the LlmFunctions instance
				functionCallHistory: funcHistory,
				iterations: 3,
				notes: ['Processing complete', 'Check output'],
				callStack: ['start', 'process', 'invoke_func1'],
				messages: [
					{ role: 'user', content: 'Start processing' },
					{ role: 'assistant', content: 'Okay, calling func1' },
				],
			});

			await service.save(context);
			const loadedContext = await service.load(id);

			expect(loadedContext).to.not.be.null;

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
			expect(loadedContext.functions).to.be.instanceOf(LlmFunctions);
			expect(loadedContext.functions.getFunctionClassNames()).to.include(MockFunction.name); // Check the specific function added

			// Verify LLM deserialization (checking one is representative)
			expect(loadedContext.llms.easy.getId()).to.equal(context.llms.easy.getId());

			// Verify completedHandler state after load by checking its ID
			// The instance itself might be different, but it should be rehydrated correctly
			// based on the stored ID.
			expect(loadedContext.completedHandler).to.exist; // Check it's not null/undefined
			expect(loadedContext.completedHandler.agentCompletedHandlerId()).to.equal(mockCompletedHandler.agentCompletedHandlerId());

			// Assert lastUpdate exists
			expect(loadedContext.lastUpdate).to.be.a('number');
		});

		it('should overwrite an existing agent context on save', async () => {
			const id = agentId();
			const context1 = createMockAgentContext(id, { name: 'V1', state: 'agent', iterations: 1 });
			await service.save(context1);
			const savedTime1 = (await service.load(id)).lastUpdate;

			await new Promise((resolve) => setTimeout(resolve, 10)); // Ensure time passes

			const context2 = createMockAgentContext(id, { name: 'V2', state: 'completed', iterations: 2 });
			await service.save(context2);

			const loadedContext = await service.load(id);
			// Assert only the changed fields and lastUpdate
			expect(loadedContext.name).to.equal('V2');
			expect(loadedContext.state).to.equal('completed');
			expect(loadedContext.iterations).to.equal(2);
			expect(loadedContext.lastUpdate).to.be.greaterThan(savedTime1);
		});

		it('should return null when loading a non-existent agent', async () => {
			const id = agentId();
			expect(await service.load(id)).to.be.null;
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
			expect(loadedParent.childAgents).to.deep.equal([childId]);

			// Load and verify child's parentAgentId
			const loadedChild = await service.load(childId);
			expect(loadedChild).to.not.be.null;
			expect(loadedChild.parentAgentId).to.equal(parentId);
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
			const loadedContext = await service.load(id);
			expect(loadedContext).to.not.be.null;
			// Assert the persisted state matches the new state
			expect(loadedContext.state).to.equal(newState);
			// Assert one other property to ensure only state was updated
			expect(loadedContext.name).to.equal(originalName);
		});
	});

	describe('list', () => {
		let agentId1: string;
		let agentId2: string;
		let otherUserAgentId: string;

		beforeEach(async () => {
			currentUserStub.returns(testUser);
			agentId1 = agentId();
			agentId2 = agentId();
			otherUserAgentId = agentId();

			await service.save(createMockAgentContext(agentId(), { name: 'Oldest', lastUpdate: Date.now() - 3000 }, testUser));
			await service.save(createMockAgentContext(agentId1, { name: 'Middle', lastUpdate: Date.now() - 2000 }, testUser));
			await service.save(createMockAgentContext(agentId2, { name: 'Newest', lastUpdate: Date.now() - 1000 }, testUser));

			// Save one for other user
			currentUserStub.returns(otherUser);
			await service.save(createMockAgentContext(otherUserAgentId, { name: 'Other User Agent', lastUpdate: Date.now() - 1500 }, otherUser));
			currentUserStub.returns(testUser); // Switch back
		});

		it('should list agent contexts for the current user, ordered by lastUpdate descending', async () => {
			currentUserStub.returns(testUser); // Ensure correct user context
			const contexts = await service.list();

			// Assert the correct number of agents for the current user
			expect(contexts).to.be.an('array').with.lengthOf(3);
			// Assert the order based on lastUpdate (using name as a proxy)
			expect(contexts.map((c) => c.name)).to.deep.equal(['Newest', 'Middle', 'Oldest']);

			// Assert that essential fields are present in each listed context
			// Note: The exact fields returned by list() might vary slightly by implementation,
			// but these are generally expected for a summary view.
			contexts.forEach((ctx) => {
				expect(ctx).to.include.keys(['agentId', 'name', 'state', 'lastUpdate', 'user']);
				// Check user association: list() now returns a partial context where user is { id: '...' }
				expect(ctx.user).to.exist;
				expect(ctx.user.id).to.equal(testUser.id);
			});
		});

		it('should return an empty array if no agents exist for the current user', async () => {
			// Switch to a user guaranteed to have no agents saved in beforeEach
			currentUserStub.returns({ ...otherUser, id: 'no-agents-user-404' });
			const contexts = await service.list();
			expect(contexts).to.be.an('array').that.is.empty;
		});
	});

	describe('listRunning', () => {
		beforeEach(async () => {
			currentUserStub.returns(testUser); // Consistent user for saving

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

			// Expected running/active states based on beforeEach data and the Firestore query:
			// Query sorts by state ASC, then lastUpdate DESC.
			// States saved: workflow, agent, functions, hitl_tool, hitl_feedback, hitl_threshold, child_agents, error
			// Timestamps (relative): functions(-500), workflow(-1000), hitl_tool(-1500), hitl_feedback(-2000),
			//                       hitl_threshold(-2500), agent(-3000), child_agents(-3500), error(-4000)
			// Expected Order based on Firestore query: state ASC, then lastUpdate DESC.
			// Calculated from the timestamps set in the beforeEach hook for this describe block.
			const expectedRunningStates: AgentRunningState[] = [
				'agent', // lastUpdate: -3000
				'child_agents', // lastUpdate: -3500
				'error', // lastUpdate: -4000
				'functions', // lastUpdate: -500  (Most recent within its state group)
				'hitl_feedback', // lastUpdate: -2000
				'hitl_threshold', // lastUpdate: -2500
				'hitl_tool', // lastUpdate: -1500
				'workflow', // lastUpdate: -1000
			];

			// Assert the correct number of non-terminal agents found
			expect(contexts).to.be.an('array').with.lengthOf(expectedRunningStates.length);
			// Assert the order based on the compound sort (state ASC, lastUpdate DESC)
			expect(contexts.map((c) => c.state)).to.deep.equal(expectedRunningStates);

			// Verify that no terminal states are included and key fields are present
			contexts.forEach((ctx) => {
				expect(ctx.state).to.not.be.oneOf(['completed', 'shutdown', 'timeout']);
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
			currentUserStub.returns(testUser);

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
			currentUserStub.returns(testUser); // Ensure correct user context
			await service.delete([agentIdCompleted, agentIdError]);

			// Verify the specified agents are deleted
			expect(await service.load(agentIdCompleted)).to.be.null;
			expect(await service.load(agentIdError)).to.be.null;
		});

		it('should NOT delete agents belonging to other users', async () => {
			currentUserStub.returns(testUser); // Ensure correct user context
			await service.delete([agentIdCompleted, otherUserAgentId]);

			// Verify testUser's agent is deleted
			expect(await service.load(agentIdCompleted)).to.be.null;
			// Verify otherUser's agent is NOT deleted
			expect(await service.load(otherUserAgentId)).to.not.be.null;
		});

		it('should NOT delete executing agents', async () => {
			currentUserStub.returns(testUser); // Ensure correct user context
			await service.delete([agentIdCompleted, executingAgentId]);

			// Verify the non-executing agent is deleted
			expect(await service.load(agentIdCompleted)).to.be.null;
			// Verify the executing agent is NOT deleted
			expect(await service.load(executingAgentId)).to.not.be.null;
		});

		it('should delete a parent agent AND its children when parent ID is provided (if parent is deletable)', async () => {
			currentUserStub.returns(testUser); // Ensure correct user context
			// Delete the parent (which is in 'completed' state)
			await service.delete([parentIdCompleted]);

			// Verify parent and all children are deleted
			expect(await service.load(parentIdCompleted)).to.be.null;
			expect(await service.load(childId1)).to.be.null;
			expect(await service.load(childId2)).to.be.null;
		});

		it('should NOT delete child agents if only child ID is provided (due to implementation filter)', async () => {
			currentUserStub.returns(testUser); // Ensure correct user context
			// Attempt to delete only a child agent
			await service.delete([childId1]);

			// Verify parent remains
			expect(await service.load(parentIdCompleted)).to.not.be.null;
			// Verify the targeted child *remains* because the implementation filters for !parentAgentId
			expect(await service.load(childId1)).to.not.be.null;
			// Verify the other child remains
			expect(await service.load(childId2)).to.not.be.null;
		});

		it('should handle non-existent IDs gracefully without error', async () => {
			const nonExistentId = agentId();
			currentUserStub.returns(testUser); // Ensure correct user context

			// Attempt to delete an existing deletable agent and a non-existent one
			await expect(service.delete([agentIdCompleted, nonExistentId])).to.not.be.rejected;

			// Verify the existing deletable agent was actually deleted
			expect(await service.load(agentIdCompleted)).to.be.null;
		});
	});

	describe('updateFunctions', () => {
		let agentId1: string;

		beforeEach(async () => {
			agentId1 = agentId();
			// Start with default functions (like Agent) + potentially FileSystemRead based on LlmFunctions constructor/fromJSON behavior
			await service.save(createMockAgentContext(agentId1, { functions: new LlmFunctions() }));
		});

		it('should update the functions for an existing agent, replacing defaults', async () => {
			const functionNames = [MockFunction.name]; // Use class name
			await service.updateFunctions(agentId1, functionNames);

			const loadedContextAfterUpdate = await service.load(agentId1);
			expect(loadedContextAfterUpdate).to.not.be.null;
			expect(loadedContextAfterUpdate.functions).to.be.instanceOf(LlmFunctions);

			const updatedFunctionNames = loadedContextAfterUpdate.functions.getFunctionClassNames();
			// Verify the specified function was added
			// Verify the specified function was added
			expect(updatedFunctionNames).to.include(MockFunction.name);
			// Verify default 'Agent' function remains because updateFunctions creates a new LlmFunctions()
			expect(updatedFunctionNames).to.include(Agent.name);
			// Check the total number of functions expected (Agent + MockFunction)
			expect(updatedFunctionNames).to.have.lengthOf(2);
			// expect(updatedFunctionNames).to.not.include(FileSystemRead.name);
		});

		it('should replace existing functions with the new list (empty list results in defaults)', async () => {
			// Add a function first to ensure replacement works
			await service.updateFunctions(agentId1, [MockFunction.name]);
			let context = await service.load(agentId1);
			expect(context.functions.getFunctionClassNames()).to.include(MockFunction.name);

			// Now update with an empty list
			await service.updateFunctions(agentId1, []);
			context = await service.load(agentId1);
			expect(context.functions).to.be.instanceOf(LlmFunctions);

			// Get the expected default function names added by LlmFunctions constructor
			const defaultFuncs = new LlmFunctions();
			// Assert that the agent's functions now only contain the defaults
			expect(context.functions.getFunctionClassNames().sort()).to.deep.equal(defaultFuncs.getFunctionClassNames().sort());
		});

		it('should throw an error if the agent does not exist', async () => {
			const nonExistentId = agentId();
			// Assert that the promise rejects with an error message indicating the agent wasn't found
			await expect(service.updateFunctions(nonExistentId, [MockFunction.name])).to.be.rejectedWith(/Agent not found|cannot find agent/i);
		});

		it('should warn and skip if a function name is not found in the factory', async () => {
			const unknownFunctionName = 'UnknownFunctionClassForTest';
			// Ensure the unknown function is NOT in our mocked factory for the test
			expect(mockFunctionFactoryContent[unknownFunctionName]).to.be.undefined;

			// Attempt to update with a known and an unknown function
			await service.updateFunctions(agentId1, [MockFunction.name, unknownFunctionName]);

			// Load the agent state after the update attempt
			const updatedContext = await service.load(agentId1);
			expect(updatedContext).to.not.be.null;

			// Assert that the logger.warn was called with a message containing the unknown function name
			// This warning likely happens during LlmFunctions.fromJSON called internally by load/save
			expect(loggerWarnStub.calledWith(sinon.match(unknownFunctionName))).to.be.true; // Use sinon.match for flexibility

			// Assert the known function *was* added successfully
			expect(updatedContext.functions.getFunctionClassNames()).to.include(MockFunction.name);
			// Assert the unknown function *was not* added
			expect(updatedContext.functions.getFunctionClassNames()).to.not.include(unknownFunctionName);
		});
	});
}
