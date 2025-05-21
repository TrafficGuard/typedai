import { TestBed } from '@angular/core/testing';
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { AgentService } from './agent.service';
import { AutonomousIteration } from '#shared/model/agent.model';
import { AgentContextApi, AgentContextSchema, AgentIdParamsSchema } from '#shared/schemas/agent.schema';
import { AGENT_API } from '#shared/api/agent.api';
import { LlmCall } from "#shared/model/llmCall.model";
import { LlmMessagesSchema } from '#shared/schemas/llm.schema';
import { Static, Type } from '@sinclair/typebox';
import { ApiNullResponseSchema } from '#shared/schemas/common.schema';
import { RouteDefinition } from '#shared/api-definitions';

describe('AgentService', () => {
  let service: AgentService;
  let httpMock: HttpTestingController;

  // Helper to create a minimal valid AgentContextApi
  const createMockAgentContext = (id: string, name?: string, state?: Static<typeof AgentContextSchema.properties.state>): AgentContextApi => ({
    agentId: id,
    type: 'autonomous' as Static<typeof AgentContextSchema.properties.type>, // Ensuring type correctness
    subtype: 'xml' as Static<typeof AgentContextSchema.properties.subtype>, // Ensuring type correctness
    executionId: `exec-${id}`,
    typedAiRepoDir: '/test/repo',
    traceId: `trace-${id}`,
    name: name || `Agent ${id}`,
    user: { // Mock User object
      id: 'user1',
      name: 'Test User',
      email: 'test@example.com',
      enabled: true,
      createdAt: new Date(),
      hilBudget: 0,
      hilCount: 0,
    },
    state: state || 'completed' as Static<typeof AgentContextSchema.properties.state>, // Ensuring type correctness
    callStack: [],
    hilBudget: 100,
    cost: 50,
    budgetRemaining: 50,
    llms: { // Mock AgentLLMs
      easy: { id: 'llm-easy-id', name: 'Easy LLM', provider: 'test', model: 'easy-model', features: [] },
      medium: { id: 'llm-medium-id', name: 'Medium LLM', provider: 'test', model: 'medium-model', features: [] },
      hard: { id: 'llm-hard-id', name: 'Hard LLM', provider: 'test', model: 'hard-model', features: [] },
      xhard: { id: 'llm-xhard-id', name: 'XHard LLM', provider: 'test', model: 'xhard-model', features: [] },
    },
    fileSystem: { // Mock IFileSystemService
        basePath: '/test/fs',
        workingDirectory: '/test/fs/work',
        toJSON: () => ({ basePath: '/test/fs', workingDirectory: '/test/fs/work' }),
        // Add other methods if they are called, or use a more complete mock
    } as any, // Using 'as any' for brevity if full IFileSystemService mock is too verbose
    useSharedRepos: true,
    memory: {},
    lastUpdate: Date.now(),
    metadata: {},
    functions: { // Mock LlmFunctions
        functionClasses: ['TestFunctionClass1', 'TestFunctionClass2'],
        toJSON: () => ({ functionClasses: ['TestFunctionClass1', 'TestFunctionClass2'] }),
        // Add other methods if they are called
    } as any, // Using 'as any' for brevity
    completedHandler: { agentCompletedHandlerId: () => 'testCompletedHandlerId' } as any, // Mock AgentCompleted
    pendingMessages: [],
    iterations: 1,
    invoking: [],
    notes: [],
    userPrompt: 'Test prompt',
    inputPrompt: 'Initial input',
    messages: [] as Static<typeof LlmMessagesSchema>,
    functionCallHistory: [],
    hilCount: 0,
    // Optional fields from AgentContextSchema that might not be in every test case
    childAgents: undefined,
    parentAgentId: undefined,
    vibeSessionId: undefined,
    error: undefined,
    output: undefined,
    hilRequested: undefined,
    toolState: undefined,
    // Properties like liveFiles and fileStore are not directly on AgentContextSchema,
    // they might be part of toolState or a specific subtype's metadata.
    // For a generic mock, they are omitted unless specifically required by a test.
  });

  const mockAgent1: AgentContextApi = createMockAgentContext('agent1');
  const mockAgent2: AgentContextApi = createMockAgentContext('agent2');

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule],
      providers: [AgentService],
    });
    service = TestBed.inject(AgentService);
    httpMock = TestBed.inject(HttpTestingController);

    // Mock initial loadAgents call in constructor
    const initialLoadReq = httpMock.expectOne(AGENT_API.list.path);
    initialLoadReq.flush([mockAgent1, mockAgent2]);
  });

  afterEach(() => {
    httpMock.verify(); // Make sure that there are no outstanding requests
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('should fetch agents on initial load and expose them via agents$', (done) => {
    service.agents$.subscribe(agents => {
      if (agents && agents.length > 0) { // Wait for the initial load to complete
        expect(agents.length).toBe(2);
        expect(agents).toEqual([mockAgent1, mockAgent2]);
        done();
      }
    });
    // The initial call is handled in beforeEach, so no httpMock.expectOne here for this test.
  });

  describe('getAgentDetails', () => {
    it('should return agent details', (done) => {
      const testAgentId = 'agent1';
      const expectedPath = AGENT_API.details.buildPath({ agentId: testAgentId });

      service.getAgentDetails(testAgentId).subscribe(agent => {
        expect(agent).toEqual(mockAgent1);
        done();
      });
      const req = httpMock.expectOne(expectedPath);
      expect(req.request.method).toBe(AGENT_API.details.method);
      req.flush(mockAgent1);
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
      const testAgentId = 'agent1';
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


  it('refreshAgents should reload agents and update agents$', (done) => {
    const updatedMockAgents: AgentContextApi[] = [createMockAgentContext('agent3')];
    let callCount = 0;

    // Clear the initial subscription from beforeEach if it interferes.
    // Or, ensure this subscription runs after the initial values have been emitted.
    // For simplicity, we'll rely on the fact that BehaviorSubject emits current value.

    service.agents$.subscribe(agents => {
      callCount++;
      if (callCount === 1) { // Initial value from constructor load
        expect(agents).toEqual([mockAgent1, mockAgent2]);
      } else if (callCount === 2) { // Value after refreshAgents
        expect(agents).toEqual(updatedMockAgents);
        done();
      }
    });

    service.refreshAgents(); // This will trigger the second emission

    const req = httpMock.expectOne(AGENT_API.list.path);
    expect(req.request.method).toBe(AGENT_API.list.method);
    req.flush(updatedMockAgents);
  });

  describe('submitFeedback', () => {
    it('should POST feedback and update agent in cache', (done) => {
      const agentId = 'agent1';
      const executionId = 'exec-agent1';
      const feedback = 'Good job!';
      const updatedAgentData = { ...mockAgent1, name: 'Agent 1 Updated Feedback' };

      const executionId = 'exec-agent1';
      const feedback = 'Good job!';
      const updatedAgentData = { ...mockAgent1, name: 'Agent 1 Updated Feedback' };
      const expectedPath = AGENT_API.feedback.path;

      service.submitFeedback(agentId, executionId, feedback).subscribe(response => {
        expect(response).toEqual(updatedAgentData);
        // Check cache
        service.agents$.subscribe(agents => {
          const cached = agents.find(a => a.agentId === agentId);
          if (cached?.name === updatedAgentData.name) { // Check if update has propagated
            expect(cached).toEqual(updatedAgentData);
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
    it('should POST request and update agent in cache', (done) => {
        const agentId = 'agent1';
        const executionId = 'exec-agent1';
        const updatedAgentData = { ...mockAgent1, hilRequested: true };
        const expectedPath = AGENT_API.requestHil.path;

        service.requestHilCheck(agentId, executionId).subscribe(response => {
            expect(response).toEqual(updatedAgentData);
            service.agents$.subscribe(agents => {
                const cached = agents.find(a => a.agentId === agentId);
                if (cached?.hilRequested === updatedAgentData.hilRequested) {
                    expect(cached).toEqual(updatedAgentData);
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
    it('should POST request and update agent in cache', (done) => {
        const agentId = 'agent1';
        const executionId = 'exec-agent1';
        const feedback = "Resuming HIL";
        const updatedAgentData = { ...mockAgent1, state: 'agent' as Static<typeof AgentContextSchema.properties.state> };
        const expectedPath = AGENT_API.resumeHil.path;

        service.resumeAgent(agentId, executionId, feedback).subscribe(response => {
            expect(response).toEqual(updatedAgentData);
            service.agents$.subscribe(agents => {
                const cached = agents.find(a => a.agentId === agentId);
                if (cached?.state === updatedAgentData.state) {
                    expect(cached).toEqual(updatedAgentData);
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
    it('should POST request and update agent in cache', (done) => {
        const agentId = 'agent1';
        const executionId = 'exec-agent1';
        const reason = "User cancelled";
        const updatedAgentData = { ...mockAgent1, state: 'completed' as Static<typeof AgentContextSchema.properties.state>, output: 'Cancelled by user' };
        const expectedPath = AGENT_API.cancel.path;

        service.cancelAgent(agentId, executionId, reason).subscribe(response => {
            expect(response).toEqual(updatedAgentData);
            service.agents$.subscribe(agents => {
                const cached = agents.find(a => a.agentId === agentId);
                if (cached?.state === updatedAgentData.state) {
                    expect(cached).toEqual(updatedAgentData);
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
    it('should POST request and update agent in cache', (done) => {
        const agentId = 'agent1';
        const functions = ['NewFunction1', 'NewFunction2'];
        const updatedAgentData = { ...mockAgent1, functions: { ...mockAgent1.functions, functionClasses: functions } as any };
        const expectedPath = AGENT_API.updateFunctions.path;


        service.updateAgentFunctions(agentId, functions).subscribe(response => {
            expect(response).toEqual(updatedAgentData);
            service.agents$.subscribe(agents => {
                const cached = agents.find(a => a.agentId === agentId);
                if (cached?.functions.functionClasses.length === functions.length) {
                    expect(cached).toEqual(updatedAgentData);
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
      const agentIdsToDelete = ['agent1'];
      const expectedPath = AGENT_API.delete.path;
      service.deleteAgents(agentIdsToDelete).subscribe(() => {
        service.agents$.subscribe(agents => {
          if (agents.length === 1 && agents[0].agentId === 'agent2') { // Check if deletion propagated
            expect(agents.find(a => a.agentId === 'agent1')).toBeUndefined();
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
    it('should POST request and update agent in cache', (done) => {
        const agentId = 'agent1';
        const executionId = 'exec-agent1';
        const feedback = "Attempting to fix error";
        const updatedAgentData = { ...mockAgent1, state: 'agent' as Static<typeof AgentContextSchema.properties.state>, error: undefined };
        const expectedPath = AGENT_API.resumeError.path;

        service.resumeError(agentId, executionId, feedback).subscribe(response => {
            expect(response).toEqual(updatedAgentData);
            service.agents$.subscribe(agents => {
                const cached = agents.find(a => a.agentId === agentId);
                if (cached?.state === updatedAgentData.state && !cached.error) {
                    expect(cached).toEqual(updatedAgentData);
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
    it('should POST request and update agent in cache', (done) => {
        const agentId = 'agent1';
        const executionId = 'exec-agent1';
        const instructions = "Continue with new task";
        const updatedAgentData = { ...mockAgent1, state: 'agent' as Static<typeof AgentContextSchema.properties.state>, userPrompt: instructions };
        const expectedPath = AGENT_API.resumeCompleted.path;

        service.resumeCompletedAgent(agentId, executionId, instructions).subscribe(response => {
            expect(response).toEqual(updatedAgentData);
            service.agents$.subscribe(agents => {
                const cached = agents.find(a => a.agentId === agentId);
                if (cached?.state === updatedAgentData.state && cached.userPrompt === instructions) {
                    expect(cached).toEqual(updatedAgentData);
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

});
