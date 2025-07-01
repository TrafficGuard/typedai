import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { fakeAsync, tick } from '@angular/core/testing'; // Added fakeAsync and tick for more control if needed, though direct checks might suffice.
import { Static } from '@sinclair/typebox';
import { of, throwError } from 'rxjs';
import { AGENT_API } from '#shared/agent/agent.api';
import { AgentContextPreview, AutonomousIteration } from '#shared/agent/agent.model';
import { type AgentContextApi, type AgentContextSchema, AgentIdParamsSchema, AgentStartRequestSchema } from '#shared/agent/agent.schema'; // Added AgentStartRequestSchema
import { RouteDefinition } from '#shared/api-definitions';
import { ApiNullResponseSchema } from '#shared/common.schema';
import type { LlmMessagesSchema } from '#shared/llm/llm.schema';
import { LlmCall } from '#shared/llmCall/llmCall.model';
import { AgentService, AgentStartRequestData } from './agent.service'; // Added AgentStartRequestData

xdescribe('AgentService', () => {
	let service: AgentService;
	let httpMock: HttpTestingController;

	// Helper to create a minimal valid AgentContextApi (Static<typeof AgentContextSchema>)
	const createMockAgentContext = (id: string, name?: string, state?: Static<typeof AgentContextSchema.properties.state>): AgentContextApi => ({
		agentId: id,
		type: 'autonomous',
		subtype: 'xml',
		executionId: `exec-${id}`,
		typedAiRepoDir: '/test/repo',
		traceId: `trace-${id}`,
		name: name || `Agent ${id}`,
		user: `user-${id}`, // User is a string ID in AgentContextApi
		state: state || 'completed',
		callStack: [],
		hilBudget: 100,
		cost: 50,
		budgetRemaining: 50,
		llms: {
			// LLMs are string IDs in AgentContextApi
			easy: 'llm-easy-id',
			medium: 'llm-medium-id',
			hard: 'llm-hard-id',
			// xhard is optional
		},
		fileSystem: {
			// fileSystem is an object or null
			basePath: '/test/fs',
			workingDirectory: '/test/fs/work',
		},
		useSharedRepos: true,
		memory: {},
		lastUpdate: Date.now(),
		metadata: {},
		functions: {
			// functions is an object with functionClasses array
			functionClasses: ['TestFunctionClass1', 'TestFunctionClass2'],
		},
		completedHandler: `handler-${id}`, // completedHandler is an optional string ID
		pendingMessages: [],
		iterations: 1,
		invoking: [],
		notes: [],
		userPrompt: 'Test prompt',
		inputPrompt: 'Initial input',
		messages: [] as Static<typeof LlmMessagesSchema>, // messages is LlmMessage[]
		functionCallHistory: [],
		hilCount: 0,
		childAgents: undefined,
		parentAgentId: undefined,
		codeTaskId: undefined,
		error: undefined,
		output: undefined,
		hilRequested: undefined,
		toolState: undefined,
	});

	// Helper to create a minimal valid AgentContextPreview
	const createMockAgentContextPreview = (id: string, name?: string, state?: Static<typeof AgentContextSchema.properties.state>): AgentContextPreview => ({
		agentId: id,
		name: name || `Agent ${id} Preview`,
		state: state || 'completed',
		cost: Math.floor(Math.random() * 100),
		lastUpdate: Date.now() - Math.floor(Math.random() * 100000),
		userPrompt: `User prompt for ${id}`,
		inputPrompt: `Initial input for ${id}`,
		error: undefined,
		type: 'autonomous',
		subtype: ''
	});

	const mockFullAgent1: AgentContextApi = createMockAgentContext('agent1');
	const mockFullAgent2: AgentContextApi = createMockAgentContext('agent2');

	let mockPreviewAgent1: AgentContextPreview;
	let mockPreviewAgent2: AgentContextPreview;
	
	beforeEach(() => {
		TestBed.configureTestingModule({
			imports: [HttpClientTestingModule],
			providers: [AgentService],
		});
		service = TestBed.inject(AgentService);
		httpMock = TestBed.inject(HttpTestingController);
	
		mockPreviewAgent1 = createMockAgentContextPreview('agent1');
		mockPreviewAgent2 = createMockAgentContextPreview('agent2');
	
		// Mock initial loadAgents call in constructor
		const initialLoadReq = httpMock.expectOne(AGENT_API.list.pathTemplate);
		initialLoadReq.flush([mockPreviewAgent1, mockPreviewAgent2]);
	});
	
	afterEach(() => {
		httpMock.verify(); // Make sure that there are no outstanding requests
	});
	
	it('should be created', () => {
		expect(service).toBeTruthy();
	});
});
