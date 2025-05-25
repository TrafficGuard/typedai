import { TestBed } from '@angular/core/testing';
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { AgentService, AgentStartRequestData } from './agent.service'; // Added AgentStartRequestData
import { AutonomousIteration } from '#shared/model/agent.model';
import { AgentContextApi, AgentContextSchema, AgentIdParamsSchema, AgentStartRequestSchema } from '#shared/schemas/agent.schema'; // Added AgentStartRequestSchema
import { AGENT_API } from '#shared/api/agent.api';
import { LlmCall } from "#shared/model/llmCall.model";
import { LlmMessagesSchema } from '#shared/schemas/llm.schema';
import { Static, Type } from '@sinclair/typebox';
import { ApiNullResponseSchema } from '#shared/schemas/common.schema';
import { RouteDefinition } from '#shared/api-definitions';
import { of, throwError } from 'rxjs'; // Added of, throwError

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
    llms: { // LLMs are string IDs in AgentContextApi
      easy: 'llm-easy-id',
      medium: 'llm-medium-id',
      hard: 'llm-hard-id',
      // xhard is optional
    },
    fileSystem: { // fileSystem is an object or null
        basePath: '/test/fs',
        workingDirectory: '/test/fs/work',
    },
    useSharedRepos: true,
    memory: {},
    lastUpdate: Date.now(),
    metadata: {},
    functions: { // functions is an object with functionClasses array
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
    vibeSessionId: undefined,
    error: undefined,
    output: undefined,
    hilRequested: undefined,
    toolState: undefined,
  });

  // Helper to create a minimal valid AgentContextPreviewApi
  const createMockAgentContextPreview = (id: string, name?: string, state?: Static<typeof AgentContextSchema.properties.state>): AgentContextPreviewApi => ({
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

  let mockPreviewAgent1: AgentContextPreviewApi;
  let mockPreviewAgent2: AgentContextPreviewApi;


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

  describe('loadAgents / getAgents / refreshAgents', () => {
    it('should fetch agent previews on initial load and expose them via agents$', (done) => {
      service.agents$.subscribe(agents => {
        if (agents && agents.length > 0) { // Wait for the initial load to complete
          expect(agents.length).toBe(2);
          expect(agents).toEqual([mockPreviewAgent1, mockPreviewAgent2]);
          done();
        }
      });
      // The initial call is handled in beforeEach, so no httpMock.expectOne here for this test.
    });

    it('refreshAgents should reload agents and update agents$ with previews', (done) => {
      const updatedMockPreviews: AgentContextPreviewApi[] = [createMockAgentContextPreview('agent3')];
      let callCount = 0;

      service.agents$.subscribe(agents => {
        callCount++;
        if (callCount === 1) { // Initial value from constructor load
          expect(agents).toEqual([mockPreviewAgent1, mockPreviewAgent2]);
        } else if (callCount === 2) { // Value after refreshAgents
          expect(agents).toEqual(updatedMockPreviews);
          done();
        }
      });

      service.refreshAgents();

      const req = httpMock.expectOne(AGENT_API.list.path);
      expect(req.request.method).toBe(AGENT_API.list.method);
      req.flush(updatedMockPreviews);
    });
  });


  describe('getAgentDetails', () => {
    it('should return agent details', (done) => {
      const testAgentId = 'agent1';
      const expectedPath = AGENT_API.details.buildPath({ agentId: testAgentId });

      service.getAgentDetails(testAgentId).subscribe(agent => {
        expect(agent).toEqual(mockFullAgent1); // Expecting full agent context
        done();
      });
      expect(req.request.method).toBe(AGENT_API.details.method);
      req.flush(mockFullAgent1); // Flush with full agent context
    });

    it('should handle errors', (done) => {
      const testAgentId = 'agent-error';
      const expectedPath = AGENT_API.details.buildPath({ agentId: testAgentId });

      service.getAgentDetails(testAgentId).subscribe({
        next: () => fail('should have failed'),
        error: (err) => {
          expect(err).toBeTruthy();
          done();
        }
      });
      const req = httpMock.expectOne(expectedPath);
      req.flush('Error', { status: 500, statusText: 'Server Error' });
    });
  });

  describe('getAgentIterations', () => {
    it('should return agent iterations', (done) => {
      const testAgentId = 'agent1'; // Assuming mockFullAgent1 is for agent1
      const expectedPath = AGENT_API.getIterations.buildPath({ agentId: testAgentId });
      const mockIterations: AutonomousIteration[] = [
        {
          agentId: testAgentId, iteration: 1, cost: 0.1, summary: 'Iter 1', functions: ['ClassName1'],
          prompt: 'Test prompt', images: [], expandedUserRequest: '', observationsReasoning: '', agentPlan: '',
          nextStepDetails: '', draftCode: '', codeReview: '', code: '', executedCode: '', functionCalls: [],
          memory: {}, toolState: {}, stats: { requestTime: 1, timeToFirstToken: 1, totalTime: 1, inputTokens: 1, outputTokens: 1, cost: 1, llmId: '1'}
        },
      ];
      service.getAgentIterations(testAgentId).subscribe(iterations => {
        expect(iterations).toEqual(mockIterations);
        done();
      });
      const req = httpMock.expectOne(expectedPath);
      expect(req.request.method).toBe(AGENT_API.getIterations.method);
      req.flush(mockIterations);
    });
  });

  describe('getLlmCalls', () => {
    it('should return LLM calls for an agent', (done) => {
      const testAgentId = 'agent1';
      const expectedPath = AGENT_API.getLlmCallsByAgentId.buildPath({ agentId: testAgentId });
      const mockLlmCallsData: LlmCall[] = [
        { id: 'call1', agentId: testAgentId, messages: [], settings: {}, llmId: 'llm1', requestTime: Date.now(), provider: 'openai', model: 'gpt-4', type: 'chat', prompt: 'Hello', response: 'Hi', cost: 0.001, inputTokens: 10, outputTokens: 5, durationMs: 100 } as LlmCall,
      ];
      service.getLlmCalls(testAgentId).subscribe(calls => {
        expect(calls).toEqual(mockLlmCallsData);
        done();
      });
      const req = httpMock.expectOne(expectedPath);
      expect(req.request.method).toBe(AGENT_API.getLlmCallsByAgentId.method);
      req.flush({ data: mockLlmCallsData }); // Ensure the flushed data matches the expected structure { data: ... }
    });
  });

  // This test is now covered by the 'loadAgents / getAgents / refreshAgents' describe block
  // it('refreshAgents should reload agents and update agents$', (done) => { ... });


  describe('submitFeedback', () => {
    it('should POST feedback and update agent in cache', (done) => {
      const agentId = 'agent1';
      const executionId = 'exec-agent1'; // Ensure this matches mockFullAgent1.executionId if needed
      const feedback = 'Good job!';
      const updatedAgentData: AgentContextApi = { ...mockFullAgent1, name: 'Agent 1 Updated Feedback' };
      const expectedPath = AGENT_API.feedback.path;

      service.submitFeedback(agentId, executionId, feedback).subscribe(response => {
        expect(response).toEqual(updatedAgentData);
        // Check cache for preview
        service.agents$.subscribe(agents => {
          const cachedPreview = agents.find(a => a.agentId === agentId);
          if (cachedPreview?.name === updatedAgentData.name) { // Check if update has propagated
            const expectedPreview: AgentContextPreviewApi = {
              agentId: updatedAgentData.agentId, name: updatedAgentData.name, state: updatedAgentData.state,
              cost: updatedAgentData.cost, error: updatedAgentData.error, lastUpdate: updatedAgentData.lastUpdate,
              userPrompt: updatedAgentData.userPrompt, inputPrompt: updatedAgentData.inputPrompt, user: updatedAgentData.user,
            };
            expect(cachedPreview).toEqual(expectedPreview);
            done();
          }
        });
      });

      const req = httpMock.expectOne(expectedPath);
      expect(req.request.method).toBe(AGENT_API.feedback.method);
      expect(req.request.body).toEqual({ agentId, executionId, feedback });
      req.flush(updatedAgentData);
    });
  });

  describe('requestHilCheck', () => {
    it('should POST request and update agent in cache with preview', (done) => {
        const agentId = 'agent1';
        const executionId = 'exec-agent1'; // Ensure this matches mockFullAgent1.executionId
        const updatedAgentData: AgentContextApi = { ...mockFullAgent1, hilRequested: true, state: 'hitl_feedback' }; // Example state change
        const expectedPath = AGENT_API.requestHil.path;

        service.requestHilCheck(agentId, executionId).subscribe(response => {
            expect(response).toEqual(updatedAgentData);
            service.agents$.subscribe(agents => {
                const cachedPreview = agents.find(a => a.agentId === agentId);
                if (cachedPreview?.state === updatedAgentData.state) { // Check a field that would be in preview
                    const expectedPreview: AgentContextPreviewApi = {
                        agentId: updatedAgentData.agentId, name: updatedAgentData.name, state: updatedAgentData.state,
                        cost: updatedAgentData.cost, error: updatedAgentData.error, lastUpdate: updatedAgentData.lastUpdate,
                        userPrompt: updatedAgentData.userPrompt, inputPrompt: updatedAgentData.inputPrompt, user: updatedAgentData.user,
                    };
                    expect(cachedPreview).toEqual(jasmine.objectContaining(expectedPreview)); // Use objectContaining if not all fields are in preview or for flexibility
                    done();
                }
            });
        });
        const req = httpMock.expectOne(expectedPath);
        expect(req.request.method).toBe(AGENT_API.requestHil.method);
        expect(req.request.body).toEqual({ agentId, executionId });
        req.flush(updatedAgentData);
    });
  });

  describe('resumeAgent (resumeHil)', () => {
    it('should POST request and update agent in cache with preview', (done) => {
        const agentId = 'agent1';
        const executionId = 'exec-agent1';
        const feedback = "Resuming HIL";
        const updatedAgentData: AgentContextApi = { ...mockFullAgent1, state: 'agent' as Static<typeof AgentContextSchema.properties.state> };
        const expectedPath = AGENT_API.resumeHil.path;

        service.resumeAgent(agentId, executionId, feedback).subscribe(response => {
            expect(response).toEqual(updatedAgentData);
            service.agents$.subscribe(agents => {
                const cachedPreview = agents.find(a => a.agentId === agentId);
                if (cachedPreview?.state === updatedAgentData.state) {
                     const expectedPreview: AgentContextPreviewApi = {
                        agentId: updatedAgentData.agentId, name: updatedAgentData.name, state: updatedAgentData.state,
                        cost: updatedAgentData.cost, error: updatedAgentData.error, lastUpdate: updatedAgentData.lastUpdate,
                        userPrompt: updatedAgentData.userPrompt, inputPrompt: updatedAgentData.inputPrompt, user: updatedAgentData.user,
                    };
                    expect(cachedPreview).toEqual(expectedPreview);
                    done();
                }
            });
        });
        const req = httpMock.expectOne(expectedPath);
        expect(req.request.method).toBe(AGENT_API.resumeHil.method);
        expect(req.request.body).toEqual({ agentId, executionId, feedback });
        req.flush(updatedAgentData);
    });
  });

  describe('cancelAgent', () => {
    it('should POST request and update agent in cache with preview', (done) => {
        const agentId = 'agent1';
        const executionId = 'exec-agent1';
        const reason = "User cancelled";
        const updatedAgentData: AgentContextApi = { ...mockFullAgent1, state: 'completed' as Static<typeof AgentContextSchema.properties.state>, output: 'Cancelled by user' };
        const expectedPath = AGENT_API.cancel.path;

        service.cancelAgent(agentId, executionId, reason).subscribe(response => {
            expect(response).toEqual(updatedAgentData);
            service.agents$.subscribe(agents => {
                const cachedPreview = agents.find(a => a.agentId === agentId);
                if (cachedPreview?.state === updatedAgentData.state) {
                    const expectedPreview: AgentContextPreviewApi = {
                        agentId: updatedAgentData.agentId, name: updatedAgentData.name, state: updatedAgentData.state,
                        cost: updatedAgentData.cost, error: updatedAgentData.error, lastUpdate: updatedAgentData.lastUpdate,
                        userPrompt: updatedAgentData.userPrompt, inputPrompt: updatedAgentData.inputPrompt, user: updatedAgentData.user,
                    };
                    expect(cachedPreview).toEqual(expectedPreview);
                    done();
                }
            });
        });
        const req = httpMock.expectOne(expectedPath);
        expect(req.request.method).toBe(AGENT_API.cancel.method);
        expect(req.request.body).toEqual({ agentId, executionId, reason });
        req.flush(updatedAgentData);
    });
  });

  describe('updateAgentFunctions', () => {
    it('should POST request and update agent in cache with preview', (done) => {
        const agentId = 'agent1';
        const functions = ['NewFunction1', 'NewFunction2'];
        // Ensure the functions object in updatedAgentData matches AgentContextApi structure
        const updatedAgentData: AgentContextApi = { ...mockFullAgent1, functions: { functionClasses: functions } };
        const expectedPath = AGENT_API.updateFunctions.path;

        service.updateAgentFunctions(agentId, functions).subscribe(response => {
            expect(response).toEqual(updatedAgentData);
            service.agents$.subscribe(agents => {
                const cachedPreview = agents.find(a => a.agentId === agentId);
                // For preview, we might not check functions directly unless they affect a preview field.
                // Here, we assume the update is successful and check a common field like name or state.
                if (cachedPreview && cachedPreview.agentId === agentId) { // Basic check that agent is still there
                     const expectedPreview: AgentContextPreviewApi = {
                        agentId: updatedAgentData.agentId, name: updatedAgentData.name, state: updatedAgentData.state,
                        cost: updatedAgentData.cost, error: updatedAgentData.error, lastUpdate: updatedAgentData.lastUpdate,
                        userPrompt: updatedAgentData.userPrompt, inputPrompt: updatedAgentData.inputPrompt, user: updatedAgentData.user,
                    };
                    // We expect the preview to reflect any changes that are part of the preview
                    expect(cachedPreview).toEqual(jasmine.objectContaining(expectedPreview));
                    done();
                }
            });
        });
        const req = httpMock.expectOne(expectedPath);
        expect(req.request.method).toBe(AGENT_API.updateFunctions.method);
        expect(req.request.body).toEqual({ agentId, functions });
        req.flush(updatedAgentData);
    });
  });

  describe('deleteAgents', () => {
    it('should POST agentIds and remove them from cache', (done) => {
      const agentIdsToDelete = [mockPreviewAgent1.agentId]; // Use one of the initially loaded previews
      const expectedPath = AGENT_API.delete.path;
      service.deleteAgents(agentIdsToDelete).subscribe(() => {
        service.agents$.subscribe(agents => {
          // After deleting mockPreviewAgent1, only mockPreviewAgent2 should remain from initial load
          if (agents.length === 1 && agents[0].agentId === mockPreviewAgent2.agentId) {
            expect(agents.find(a => a.agentId === mockPreviewAgent1.agentId)).toBeUndefined();
            done();
          }
        });
      });
      const req = httpMock.expectOne(expectedPath);
      expect(req.request.method).toBe(AGENT_API.delete.method);
      expect(req.request.body).toEqual({ agentIds: agentIdsToDelete });
      req.flush(null, { status: 204, statusText: 'No Content' }); // Simulate 204 response
    });
  });

  describe('resumeError', () => {
    it('should POST request and update agent in cache with preview', (done) => {
        const agentId = 'agent1';
        const executionId = 'exec-agent1';
        const feedback = "Attempting to fix error";
        const updatedAgentData: AgentContextApi = { ...mockFullAgent1, state: 'agent' as Static<typeof AgentContextSchema.properties.state>, error: undefined };
        const expectedPath = AGENT_API.resumeError.path;

        service.resumeError(agentId, executionId, feedback).subscribe(response => {
            expect(response).toEqual(updatedAgentData);
            service.agents$.subscribe(agents => {
                const cachedPreview = agents.find(a => a.agentId === agentId);
                if (cachedPreview?.state === updatedAgentData.state && !cachedPreview.error) {
                    const expectedPreview: AgentContextPreviewApi = {
                        agentId: updatedAgentData.agentId, name: updatedAgentData.name, state: updatedAgentData.state,
                        cost: updatedAgentData.cost, error: updatedAgentData.error, lastUpdate: updatedAgentData.lastUpdate,
                        userPrompt: updatedAgentData.userPrompt, inputPrompt: updatedAgentData.inputPrompt, user: updatedAgentData.user,
                    };
                    expect(cachedPreview).toEqual(expectedPreview);
                    done();
                }
            });
        });
        const req = httpMock.expectOne(expectedPath);
        expect(req.request.method).toBe(AGENT_API.resumeError.method);
        expect(req.request.body).toEqual({ agentId, executionId, feedback });
        req.flush(updatedAgentData);
    });
  });

  describe('resumeCompletedAgent', () => {
    it('should POST request and update agent in cache with preview', (done) => {
        const agentId = 'agent1';
        const executionId = 'exec-agent1';
        const instructions = "Continue with new task";
        const updatedAgentData: AgentContextApi = { ...mockFullAgent1, state: 'agent' as Static<typeof AgentContextSchema.properties.state>, userPrompt: instructions };
        const expectedPath = AGENT_API.resumeCompleted.path;

        service.resumeCompletedAgent(agentId, executionId, instructions).subscribe(response => {
            expect(response).toEqual(updatedAgentData);
            service.agents$.subscribe(agents => {
                const cachedPreview = agents.find(a => a.agentId === agentId);
                if (cachedPreview?.state === updatedAgentData.state && cachedPreview.userPrompt === instructions) {
                    const expectedPreview: AgentContextPreviewApi = {
                        agentId: updatedAgentData.agentId, name: updatedAgentData.name, state: updatedAgentData.state,
                        cost: updatedAgentData.cost, error: updatedAgentData.error, lastUpdate: updatedAgentData.lastUpdate,
                        userPrompt: updatedAgentData.userPrompt, inputPrompt: updatedAgentData.inputPrompt, user: updatedAgentData.user,
                    };
                    expect(cachedPreview).toEqual(expectedPreview);
                    done();
                }
            });
        });
        const req = httpMock.expectOne(expectedPath);
        expect(req.request.method).toBe(AGENT_API.resumeCompleted.method);
        expect(req.request.body).toEqual({ agentId, executionId, instructions });
        req.flush(updatedAgentData);
    });
  });

  describe('forceStopAgent', () => {
    it('should POST request and NOT update cache directly (caller should refresh)', (done) => {
        const agentId = 'agent1';
        const expectedPath = AGENT_API.forceStop.path;
        // Cache should not change immediately based on this call as per service note
        const initialAgents = service['_agents$'].getValue();

        service.forceStopAgent(agentId).subscribe(() => {
            // Check that cache is NOT updated by this call itself
            expect(service['_agents$'].getValue()).toEqual(initialAgents);
            done();
        });
        const req = httpMock.expectOne(expectedPath);
        expect(req.request.method).toBe(AGENT_API.forceStop.method);
        expect(req.request.body).toEqual({ agentId });
        req.flush(null, { status: 200, statusText: 'OK' }); // Simulate 200 OK with no body
    });
  });

  describe('startAgent', () => {
    const mockStartRequest: AgentStartRequestData = {
      agentName: 'Test Agent',
      initialPrompt: 'Test prompt',
      type: 'autonomous',
      subtype: 'codegen', // Optional in schema, but good to include for a thorough test
      functions: ['FileAccess'], // Optional
      humanInLoop: { budget: 10, count: 5 }, // Optional
      llms: { easy: 'llm-easy-id', medium: 'llm-medium-id', hard: 'llm-hard-id' }, // Required
      useSharedRepos: true, // Optional
      // metadata, resumeAgentId, parentAgentId, vibeSessionId are also optional
    };

    const mockFullAgentContextResponse: AgentContextApi = createMockAgentContext('newAgentId', 'Test Agent', 'agent');

    it('should send start request and receive full context', (done) => {
      service.startAgent(mockStartRequest).subscribe(response => {
        expect(response).toEqual(mockFullAgentContextResponse);
        done();
      });

      const req = httpMock.expectOne(AGENT_API.start.path);
      expect(req.request.method).toBe(AGENT_API.start.method);
      expect(req.request.body).toEqual(mockStartRequest);
      req.flush(mockFullAgentContextResponse, { status: 201, statusText: 'Created' });
    });

    it('should update agents$ with preview on successful agent start', (done) => {
      // Initial agents are mockPreviewAgent1, mockPreviewAgent2 from beforeEach
      const initialAgentCount = service['_agents$'].getValue()?.length || 0;

      service.startAgent(mockStartRequest).subscribe(() => {
        service.agents$.subscribe(agents => {
          const expectedPreview: AgentContextPreviewApi = {
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

          const newAgentInList = agents.find(a => a.agentId === expectedPreview.agentId);
          if (newAgentInList) {
            expect(newAgentInList).toEqual(expectedPreview);
            expect(agents.length).toBe(initialAgentCount + 1);
            done();
          }
        });
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
          // The error from callApiRoute is usually the HttpErrorResponse itself
          expect(err.status).toBe(500);
          expect(console.error).toHaveBeenCalledWith(jasmine.stringMatching(/Error during startAgent/), jasmine.any(Object));
          done();
        }
      });

      const req = httpMock.expectOne(AGENT_API.start.path);
      req.flush(errorMessage, errorResponse);
    });
  });
});
