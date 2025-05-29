import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { fakeAsync, tick } from '@angular/core/testing'; // Added fakeAsync and tick for more control if needed, though direct checks might suffice.
import { type Static, Type } from '@sinclair/typebox';
import { of, throwError } from 'rxjs';
import { AGENT_API } from '#shared/agent/agent.api';
import type { AutonomousIteration } from '#shared/agent/agent.model';
import { type AgentContextApi, type AgentContextSchema, AgentIdParamsSchema, AgentStartRequestSchema } from '#shared/agent/agent.schema'; // Added AgentStartRequestSchema
import { RouteDefinition } from '#shared/api-definitions';
import { ApiNullResponseSchema } from '#shared/common.schema';
import type { LlmMessagesSchema } from '#shared/llm/llm.schema';
import type { LlmCall } from '#shared/llmCall/llmCall.model';
import { AgentService, type AgentStartRequestData } from './agent.service'; // Added AgentStartRequestData

describe('AgentService', () => {
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
		user: `user-preview-${id}`,
		error: undefined,
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
		const initialLoadReq = httpMock.expectOne(AGENT_API.list.path);
		initialLoadReq.flush([mockPreviewAgent1, mockPreviewAgent2]);
	});

	afterEach(() => {
		httpMock.verify(); // Make sure that there are no outstanding requests
	});

	it('should be created', () => {
		expect(service).toBeTruthy();
	});

	describe('loadAgents / agentsState / refreshAgents', () => {
		it('should fetch agent previews on initial load and expose them via agentsState', () => {
			// The initial call is handled in beforeEach and flushed.
			const state = service.agentsState()();
			expect(state.status).toBe('success');
			expect(state.data?.length).toBe(2);
			expect(state.data).toEqual([mockPreviewAgent1, mockPreviewAgent2]);
		});

		it('refreshAgents should reload agents and update agentsState with previews', () => {
			const updatedMockPreviews: AgentContextPreview[] = [createMockAgentContextPreview('agent3')];

			// Initial state check
			const initialState = service.agentsState()();
			expect(initialState.status).toBe('success');
			expect(initialState.data).toEqual([mockPreviewAgent1, mockPreviewAgent2]);

			service.refreshAgents();

			const loadingState = service.agentsState()();
			expect(loadingState.status).toBe('loading');

			const req = httpMock.expectOne(AGENT_API.list.path);
			expect(req.request.method).toBe(AGENT_API.list.method);
			req.flush(updatedMockPreviews);

			const finalState = service.agentsState()();
			expect(finalState.status).toBe('success');
			expect(finalState.data).toEqual(updatedMockPreviews);
		});
	});

	describe('loadAgentDetails / selectedAgentDetailsState', () => {
		it('should load agent details and update selectedAgentDetailsState', () => {
			const testAgentId = 'agent1';
			expect(service.selectedAgentDetailsState()().status).toBe('idle');

			service.loadAgentDetails(testAgentId);
			expect(service.selectedAgentDetailsState()().status).toBe('loading');

			const expectedPath = AGENT_API.details.buildPath({ agentId: testAgentId });
			const req = httpMock.expectOne(expectedPath);
			expect(req.request.method).toBe(AGENT_API.details.method);
			req.flush(mockFullAgent1);

			const state = service.selectedAgentDetailsState()();
			expect(state.status).toBe('success');
			expect(state.data).toEqual(mockFullAgent1);
		});

		it('should handle 404 error and update selectedAgentDetailsState to not_found', () => {
			const testAgentId = 'agent-not-found';
			service.loadAgentDetails(testAgentId);
			expect(service.selectedAgentDetailsState()().status).toBe('loading');

			const req = httpMock.expectOne(AGENT_API.details.buildPath({ agentId: testAgentId }));
			req.flush('Not Found', { status: 404, statusText: 'Not Found' });

			const state = service.selectedAgentDetailsState()();
			expect(state.status).toBe('not_found');
		});

		it('should handle 403 error and update selectedAgentDetailsState to forbidden', () => {
			const testAgentId = 'agent-forbidden';
			service.loadAgentDetails(testAgentId);
			expect(service.selectedAgentDetailsState()().status).toBe('loading');

			const req = httpMock.expectOne(AGENT_API.details.buildPath({ agentId: testAgentId }));
			req.flush('Forbidden', { status: 403, statusText: 'Forbidden' });

			const state = service.selectedAgentDetailsState()();
			expect(state.status).toBe('forbidden');
		});

		it('should handle generic errors and update selectedAgentDetailsState to error', () => {
			const testAgentId = 'agent-error';
			service.loadAgentDetails(testAgentId);
			expect(service.selectedAgentDetailsState()().status).toBe('loading');

			const req = httpMock.expectOne(AGENT_API.details.buildPath({ agentId: testAgentId }));
			req.flush('Server Error', { status: 500, statusText: 'Server Error' });

			const state = service.selectedAgentDetailsState()();
			expect(state.status).toBe('error');
			expect(state.error).toBeInstanceOf(Error);
			expect(state.code).toBe(500);
		});

		it('clearSelectedAgentDetails should reset selectedAgentDetailsState to idle', () => {
			// Set a state first
			service.loadAgentDetails('agent1');
			const req = httpMock.expectOne(AGENT_API.details.buildPath({ agentId: 'agent1' }));
			req.flush(mockFullAgent1);
			expect(service.selectedAgentDetailsState()().status).toBe('success');

			service.clearSelectedAgentDetails();
			expect(service.selectedAgentDetailsState()().status).toBe('idle');
		});
	});

	describe('loadAgentIterations / agentIterationsState', () => {
		it('should load agent iterations and update agentIterationsState', () => {
			const testAgentId = 'agent1';
			expect(service.agentIterationsState()().status).toBe('idle');
			const mockIterations: AutonomousIteration[] = [
				{
					agentId: testAgentId,
					iteration: 1,
					cost: 0.1,
					summary: 'Iter 1',
					functions: ['ClassName1'],
					prompt: 'Test prompt',
					images: [],
					expandedUserRequest: '',
					observationsReasoning: '',
					agentPlan: '',
					nextStepDetails: '',
					draftCode: '',
					codeReview: '',
					code: '',
					executedCode: '',
					functionCalls: [],
					memory: {},
					toolState: {},
					stats: { requestTime: 1, timeToFirstToken: 1, totalTime: 1, inputTokens: 1, outputTokens: 1, cost: 1, llmId: '1' },
				},
			];
			service.loadAgentIterations(testAgentId);
			expect(service.agentIterationsState()().status).toBe('loading');

			const req = httpMock.expectOne(AGENT_API.getIterations.buildPath({ agentId: testAgentId }));
			expect(req.request.method).toBe(AGENT_API.getIterations.method);
			req.flush(mockIterations);

			const state = service.agentIterationsState()();
			expect(state.status).toBe('success');
			expect(state.data).toEqual(mockIterations);
		});

		it('clearAgentIterations should reset agentIterationsState to idle', () => {
			service.loadAgentIterations('agent1');
			const req = httpMock.expectOne(AGENT_API.getIterations.buildPath({ agentId: 'agent1' }));
			req.flush([]); // Flush with some data
			expect(service.agentIterationsState()().status).toBe('success');

			service.clearAgentIterations();
			expect(service.agentIterationsState()().status).toBe('idle');
		});
	});

	describe('loadLlmCalls / llmCallsState', () => {
		it('should load LLM calls and update llmCallsState', () => {
			const testAgentId = 'agent1';
			expect(service.llmCallsState()().status).toBe('idle');
			const mockLlmCallsData: LlmCall[] = [
				{
					id: 'call1',
					agentId: testAgentId,
					messages: [],
					settings: {},
					llmId: 'llm1',
					requestTime: Date.now(),
					provider: 'openai',
					model: 'gpt-4',
					type: 'chat',
					prompt: 'Hello',
					response: 'Hi',
					cost: 0.001,
					inputTokens: 10,
					outputTokens: 5,
					durationMs: 100,
				} as LlmCall,
			];
			service.loadLlmCalls(testAgentId);
			expect(service.llmCallsState()().status).toBe('loading');

			const req = httpMock.expectOne(AGENT_API.getLlmCallsByAgentId.buildPath({ agentId: testAgentId }));
			expect(req.request.method).toBe(AGENT_API.getLlmCallsByAgentId.method);
			req.flush({ data: mockLlmCallsData });

			const state = service.llmCallsState()();
			expect(state.status).toBe('success');
			expect(state.data).toEqual(mockLlmCallsData);
		});

		it('clearLlmCalls should reset llmCallsState to idle', () => {
			service.loadLlmCalls('agent1');
			const req = httpMock.expectOne(AGENT_API.getLlmCallsByAgentId.buildPath({ agentId: 'agent1' }));
			req.flush({ data: [] }); // Flush with some data
			expect(service.llmCallsState()().status).toBe('success');

			service.clearLlmCalls();
			expect(service.llmCallsState()().status).toBe('idle');
		});
	});

	describe('submitFeedback', () => {
		it('should POST feedback and update agent in agentsState', (done) => {
			const agentId = 'agent1';
			const executionId = 'exec-agent1';
			const feedback = 'Good job!';
			const updatedAgentData: AgentContextApi = { ...mockFullAgent1, name: 'Agent 1 Updated Feedback' };

			service.submitFeedback(agentId, executionId, feedback).subscribe((response) => {
				expect(response).toEqual(updatedAgentData);

				const agentListState = service.agentsState()();
				expect(agentListState.status).toBe('success');
				const cachedPreview = agentListState.data?.find((a) => a.agentId === agentId);
				const expectedPreview: AgentContextPreview = {
					agentId: updatedAgentData.agentId,
					name: updatedAgentData.name,
					state: updatedAgentData.state,
					cost: updatedAgentData.cost,
					error: updatedAgentData.error,
					lastUpdate: updatedAgentData.lastUpdate,
					userPrompt: updatedAgentData.userPrompt,
					inputPrompt: updatedAgentData.inputPrompt,
					user: updatedAgentData.user,
				};
				expect(cachedPreview).toEqual(expectedPreview);
				done();
			});

			const req = httpMock.expectOne(AGENT_API.feedback.path);
			expect(req.request.method).toBe(AGENT_API.feedback.method);
			expect(req.request.body).toEqual({ agentId, executionId, feedback });
			req.flush(updatedAgentData);
		});
	});

	describe('requestHilCheck', () => {
		it('should POST request and update agent in agentsState', (done) => {
			const agentId = 'agent1';
			const executionId = 'exec-agent1';
			const updatedAgentData: AgentContextApi = { ...mockFullAgent1, hilRequested: true, state: 'hitl_feedback' };

			service.requestHilCheck(agentId, executionId).subscribe((response) => {
				expect(response).toEqual(updatedAgentData);

				const agentListState = service.agentsState()();
				expect(agentListState.status).toBe('success');
				const cachedPreview = agentListState.data?.find((a) => a.agentId === agentId);
				const expectedPreview: AgentContextPreview = {
					agentId: updatedAgentData.agentId,
					name: updatedAgentData.name,
					state: updatedAgentData.state,
					cost: updatedAgentData.cost,
					error: updatedAgentData.error,
					lastUpdate: updatedAgentData.lastUpdate,
					userPrompt: updatedAgentData.userPrompt,
					inputPrompt: updatedAgentData.inputPrompt,
					user: updatedAgentData.user,
				};
				expect(cachedPreview).toEqual(jasmine.objectContaining(expectedPreview));
				done();
			});
			const req = httpMock.expectOne(AGENT_API.requestHil.path);
			expect(req.request.method).toBe(AGENT_API.requestHil.method);
			expect(req.request.body).toEqual({ agentId, executionId });
			req.flush(updatedAgentData);
		});
	});

	describe('resumeAgent (resumeHil)', () => {
		it('should POST request and update agent in agentsState', (done) => {
			const agentId = 'agent1';
			const executionId = 'exec-agent1';
			const feedback = 'Resuming HIL';
			const updatedAgentData: AgentContextApi = { ...mockFullAgent1, state: 'agent' as Static<typeof AgentContextSchema.properties.state> };

			service.resumeAgent(agentId, executionId, feedback).subscribe((response) => {
				expect(response).toEqual(updatedAgentData);
				const agentListState = service.agentsState()();
				expect(agentListState.status).toBe('success');
				const cachedPreview = agentListState.data?.find((a) => a.agentId === agentId);
				const expectedPreview: AgentContextPreview = {
					agentId: updatedAgentData.agentId,
					name: updatedAgentData.name,
					state: updatedAgentData.state,
					cost: updatedAgentData.cost,
					error: updatedAgentData.error,
					lastUpdate: updatedAgentData.lastUpdate,
					userPrompt: updatedAgentData.userPrompt,
					inputPrompt: updatedAgentData.inputPrompt,
					user: updatedAgentData.user,
				};
				expect(cachedPreview).toEqual(expectedPreview);
				done();
			});
			const req = httpMock.expectOne(AGENT_API.resumeHil.path);
			expect(req.request.method).toBe(AGENT_API.resumeHil.method);
			expect(req.request.body).toEqual({ agentId, executionId, feedback });
			req.flush(updatedAgentData);
		});
	});

	describe('cancelAgent', () => {
		it('should POST request and update agent in agentsState', (done) => {
			const agentId = 'agent1';
			const executionId = 'exec-agent1';
			const reason = 'User cancelled';
			const updatedAgentData: AgentContextApi = {
				...mockFullAgent1,
				state: 'completed' as Static<typeof AgentContextSchema.properties.state>,
				output: 'Cancelled by user',
			};

			service.cancelAgent(agentId, executionId, reason).subscribe((response) => {
				expect(response).toEqual(updatedAgentData);
				const agentListState = service.agentsState()();
				expect(agentListState.status).toBe('success');
				const cachedPreview = agentListState.data?.find((a) => a.agentId === agentId);
				const expectedPreview: AgentContextPreview = {
					agentId: updatedAgentData.agentId,
					name: updatedAgentData.name,
					state: updatedAgentData.state,
					cost: updatedAgentData.cost,
					error: updatedAgentData.error,
					lastUpdate: updatedAgentData.lastUpdate,
					userPrompt: updatedAgentData.userPrompt,
					inputPrompt: updatedAgentData.inputPrompt,
					user: updatedAgentData.user,
				};
				expect(cachedPreview).toEqual(expectedPreview);
				done();
			});
			const req = httpMock.expectOne(AGENT_API.cancel.path);
			expect(req.request.method).toBe(AGENT_API.cancel.method);
			expect(req.request.body).toEqual({ agentId, executionId, reason });
			req.flush(updatedAgentData);
		});
	});

	describe('updateAgentFunctions', () => {
		it('should POST request and update agent in agentsState', (done) => {
			const agentId = 'agent1';
			const functions = ['NewFunction1', 'NewFunction2'];
			const updatedAgentData: AgentContextApi = { ...mockFullAgent1, functions: { functionClasses: functions } };

			service.updateAgentFunctions(agentId, functions).subscribe((response) => {
				expect(response).toEqual(updatedAgentData);
				const agentListState = service.agentsState()();
				expect(agentListState.status).toBe('success');
				const cachedPreview = agentListState.data?.find((a) => a.agentId === agentId);
				const expectedPreview: AgentContextPreview = {
					agentId: updatedAgentData.agentId,
					name: updatedAgentData.name,
					state: updatedAgentData.state,
					cost: updatedAgentData.cost,
					error: updatedAgentData.error,
					lastUpdate: updatedAgentData.lastUpdate,
					userPrompt: updatedAgentData.userPrompt,
					inputPrompt: updatedAgentData.inputPrompt,
					user: updatedAgentData.user,
				};
				expect(cachedPreview).toEqual(jasmine.objectContaining(expectedPreview));
				done();
			});
			const req = httpMock.expectOne(AGENT_API.updateFunctions.path);
			expect(req.request.method).toBe(AGENT_API.updateFunctions.method);
			expect(req.request.body).toEqual({ agentId, functions });
			req.flush(updatedAgentData);
		});
	});

	describe('deleteAgents', () => {
		it('should POST agentIds and remove them from agentsState', (done) => {
			const agentIdsToDelete = [mockPreviewAgent1.agentId];
			service.deleteAgents(agentIdsToDelete).subscribe(() => {
				const agentListState = service.agentsState()();
				expect(agentListState.status).toBe('success');
				expect(agentListState.data?.length).toBe(1);
				expect(agentListState.data?.[0].agentId).toBe(mockPreviewAgent2.agentId);
				expect(agentListState.data?.find((a) => a.agentId === mockPreviewAgent1.agentId)).toBeUndefined();
				done();
			});
			const req = httpMock.expectOne(AGENT_API.delete.path);
			expect(req.request.method).toBe(AGENT_API.delete.method);
			expect(req.request.body).toEqual({ agentIds: agentIdsToDelete });
			req.flush(null, { status: 204, statusText: 'No Content' });
		});
	});

	describe('resumeError', () => {
		it('should POST request and update agent in agentsState', (done) => {
			const agentId = 'agent1';
			const executionId = 'exec-agent1';
			const feedback = 'Attempting to fix error';
			const updatedAgentData: AgentContextApi = { ...mockFullAgent1, state: 'agent' as Static<typeof AgentContextSchema.properties.state>, error: undefined };

			service.resumeError(agentId, executionId, feedback).subscribe((response) => {
				expect(response).toEqual(updatedAgentData);
				const agentListState = service.agentsState()();
				expect(agentListState.status).toBe('success');
				const cachedPreview = agentListState.data?.find((a) => a.agentId === agentId);
				const expectedPreview: AgentContextPreview = {
					agentId: updatedAgentData.agentId,
					name: updatedAgentData.name,
					state: updatedAgentData.state,
					cost: updatedAgentData.cost,
					error: updatedAgentData.error,
					lastUpdate: updatedAgentData.lastUpdate,
					userPrompt: updatedAgentData.userPrompt,
					inputPrompt: updatedAgentData.inputPrompt,
					user: updatedAgentData.user,
				};
				expect(cachedPreview).toEqual(expectedPreview);
				done();
			});
			const req = httpMock.expectOne(AGENT_API.resumeError.path);
			expect(req.request.method).toBe(AGENT_API.resumeError.method);
			expect(req.request.body).toEqual({ agentId, executionId, feedback });
			req.flush(updatedAgentData);
		});
	});

	describe('resumeCompletedAgent', () => {
		it('should POST request and update agent in agentsState', (done) => {
			const agentId = 'agent1';
			const executionId = 'exec-agent1';
			const instructions = 'Continue with new task';
			const updatedAgentData: AgentContextApi = {
				...mockFullAgent1,
				state: 'agent' as Static<typeof AgentContextSchema.properties.state>,
				userPrompt: instructions,
			};

			service.resumeCompletedAgent(agentId, executionId, instructions).subscribe((response) => {
				expect(response).toEqual(updatedAgentData);
				const agentListState = service.agentsState()();
				expect(agentListState.status).toBe('success');
				const cachedPreview = agentListState.data?.find((a) => a.agentId === agentId);
				const expectedPreview: AgentContextPreview = {
					agentId: updatedAgentData.agentId,
					name: updatedAgentData.name,
					state: updatedAgentData.state,
					cost: updatedAgentData.cost,
					error: updatedAgentData.error,
					lastUpdate: updatedAgentData.lastUpdate,
					userPrompt: updatedAgentData.userPrompt,
					inputPrompt: updatedAgentData.inputPrompt,
					user: updatedAgentData.user,
				};
				expect(cachedPreview).toEqual(expectedPreview);
				done();
			});
			const req = httpMock.expectOne(AGENT_API.resumeCompleted.path);
			expect(req.request.method).toBe(AGENT_API.resumeCompleted.method);
			expect(req.request.body).toEqual({ agentId, executionId, instructions });
			req.flush(updatedAgentData);
		});
	});

	describe('forceStopAgent', () => {
		it('should POST request and NOT update agentsState directly (caller should refresh)', (done) => {
			const agentId = 'agent1';
			const initialAgentsStateValue = service.agentsState()();

			service.forceStopAgent(agentId).subscribe(() => {
				const finalAgentsStateValue = service.agentsState()();
				expect(finalAgentsStateValue.data).toEqual(initialAgentsStateValue.data);
				expect(finalAgentsStateValue.status).toEqual(initialAgentsStateValue.status);
				done();
			});
			const req = httpMock.expectOne(AGENT_API.forceStop.path);
			expect(req.request.method).toBe(AGENT_API.forceStop.method);
			expect(req.request.body).toEqual({ agentId });
			req.flush(null, { status: 200, statusText: 'OK' });
		});
	});

	describe('startAgent', () => {
		const mockStartRequest: AgentStartRequestData = {
			agentName: 'Test Agent',
			initialPrompt: 'Test prompt',
			type: 'autonomous',
			subtype: 'codegen',
			functions: ['FileAccess'],
			humanInLoop: { budget: 10, count: 5 },
			llms: { easy: 'llm-easy-id', medium: 'llm-medium-id', hard: 'llm-hard-id' },
			useSharedRepos: true,
		};

		const mockFullAgentContextResponse: AgentContextApi = createMockAgentContext('newAgentId', 'Test Agent', 'agent');

		it('should send start request and receive full context', (done) => {
			service.startAgent(mockStartRequest).subscribe((response) => {
				expect(response).toEqual(mockFullAgentContextResponse);
				done();
			});

			const req = httpMock.expectOne(AGENT_API.start.path);
			expect(req.request.method).toBe(AGENT_API.start.method);
			expect(req.request.body).toEqual(mockStartRequest);
			req.flush(mockFullAgentContextResponse, { status: 201, statusText: 'Created' });
		});

		it('should update agentsState with preview on successful agent start', (done) => {
			const initialAgentListStateValue = service.agentsState()();
			const initialAgentCount = initialAgentListStateValue.status === 'success' && initialAgentListStateValue.data ? initialAgentListStateValue.data.length : 0;

			service.startAgent(mockStartRequest).subscribe(() => {
				const agentListStateValue = service.agentsState()();
				expect(agentListStateValue.status).toBe('success');

				const expectedPreview: AgentContextPreview = {
					agentId: mockFullAgentContextResponse.agentId,
					name: mockFullAgentContextResponse.name,
					state: mockFullAgentContextResponse.state,
					cost: mockFullAgentContextResponse.cost,
					error: mockFullAgentContextResponse.error,
					lastUpdate: mockFullAgentContextResponse.lastUpdate,
					userPrompt: mockFullAgentContextResponse.userPrompt,
					inputPrompt: mockFullAgentContextResponse.inputPrompt,
					user: mockFullAgentContextResponse.user,
				};

				const newAgentInList = agentListStateValue.data?.find((a) => a.agentId === expectedPreview.agentId);
				expect(newAgentInList).toEqual(expectedPreview);
				expect(agentListStateValue.data?.length).toBe(initialAgentCount + 1);
				done();
			});

			const req = httpMock.expectOne(AGENT_API.start.path);
			req.flush(mockFullAgentContextResponse, { status: 201, statusText: 'Created' });
		});

		it('should propagate error and log it if API call fails', (done) => {
			spyOn(console, 'error');
			const errorResponse = { status: 500, statusText: 'Server Error' };
			const errorMessage = 'Network failure';

			service.startAgent(mockStartRequest).subscribe({
				next: () => fail('should have failed'),
				error: (err) => {
					expect(err).toBeTruthy();
					expect(err.status).toBe(500); // HttpErrorResponse is passed through
					expect(console.error).toHaveBeenCalledWith(jasmine.stringMatching(/Error during startAgent/), jasmine.any(Object));
					done();
				},
			});

			const req = httpMock.expectOne(AGENT_API.start.path);
			req.flush(errorMessage, errorResponse);
		});
	});

	describe('loadAvailableFunctions / availableFunctionsState', () => {
		it('should load available functions and update availableFunctionsState', () => {
			const mockFunctions = ['FunctionA', 'Agent', 'FunctionB', 'FunctionC'];
			const expectedFunctions = ['FunctionA', 'FunctionB', 'FunctionC']; // Sorted and 'Agent' filtered out
			expect(service.availableFunctionsState()().status).toBe('idle');

			service.loadAvailableFunctions();
			expect(service.availableFunctionsState()().status).toBe('loading');

			const req = httpMock.expectOne(AGENT_API.getAvailableFunctions.path);
			expect(req.request.method).toBe(AGENT_API.getAvailableFunctions.method);
			req.flush(mockFunctions);

			const state = service.availableFunctionsState()();
			expect(state.status).toBe('success');
			expect(state.data).toEqual(expectedFunctions);
		});

		it('clearAvailableFunctions should reset availableFunctionsState to idle', () => {
			service.loadAvailableFunctions();
			const req = httpMock.expectOne(AGENT_API.getAvailableFunctions.path);
			req.flush(['FunctionA']);
			expect(service.availableFunctionsState()().status).toBe('success');

			service.clearAvailableFunctions();
			expect(service.availableFunctionsState()().status).toBe('idle');
		});
	});
});
