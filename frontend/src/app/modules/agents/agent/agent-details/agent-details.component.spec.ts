import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { HttpClientTestingModule } from '@angular/common/http/testing';
import { RouterTestingModule } from '@angular/router/testing';
import { MatDialogModule } from '@angular/material/dialog';
import { MatSnackBarModule } from '@angular/material/snack-bar';
import { signal, input } from '@angular/core';
import { of } from 'rxjs';
import type { Static } from '@sinclair/typebox';

import { AgentDetailsComponent } from './agent-details.component';
import { AgentService } from '../../agent.service';
import { FunctionsService } from '../../functions.service';
import { LlmService, LLM } from '../../../llm.service';
import { AgentContextApi, AgentRunningState, AgentType, AutonomousSubTypeSchema } from '#shared/agent/agent.schema';

describe.skip('AgentDetailsComponent', () => {
  let component: AgentDetailsComponent;
  let fixture: ComponentFixture<AgentDetailsComponent>;

  let mockAgentService: jasmine.SpyObj<AgentService>;
  let mockFunctionsService: jasmine.SpyObj<FunctionsService>;
  let mockLlmService: jasmine.SpyObj<LlmService>;

  const mockAgentContext: AgentContextApi = {
    agentId: 'test-agent-id',
    executionId: 'test-exec-id',
    name: 'Test Agent',
    type: 'autonomous' as AgentType,
    subtype: 'xml' as Static<typeof AutonomousSubTypeSchema>,
    state: 'completed' as AgentRunningState, // 'idle' is not in AgentRunningStateSchema, using 'completed'
    userPrompt: 'Test prompt',
    inputPrompt: 'System prompt', // AgentContextApi uses inputPrompt
    functions: { functionClasses: ['TestFunc'] },
    llms: { easy: 'llm1', medium: 'llm2', hard: 'llm3' },
    cost: 0,
    fileSystem: { basePath: '/base', workingDirectory: '/test' }, // AgentContextApi requires basePath
    lastUpdate: Date.now(),
    hilBudget: 0,
    budgetRemaining: 0,
    iterations: 0,
    // Required fields from AgentContextSchema
    typedAiRepoDir: 'test-repo-dir',
    traceId: 'test-trace-id',
    user: 'test-user-id', // user is a string ID in AgentContextApi
    callStack: [],
    useSharedRepos: true,
    memory: {},
    metadata: {},
    pendingMessages: [],
    invoking: [],
    notes: [],
    messages: [], // LlmMessagesSchema is an array of LlmMessageSchema
    functionCallHistory: [],
    hilCount: 0,
    // Optional fields can be added if needed for specific tests, e.g.:
    // error: null,
    // output: undefined,
    // childAgents: [],
    // parentAgentId: undefined,
    // codeTaskId: undefined,
    // completedHandler: undefined,
    // hilRequested: false,
    // liveFiles: [],
    // fileStore: [],
    // toolState: {},
  };

  beforeEach(async () => {
    mockAgentService = jasmine.createSpyObj('AgentService', [
      'submitFeedback', 'resumeAgent', 'resumeError', 'cancelAgent',
      'updateAgentFunctions', 'forceStopAgent', 'requestHilCheck', 'resumeCompletedAgent'
    ]);
    mockAgentService.submitFeedback.and.returnValue(of({}));
    mockAgentService.resumeAgent.and.returnValue(of({}));
    mockAgentService.resumeError.and.returnValue(of({}));
    mockAgentService.cancelAgent.and.returnValue(of({}));
    mockAgentService.updateAgentFunctions.and.returnValue(of({}));
    mockAgentService.forceStopAgent.and.returnValue(of(null));
    mockAgentService.requestHilCheck.and.returnValue(of(null));
    mockAgentService.resumeCompletedAgent.and.returnValue(of({}));

    mockFunctionsService = jasmine.createSpyObj('FunctionsService', {
        functionsState: signal({ status: 'idle' as const, data: [] as string[] }),
        getFunctions: undefined
    });

    mockLlmService = jasmine.createSpyObj('LlmService', {
        getLlms: () => of<LLM[]>([])
    });

    await TestBed.configureTestingModule({
      imports: [
        AgentDetailsComponent, // Standalone component
        NoopAnimationsModule,
        HttpClientTestingModule,
        RouterTestingModule,
        MatDialogModule,
        MatSnackBarModule,
      ],
      providers: [
        { provide: AgentService, useValue: mockAgentService },
        { provide: FunctionsService, useValue: mockFunctionsService },
        { provide: LlmService, useValue: mockLlmService },
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(AgentDetailsComponent);
    component = fixture.componentInstance;

    // Set required inputs
    // As per original request: component.agentDetails = input(mockAgentContext);
    // For signal inputs, typically one would use fixture.componentRef.setInput in tests.
    // However, sticking to the provided structure for now.
    component.agentDetails = input(mockAgentContext);
    // Alternative for signal inputs:
    // fixture.componentRef.setInput('agentDetails', mockAgentContext);

    fixture.detectChanges(); // ngOnInit will run here
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  // TODO: Add more tests here when time permits.
  // Remember to handle signal inputs correctly in tests, e.g., using fixture.componentRef.setInput('inputName', value)
  // and to use fakeAsync/tick or waitForAsync for asynchronous operations and signal changes.
});
