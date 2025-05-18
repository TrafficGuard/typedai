import { TestBed } from '@angular/core/testing';
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { AgentService } from './agent.service';
import { AgentContext, AutonomousIteration, AgentLLMs, LlmFunctions, User, AgentType, AgentRunningState } from '#shared/model/agent.model';
import { AGENT_API } from '#shared/api/agent.api';
import {LlmCall} from "#shared/model/llmCall.model";

describe('AgentService', () => {
  let service: AgentService;
  let httpMock: HttpTestingController;

  // Helper to create a minimal valid AgentContext
  const createMockAgentContext = (id: string): AgentContext => ({
    agentId: id,
    type: 'autonomous' as AgentType,
    subtype: 'xml',
    executionId: `exec-${id}`,
    typedAiRepoDir: '/test/repo',
    traceId: `trace-${id}`,
    name: `Agent ${id}`,
    user: { id: 'user1', name: 'Test User', email: 'test@example.com', enabled: true, createdAt: new Date(), hilBudget: 0, hilCount: 0 } as User,
    state: 'completed' as AgentRunningState,
    callStack: [],
    hilBudget: 100,
    cost: 50,
    budgetRemaining: 50,
    llms: {} as AgentLLMs, 
    useSharedRepos: true,
    memory: {},
    lastUpdate: Date.now(),
    metadata: {},
    functions: {} as LlmFunctions, 
    pendingMessages: [],
    iterations: 1,
    invoking: [],
    notes: [],
    userPrompt: 'Test prompt',
    inputPrompt: 'Initial input',
    messages: [],
    functionCallHistory: [],
    hilCount: 0,
  });

  const mockAgent1: AgentContext = createMockAgentContext('agent1');
  const mockAgent2: AgentContext = createMockAgentContext('agent2');

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule],
      providers: [AgentService],
    });
    service = TestBed.inject(AgentService);
    httpMock = TestBed.inject(HttpTestingController);

    // Mock initial loadAgents call in constructor
    const req = httpMock.expectOne(AGENT_API.list.pathTemplate);
    req.flush([mockAgent1, mockAgent2]);
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
  });

  it('getAgentDetails should return agent details', (done) => {
    const testAgentId = 'agent1';
    service.getAgentDetails(testAgentId).subscribe(agent => {
      expect(agent).toEqual(mockAgent1);
      done();
    });
    const req = httpMock.expectOne(AGENT_API.details.pathTemplate.replace(':agentId', testAgentId));
    expect(req.request.method).toBe('GET');
    req.flush(mockAgent1);
  });

  it('getAgentIterations should return agent iterations', (done) => {
    const testAgentId = 'agent1';
    const mockIterations: AutonomousIteration[] = [
      { agentId: testAgentId, iteration: 1, cost: 0.1, summary: 'Iter 1', functions: [], prompt: '', images: [], expandedUserRequest: '', observationsReasoning: '', agentPlan: '', nextStepDetails: '', draftCode: '', codeReview: '', code: '', executedCode: '', functionCalls: [], memory: {}, toolState: {}, stats: { requestTime: 0, timeToFirstToken: 0, totalTime: 0, inputTokens: 0, outputTokens: 0, cost: 0, llmId: 'default-llm' } },
    ];
    service.getAgentIterations(testAgentId).subscribe(iterations => {
      expect(iterations).toEqual(mockIterations);
      done();
    });
    const req = httpMock.expectOne(AGENT_API.getIterations.pathTemplate.replace(':agentId', testAgentId));
    expect(req.request.method).toBe('GET');
    req.flush(mockIterations);
  });
  
  it('getLlmCalls should return LLM calls for an agent', (done) => {
    const testAgentId = 'agent1';
    const mockLlmCalls: LlmCall[] = [
      { id: 'call1', agentId: testAgentId, timestamp: Date.now(), provider: 'openai', model: 'gpt-4', type: 'chat', prompt: 'Hello', response: 'Hi', cost: 0.001, inputTokens: 10, outputTokens: 5, durationMs: 100 } as LlmCall,
    ];
    service.getLlmCalls(testAgentId).subscribe(calls => {
      expect(calls).toEqual(mockLlmCalls);
      done();
    });
    const req = httpMock.expectOne(`/api/llms/calls/agent/${testAgentId}`);
    expect(req.request.method).toBe('GET');
    req.flush({ data: mockLlmCalls });
  });

  it('refreshAgents should reload agents and update agents$', (done) => {
    const updatedMockAgents: AgentContext[] = [createMockAgentContext('agent3')];
    
    let callCount = 0;
    service.agents$.subscribe(agents => {
      callCount++;
      if (callCount === 1) { 
        expect(agents.length).toBe(2);
      } else if (callCount === 2) { 
        expect(agents).toEqual(updatedMockAgents);
        done();
      }
    });

    service.refreshAgents();
    const req = httpMock.expectOne(AGENT_API.list.pathTemplate);
    expect(req.request.method).toBe('GET');
    req.flush(updatedMockAgents);
  });
  
  it('submitFeedback should POST feedback and update agent in cache', (done) => {
    const agentId = 'agent1';
    const executionId = 'exec-agent1';
    const feedback = 'Good job!';
    const updatedAgent = { ...mockAgent1, name: 'Agent 1 Updated' };

    service.submitFeedback(agentId, executionId, feedback).subscribe(response => {
      expect(response).toEqual(updatedAgent);
      service.agents$.subscribe(agents => {
        const cachedAgent = agents.find(a => a.agentId === agentId);
        if (cachedAgent?.name === 'Agent 1 Updated') { // Check if update has propagated
            expect(cachedAgent?.name).toBe('Agent 1 Updated');
            done();
        }
      });
    });

    const req = httpMock.expectOne(AGENT_API.feedback.pathTemplate);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ agentId, executionId, feedback });
    req.flush(updatedAgent);
  });
  
  it('deleteAgents should POST agentIds and remove them from cache', (done) => {
    const agentIdsToDelete = ['agent1'];
    
    service.deleteAgents(agentIdsToDelete).subscribe(() => {
      service.agents$.subscribe(agents => {
        if (!agents.find(a => a.agentId === 'agent1')) { // Check if deletion has propagated
            expect(agents.find(a => a.agentId === 'agent1')).toBeUndefined();
            expect(agents.length).toBe(1); 
            done();
        }
      });
    });

    const req = httpMock.expectOne(AGENT_API.delete.pathTemplate);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ agentIds: agentIdsToDelete });
    req.flush({}); 
  });

});
