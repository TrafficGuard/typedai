import { ComponentFixture, TestBed, waitForAsync, fakeAsync, tick } from '@angular/core/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { ChangeDetectorRef } from '@angular/core';
import { BehaviorSubject, of, Subject } from 'rxjs';
import { tap } from 'rxjs/operators';
import { AgentListComponent } from './agent-list.component';
import { AgentService } from 'app/modules/agents/services/agent.service';
import { AgentContext, AgentType, AgentRunningState, User, AgentLLMs, LlmFunctions } from '#shared/model/agent.model';
import { FuseConfirmationService } from '@fuse/services/confirmation';
import { MatPaginatorModule } from '@angular/material/paginator';
import { MatSortModule } from '@angular/material/sort';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatIconModule } from '@angular/material/icon';
import { ReactiveFormsModule, FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';

// Helper to create a minimal valid AgentContext
const createMockAgentContext = (id: string, name: string, state: AgentRunningState): AgentContext => ({
    agentId: id,
    type: 'autonomous' as AgentType,
    subtype: 'xml',
    executionId: `exec-${id}`,
    typedAiRepoDir: '/test/repo',
    traceId: `trace-${id}`,
    name: name,
    user: { id: 'user1', name: 'Test User', email: 'test@example.com', enabled: true, createdAt: new Date(), hilBudget: 0, hilCount: 0 } as User,
    state: state,
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


class MockAgentService {
  agents$ = new BehaviorSubject<AgentContext[]>([]);
  pagination$ = new BehaviorSubject<any>({ length: 0, size: 10, page: 0, lastPage: 0, startIndex: 0, endIndex: 0 });
  
  getAgents() { return this.agents$.asObservable(); }
  refreshAgents() { 
    // Simulate async refresh that updates agents$
    // For testing, we might trigger this manually or spy on it
  }
  deleteAgents(agentIds: string[]) { 
    const currentAgents = this.agents$.getValue();
    const updatedAgents = currentAgents.filter(agent => !agentIds.includes(agent.agentId));
    this.agents$.next(updatedAgents);
    return of({}); // Simulate successful deletion
  }
}

class MockFuseConfirmationService {
  open() { return { afterClosed: () => of('confirmed') }; } // Simulate confirmation
}

describe('AgentListComponent', () => {
  let component: AgentListComponent;
  let fixture: ComponentFixture<AgentListComponent>;
  let agentService: MockAgentService;
  let confirmationService: MockFuseConfirmationService;
  let cdr: ChangeDetectorRef;

  const mockAgentsData: AgentContext[] = [
    createMockAgentContext('id1', 'Agent Alpha', 'completed'),
    createMockAgentContext('id2', 'Agent Beta', 'agent'), // Changed from 'running' to 'agent' to match component's state class logic
  ];

  beforeEach(waitForAsync(() => {
    TestBed.configureTestingModule({
      imports: [
        NoopAnimationsModule,
        MatPaginatorModule,
        MatSortModule,
        MatCheckboxModule,
        MatFormFieldModule,
        MatInputModule,
        MatIconModule,
        ReactiveFormsModule,
        FormsModule,
        RouterModule.forRoot([]), 
        AgentListComponent, 
      ],
      providers: [
        { provide: AgentService, useClass: MockAgentService },
        { provide: FuseConfirmationService, useClass: MockFuseConfirmationService },
      ],
    }).compileComponents();
  }));

  beforeEach(() => {
    fixture = TestBed.createComponent(AgentListComponent);
    component = fixture.componentInstance;
    agentService = TestBed.inject(AgentService) as unknown as MockAgentService;
    confirmationService = TestBed.inject(FuseConfirmationService) as unknown as MockFuseConfirmationService;
    cdr = fixture.debugElement.injector.get(ChangeDetectorRef);
    
    agentService.agents$.next([...mockAgentsData]); // Use a copy to avoid issues if service modifies it
    fixture.detectChanges(); 
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should display a list of agents from agents$', (done) => {
    component.agents$.subscribe(agents => {
        expect(agents.length).toBe(2);
        expect(agents[0].name).toBe('Agent Alpha');
        done();
    });
  });
  
  it('trackByFn should return agentId or index', () => {
    expect(component.trackByFn(0, mockAgentsData[0])).toBe('id1');
    const agentWithoutId = { ...mockAgentsData[0], agentId: null } as any; // Cast to any for test
    expect(component.trackByFn(1, agentWithoutId)).toBe(1);
  });

  it('refreshAgents should call agentService.refreshAgents and set isLoading', () => {
    spyOn(agentService, 'refreshAgents').and.callThrough();
    spyOn(cdr, 'markForCheck').and.callThrough();

    component.isLoading = false;
    component.refreshAgents();

    expect(component.isLoading).toBeTrue();
    expect(agentService.refreshAgents).toHaveBeenCalled();
    expect(cdr.markForCheck).toHaveBeenCalled();
  });
  
  it('deleteSelectedAgents should do nothing if no agents are selected', () => {
    spyOn(confirmationService, 'open').and.callThrough();
    component.selection.clear(); 
    component.deleteSelectedAgents();
    expect(confirmationService.open).not.toHaveBeenCalled();
  });

  it('deleteSelectedAgents should call confirmation and then agentService.deleteAgents, and update isLoading', fakeAsync(() => {
    spyOn(confirmationService, 'open').and.returnValue({ afterClosed: () => of('confirmed') });
    const deleteSpy = spyOn(agentService, 'deleteAgents').and.callThrough(); // Use callThrough to allow agents$ update
    spyOn(cdr, 'markForCheck').and.callThrough();

    component.selection.select(mockAgentsData[0]); 
    component.deleteSelectedAgents();

    expect(confirmationService.open).toHaveBeenCalled();
    expect(component.isLoading).toBeTrue(); // isLoading is set before service call
    expect(cdr.markForCheck).toHaveBeenCalledTimes(1); // For isLoading = true

    tick(); // Allow microtasks like of({}) from deleteAgents to complete
    fixture.detectChanges(); // Allow agents$ subscription in component to fire

    expect(deleteSpy).toHaveBeenCalledWith([mockAgentsData[0].agentId]);
    
    // isLoading is set to false within the agents$ subscription in ngOnInit
    // after the agent list is updated by the service.
    // We need to ensure that subscription has run.
    expect(component.isLoading).toBeFalse(); 
    expect(cdr.markForCheck).toHaveBeenCalledTimes(2); // For isLoading = false from agents$ subscription
    
    let currentAgents: AgentContext[];
    component.agents$.subscribe(ag => currentAgents = ag);
    expect(currentAgents.length).toBe(1);
    expect(currentAgents[0].agentId).toBe('id2');
    expect(component.selection.isEmpty()).toBeTrue();
  }));
  
  it('getStateClass should return correct CSS class string', () => {
    expect(component.getStateClass('completed')).toBe('state-completed');
    expect(component.getStateClass('Agent')).toBe('state-agent'); // Test with a value that might appear
    expect(component.getStateClass('ERROR')).toBe('state-error');
  });

});
