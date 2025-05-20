import { TestBed } from '@angular/core/testing';
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { AgentService } from './agent.service';
import { AutonomousIteration, AgentType, AgentRunningState } from '#shared/model/agent.model'; // Specific model types still needed for AutonomousIteration if not fully covered by schema's static type
import { AgentContextApi, AgentContextSchema } from '#shared/schemas/agent.schema'; // Use AgentContextApi
import { AGENT_API } from '#shared/api/agent.api';
import { LlmCall } from "#shared/model/llmCall.model";
import { LlmMessagesSchema } from '#shared/schemas/llm.schema'; // For messages structure
import { Static } from '@sinclair/typebox';


describe('AgentService', () => {
  let service: AgentService;
  let httpMock: HttpTestingController;

  // Helper to create a minimal valid AgentContextApi
  const createMockAgentContext = (id: string): AgentContextApi => ({
    agentId: id,
    type: 'autonomous' as Static<typeof AgentContextSchema.properties.type>,
    subtype: 'xml' as Static<typeof AgentContextSchema.properties.subtype>,
    executionId: `exec-${id}`,
    typedAiRepoDir: '/test/repo',
    traceId: `trace-${id}`,
    name: `Agent ${id}`,
    user: 'user1', // User ID as string
    state: 'completed' as Static<typeof AgentContextSchema.properties.state>,
    callStack: [],
    hilBudget: 100,
    cost: 50,
    budgetRemaining: 50,
    llms: { // LLM IDs as strings
      easy: 'llm-easy-id',
      medium: 'llm-medium-id',
      hard: 'llm-hard-id',
      xhard: 'llm-xhard-id',
    },
    fileSystem: { // FileSystem object or null
        basePath: '/test/fs',
        workingDirectory: '/test/fs/work'
    },
    useSharedRepos: true,
    memory: {},
    lastUpdate: Date.now(),
    metadata: {},
    functions: { // Serialized LlmFunctions
        functionClasses: ['TestFunctionClass1', 'TestFunctionClass2']
    },
    completedHandler: 'testCompletedHandlerId', // Optional: string ID
    pendingMessages: [],
    iterations: 1,
    invoking: [], // Array of FunctionCallSchema compatible objects
    notes: [],
    userPrompt: 'Test prompt',
    inputPrompt: 'Initial input',
    messages: [] as Static<typeof LlmMessagesSchema>, // Array of LlmMessageSchema compatible objects
    functionCallHistory: [], // Array of FunctionCallResultSchema compatible objects
    hilCount: 0,
    // Optional fields from AgentContextSchema can be added here if needed for specific tests
    childAgents: [],
    parentAgentId: undefined,
    vibeSessionId: undefined,
    error: undefined,
    output: undefined,
    hilRequested: undefined,
    liveFiles: [],
    fileStore: [], // Array of FileMetadataSchema compatible objects
    toolState: {},
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
    const mockIterations: AutonomousIteration[] = [ // Assuming AutonomousIteration from model is compatible enough for test data
      {
        agentId: testAgentId,
        iteration: 1,
        cost: 0.1,
        summary: 'Iter 1',
        functions: ['ClassName1'], // class names
        prompt: 'Test prompt for iteration',
        images: [], // Array of ImagePartExtSchema compatible objects
        expandedUserRequest: 'Expanded user request details',
        observationsReasoning: 'Observations and reasoning',
        agentPlan: 'Detailed agent plan',
        nextStepDetails: 'Details for the next step',
        draftCode: '```typescript\nconsole.log("draft");\n```',
        codeReview: 'Code review comments',
        code: '```typescript\nconsole.log("final");\n```',
        executedCode: 'console.log("final");',
        functionCalls: [], // Array of FunctionCallResultSchema compatible objects
        memory: { key1: 'value1' },
        toolState: { toolKey: 'toolValue' },
        stats: { requestTime: 100, timeToFirstToken: 50, totalTime: 200, inputTokens: 10, outputTokens: 20, cost: 0.001, llmId: 'test-llm-iter' },
        liveFiles: ['file1.ts', 'file2.html']
      },
    ];
    service.getAgentIterations(testAgentId).subscribe(iterations => {
      expect(iterations.length).toBe(1);
      expect(iterations[0].agentId).toEqual(testAgentId);
      // Add more specific checks if necessary, e.g., iterations[0].summary
      expect(iterations).toEqual(mockIterations); // This deep equality check should still work
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
    const updatedMockAgents: AgentContextApi[] = [createMockAgentContext('agent3')];
    
    let callCount = 0;
    service.agents$.subscribe(agents => {
      callCount++;
      if (callCount === 1) { // Initial load from beforeEach
        expect(agents.length).toBe(2);
        expect(agents).toEqual([mockAgent1, mockAgent2]);
      } else if (callCount === 2) { // After refreshAgents
        expect(agents.length).toBe(1);
        expect(agents).toEqual(updatedMockAgents);
        done();
      }
    });

    service.refreshAgents(); // This will trigger the second emission
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
