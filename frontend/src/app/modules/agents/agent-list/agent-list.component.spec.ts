import { ComponentFixture, TestBed, fakeAsync, tick, waitForAsync } from '@angular/core/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { of, Observable } from 'rxjs';
import { AgentListComponent } from './agent-list.component';
import { AgentService } from '../agent.service';
import {type AgentContextPreview, AgentRunningState, AgentType} from '#shared/agent/agent.model';
import { FuseConfirmationService } from '@fuse/services/confirmation';
import { signal, WritableSignal, effect } from '@angular/core';
import { RouterTestingModule } from '@angular/router/testing';
import { MatSnackBarModule } from '@angular/material/snack-bar';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import { CommonModule } from '@angular/common';
import {ApiListState, createApiListState} from "../../../core/api-state.types";

// Helper to create a minimal valid AgentContextPreview
const createMockAgentPreviewApi = (id: string, name: string, state: AgentRunningState): AgentContextPreview => ({
    agentId: id,
    name: name,
    state: state,
    type: 'autonomous' as AgentType,
    userPrompt: `Test prompt for ${name}`,
    cost: 10.0,
    error: state === 'error' ? 'Simulated error' : undefined,
    subtype: '',
    user: '',
    inputPrompt: '',
    lastUpdate: Date.now()

    // subtype: 'xml', // Add if part of AgentContextPreview and used
    // lastUpdate: Date.now(), // Add if part of AgentContextPreview and used
});

class MockAgentService {
    private _agentsStateSignal: WritableSignal<ApiListState<AgentContextPreview>>;
    readonly agentsState;

    constructor() {
        this._agentsStateSignal = createApiListState<AgentContextPreview>(); // Initializes to { status: 'idle' }
        this.agentsState = this._agentsStateSignal.asReadonly();
    }

    setAgentsState(newState: ApiListState<AgentContextPreview>) {
        this._agentsStateSignal.set(newState);
    }

    setAgentsData(data: AgentContextPreview[]) {
        this._agentsStateSignal.set({ status: 'success', data });
    }

    refreshAgents() {
        this._agentsStateSignal.set({ status: 'loading' });
        // In a real service, an HTTP call would follow.
        // For the mock, the test will then call setAgentsData or setAgentsState to simulate response.
    }

    deleteAgents(agentIds: string[]): Observable<void> {
        const currentState = this._agentsStateSignal();
        if (currentState.status === 'success') {
            const updatedData = currentState.data.filter(agent => !agentIds.includes(agent.agentId));
            this._agentsStateSignal.set({ status: 'success', data: updatedData });
        }
        return of(null);
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

    const mockAgentsData: AgentContextPreview[] = [
        createMockAgentPreviewApi('id1', 'Agent Alpha', 'completed'),
        createMockAgentPreviewApi('id2', 'Agent Beta', 'agent'),
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

        // Initial state is 'idle' from createApiListState, no data set yet.
        fixture.detectChanges(); // Trigger ngOnInit and initial signal setup
    });

    it('should create', () => {
        expect(component).toBeTruthy();
        expect(component.agentsState().status).toBe('idle');
    });

    it('should display agents when agentsState is success', fakeAsync(() => {
        mockAgentService.setAgentsData([...mockAgentsData]);
        tick();
        fixture.detectChanges();

        const state = component.agentsState();
        expect(state.status).toBe('success');
        if (state.status === 'success') {
            expect(state.data.length).toBe(2);
            expect(state.data[0].name).toBe('Agent Alpha');
        }
    }));

    it('trackByFn should return agentId or index', () => {
        // trackByFn operates on the data array, so mockAgentsData is fine here
        expect(component.trackByFn(0, mockAgentsData[0])).toBe('id1');
        const agentWithoutId = { ...mockAgentsData[0], agentId: '' }; // Create a version without agentId
        expect(component.trackByFn(1, agentWithoutId)).toBe(1);
    });

    it('refreshAgents should call agentService.refreshAgents and set isLoading and agentsState to loading', fakeAsync(() => {
        spyOn(mockAgentService, 'refreshAgents').and.callThrough();
        component.isLoading.set(false); // Ensure it's false
        mockAgentService.setAgentsState({ status: 'idle' }); // Start from idle
        tick();
        fixture.detectChanges();

        component.refreshAgents();
        tick(); // Allow signal updates and effects

        expect(component.isLoading()).toBeTrue();
        expect(component.agentsState().status).toBe('loading');
        expect(mockAgentService.refreshAgents).toHaveBeenCalled();

        // Simulate data arrival
        mockAgentService.setAgentsData([...mockAgentsData]);
        tick(); // Allow effect to run (component's isLoading should update)
        fixture.detectChanges();

        expect(component.isLoading()).toBeFalse();
        expect(component.agentsState().status).toBe('success');
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

        // Setup initial state with data
        mockAgentService.setAgentsData([...mockAgentsData]);
        tick();
        fixture.detectChanges();

        component.selection.select(mockAgentsData[0]);
        component.isLoading.set(false); // Ensure isLoading is false before action
        tick();

        component.deleteSelectedAgents();
        tick(); // For afterClosed promise

        expect(mockFuseConfirmationService.open).toHaveBeenCalled();
        expect(component.isLoading()).toBeTrue(); // isLoading set by component before service call

        // deleteAgents in mock service updates the signal.
        // The component's effect watching agentsState should update isLoading.
        tick(); // For service call and subsequent signal/effect processing
        fixture.detectChanges();

        expect(deleteServiceSpy).toHaveBeenCalledWith([mockAgentsData[0].agentId]);
        expect(component.isLoading()).toBeFalse(); // isLoading set by component's effect

        const state = component.agentsState();
        expect(state.status).toBe('success');
        if (state.status === 'success') {
            expect(state.data.length).toBe(1);
            expect(state.data[0].agentId).toBe('id2');
        }
        expect(component.selection.isEmpty()).toBeTrue();
    }));

    it('getStateClass should return correct CSS class string', () => {
        expect(component.getStateClass('completed')).toBe('state-completed');
        expect(component.getStateClass('Agent')).toBe('state-agent');
        expect(component.getStateClass('ERROR')).toBe('state-error');
    });

    it('masterToggle should select all if not all selected, or clear if all selected', fakeAsync(() => {
        mockAgentService.setAgentsData([...mockAgentsData]);
        tick();
        fixture.detectChanges();

        // Ensure component.agents() (derived from agentsState) is populated for selection logic
        const state = component.agentsState();
        if (state.status !== 'success') throw new Error('Agents not loaded for masterToggle test');

        expect(component.selection.isEmpty()).toBeTrue();
        component.masterToggle(); // Should select all
        expect(component.selection.selected.length).toBe(mockAgentsData.length);

        component.masterToggle(); // Should clear selection
        expect(component.selection.isEmpty()).toBeTrue();
    }));

    it('isAllSelected should return true if all agents are selected, false otherwise', fakeAsync(() => {
        mockAgentService.setAgentsData([...mockAgentsData]);
        tick();
        fixture.detectChanges();

        // Ensure component.agents() (derived from agentsState) is populated for selection logic
        const state = component.agentsState();
        if (state.status !== 'success') throw new Error('Agents not loaded for isAllSelected test');


        expect(component.isAllSelected()).toBeFalse();
        component.selection.select(...mockAgentsData); // Select all based on the mock data array
        expect(component.isAllSelected()).toBeTrue();

        component.selection.deselect(mockAgentsData[0]); // Deselect one
        expect(component.isAllSelected()).toBeFalse();
    }));

    it('searchInputControl valueChanges should trigger refresh and manage isLoading', fakeAsync(() => {
        spyOn(mockAgentService, 'refreshAgents').and.callThrough();
        component.isLoading.set(false);
        mockAgentService.setAgentsState({ status: 'idle' }); // Start from idle
        tick();
        fixture.detectChanges();

        component.searchInputControl.setValue('test query');
        tick(300); // Debounce time

        expect(component.isLoading()).toBeTrue();
        expect(component.agentsState().status).toBe('loading');
        expect(mockAgentService.refreshAgents).toHaveBeenCalled();

        // Simulate data arrival
        mockAgentService.setAgentsData([...mockAgentsData]);
        tick(); // Allow effect to run
        fixture.detectChanges();
        expect(component.isLoading()).toBeFalse();
        expect(component.agentsState().status).toBe('success');
    }));
});
