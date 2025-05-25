import { ComponentFixture, TestBed, fakeAsync, tick, waitForAsync } from '@angular/core/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { BehaviorSubject, of, Subject } from 'rxjs';
import { AgentListComponent } from './agent-list.component';
import { AgentService } from '../agent.service';
import { AgentRunningState, AgentType } from '#shared/model/agent.model';
import { AgentContextApi } from '#shared/schemas/agent.schema';
import { FuseConfirmationService } from '@fuse/services/confirmation';
import { RouterTestingModule } from '@angular/router/testing';
import { MatSnackBarModule } from '@angular/material/snack-bar';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import { CommonModule } from '@angular/common';

// Helper to create a minimal valid AgentContextApi
const createMockAgentContextApi = (id: string, name: string, state: AgentRunningState): AgentContextApi => ({
    agentId: id,
    type: 'autonomous' as AgentType,
    subtype: 'xml',
    executionId: `exec-${id}`,
    typedAiRepoDir: '/test/repo',
    traceId: `trace-${id}`,
    name: name,
    user: 'user1',
    state: state,
    callStack: [],
    hilBudget: 100,
    cost: 50,
    budgetRemaining: 50,
    llms: {
        easy: 'llm-easy-id',
        medium: 'llm-medium-id',
        hard: 'llm-hard-id',
        xhard: 'llm-xhard-id',
    },
    fileSystem: { basePath: '/base', workingDirectory: '/work' },
    useSharedRepos: true,
    memory: {},
    lastUpdate: Date.now(),
    metadata: {},
    functions: {
        functionClasses: ['TestFunctionClass'],
        toJSON: () => ({ functionClasses: ['TestFunctionClass'] }),
        fromJSON: function() { return this; },
        removeFunctionClass: () => {},
        getFunctionInstances: () => [],
        getFunctionInstanceMap: () => ({}),
    },
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
    private _agents$ = new BehaviorSubject<AgentContextApi[]>([]);
    agents$ = this._agents$.asObservable();

    // Method to manually push values for testing
    setAgents(agents: AgentContextApi[]) {
        this._agents$.next(agents);
    }

    refreshAgents() {
        // Simulate async refresh by pushing the current value again or a new value
        // For testing, this might be spied on, and we'd manually call setAgents.
    }

    deleteAgents(agentIds: string[]) {
        const currentAgents = this._agents$.getValue();
        const updatedAgents = currentAgents.filter(agent => !agentIds.includes(agent.agentId));
        this._agents$.next(updatedAgents);
        return of(null); // Simulate successful deletion (Observable<void> equivalent)
    }
}

class MockFuseConfirmationService {
    open() { return { afterClosed: () => of('confirmed') }; }
}

describe('AgentListComponent', () => {
    let component: AgentListComponent;
    let fixture: ComponentFixture<AgentListComponent>;
    let mockAgentService: MockAgentService;
    let mockFuseConfirmationService: MockFuseConfirmationService;

    const mockAgentsData: AgentContextApi[] = [
        createMockAgentContextApi('id1', 'Agent Alpha', 'completed'),
        createMockAgentContextApi('id2', 'Agent Beta', 'agent'),
    ];

    beforeEach(waitForAsync(() => {
        TestBed.configureTestingModule({
            imports: [
                AgentListComponent, // Import standalone component
                NoopAnimationsModule,
                RouterTestingModule,
                MatSnackBarModule,
                FormsModule,
                ReactiveFormsModule,
                CommonModule,
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
        mockAgentService = TestBed.inject(AgentService) as unknown as MockAgentService;
        mockFuseConfirmationService = TestBed.inject(FuseConfirmationService) as unknown as MockFuseConfirmationService;

        // Set initial data for the service's BehaviorSubject
        mockAgentService.setAgents([...mockAgentsData]);
        fixture.detectChanges(); // Trigger ngOnInit and initial signal setup
    });

    it('should create', () => {
        expect(component).toBeTruthy();
    });

    it('should display a list of agents from the agents signal', fakeAsync(() => {
        tick(); // Allow toSignal to process initial value
        fixture.detectChanges();
        expect(component.agents().length).toBe(2);
        expect(component.agents()[0].name).toBe('Agent Alpha');
    }));

    it('trackByFn should return agentId or index', () => {
        expect(component.trackByFn(0, mockAgentsData[0])).toBe('id1');
        const agentWithoutId = { ...mockAgentsData[0], agentId: '' };
        expect(component.trackByFn(1, agentWithoutId)).toBe(1);
    });

    it('refreshAgents should call agentService.refreshAgents and set isLoading to true', fakeAsync(() => {
        spyOn(mockAgentService, 'refreshAgents').and.callThrough();
        component.isLoading.set(false); // Ensure it's false before test

        component.refreshAgents();
        tick(); // Allow signal updates and effects

        expect(component.isLoading()).toBeTrue();
        expect(mockAgentService.refreshAgents).toHaveBeenCalled();

        // Simulate data arrival to trigger effect setting isLoading to false
        mockAgentService.setAgents([...mockAgentsData]); // Re-emit data
        tick(); // Allow effect to run
        fixture.detectChanges();
        expect(component.isLoading()).toBeFalse();
    }));


    it('deleteSelectedAgents should do nothing if no agents are selected', () => {
        spyOn(mockFuseConfirmationService, 'open').and.callThrough();
        component.selection.clear();
        component.deleteSelectedAgents();
        expect(mockFuseConfirmationService.open).not.toHaveBeenCalled();
    });

    it('deleteSelectedAgents should call confirmation, then service, and update isLoading and selection', fakeAsync(() => {
        spyOn(mockFuseConfirmationService, 'open').and.returnValue({ afterClosed: () => of('confirmed') });
        const deleteServiceSpy = spyOn(mockAgentService, 'deleteAgents').and.callThrough();

        component.selection.select(mockAgentsData[0]);
        component.isLoading.set(false);

        component.deleteSelectedAgents();
        tick(); // For afterClosed

        expect(mockFuseConfirmationService.open).toHaveBeenCalled();
        expect(component.isLoading()).toBeTrue(); // isLoading set before service call

        // deleteAgents in mock service updates the BehaviorSubject,
        // which toSignal picks up, and then the effect sets isLoading to false.
        tick(); // For service call and subsequent signal/effect processing
        fixture.detectChanges();

        expect(deleteServiceSpy).toHaveBeenCalledWith([mockAgentsData[0].agentId]);
        expect(component.isLoading()).toBeFalse(); // isLoading set by effect
        expect(component.agents().length).toBe(1);
        expect(component.agents()[0].agentId).toBe('id2');
        expect(component.selection.isEmpty()).toBeTrue();
    }));

    it('getStateClass should return correct CSS class string', () => {
        expect(component.getStateClass('completed')).toBe('state-completed');
        expect(component.getStateClass('Agent')).toBe('state-agent');
        expect(component.getStateClass('ERROR')).toBe('state-error');
    });

    it('masterToggle should select all if not all selected, or clear if all selected', fakeAsync(() => {
        mockAgentService.setAgents([...mockAgentsData]);
        tick();
        fixture.detectChanges();

        expect(component.selection.isEmpty()).toBeTrue();
        component.masterToggle(); // Should select all
        expect(component.selection.selected.length).toBe(mockAgentsData.length);

        component.masterToggle(); // Should clear selection
        expect(component.selection.isEmpty()).toBeTrue();
    }));

    it('isAllSelected should return true if all agents are selected, false otherwise', fakeAsync(() => {
        mockAgentService.setAgents([...mockAgentsData]);
        tick();
        fixture.detectChanges();

        expect(component.isAllSelected()).toBeFalse();
        component.selection.select(...mockAgentsData); // Select all
        expect(component.isAllSelected()).toBeTrue();

        component.selection.deselect(mockAgentsData[0]); // Deselect one
        expect(component.isAllSelected()).toBeFalse();
    }));

    it('searchInputControl valueChanges should trigger refresh and manage isLoading', fakeAsync(() => {
        spyOn(mockAgentService, 'refreshAgents').and.callThrough();
        component.isLoading.set(false);

        component.searchInputControl.setValue('test query');
        tick(300); // Debounce time

        expect(component.isLoading()).toBeTrue();
        expect(mockAgentService.refreshAgents).toHaveBeenCalled();

        // Simulate data arrival
        mockAgentService.setAgents([...mockAgentsData]);
        tick(); // Allow effect to run
        fixture.detectChanges();
        expect(component.isLoading()).toBeFalse();
    }));
});
