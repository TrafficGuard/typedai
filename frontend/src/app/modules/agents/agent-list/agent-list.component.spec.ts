import { CommonModule } from '@angular/common';
import { WritableSignal } from '@angular/core';
import { ComponentFixture, TestBed, fakeAsync, tick, waitForAsync } from '@angular/core/testing';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import { MatSnackBarModule } from '@angular/material/snack-bar';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { RouterTestingModule } from '@angular/router/testing';
import { FuseConfirmationService } from '@fuse/services/confirmation';
import { Observable, of } from 'rxjs';
import { AgentContextPreview, AgentRunningState, AgentType } from '#shared/agent/agent.model';
import { ApiListState, createApiListState } from '../../../core/api-state.types';
import { AgentService } from '../agent.service';
import { AgentListComponent } from './agent-list.component';
import { AgentListPo } from './agent-list.component.po';

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
	inputPrompt: '',
	createdAt: Date.now(),
	metadata: {},
	user: 'test-user-id',
	lastUpdate: Date.now(),
});

class MockAgentService {
	private _agentsStateSignal: WritableSignal<ApiListState<AgentContextPreview>>;
	readonly agentsState;

	constructor() {
		this._agentsStateSignal = createApiListState<AgentContextPreview>();
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
	}

	deleteAgents(agentIds: string[]): Observable<void> {
		const currentState = this._agentsStateSignal();
		if (currentState.status === 'success') {
			const updatedData = currentState.data.filter((agent) => !agentIds.includes(agent.agentId));
			this._agentsStateSignal.set({ status: 'success', data: updatedData });
		}
		return of(null);
	}
}

class MockFuseConfirmationService {
	open() {
		return { afterClosed: () => of('confirmed') }; // Default to confirmed for most tests
	}
}

xdescribe('AgentListComponent', () => {
	let component: AgentListComponent;
	let fixture: ComponentFixture<AgentListComponent>;
	let mockAgentService: MockAgentService;
	let mockFuseConfirmationService: MockFuseConfirmationService;
	let po: AgentListPo;

	const mockAgentsData: AgentContextPreview[] = [
		createMockAgentPreviewApi('id1', 'Agent Alpha', 'completed'),
		createMockAgentPreviewApi('id2', 'Agent Beta', 'agent'),
	];

	beforeEach(waitForAsync(() => {
		TestBed.configureTestingModule({
			imports: [AgentListComponent, NoopAnimationsModule, RouterTestingModule, MatSnackBarModule, FormsModule, ReactiveFormsModule, CommonModule],
			providers: [
				{ provide: AgentService, useClass: MockAgentService },
				{ provide: FuseConfirmationService, useClass: MockFuseConfirmationService },
			],
		}).compileComponents();
	}));

	beforeEach(async () => {
		fixture = TestBed.createComponent(AgentListComponent);
		component = fixture.componentInstance;
		mockAgentService = TestBed.inject(AgentService) as unknown as MockAgentService;
		mockFuseConfirmationService = TestBed.inject(FuseConfirmationService) as unknown as MockFuseConfirmationService;
		po = await AgentListPo.create(fixture);
		// fixture.detectChanges() is called by AgentListPo.create, triggers ngOnInit
	});

	it('should create and be in idle state initially', async () => {
		expect(component).toBeTruthy();
		expect(await po.isLoading()).toBeTrue(); // idle state also implies loading from component's computed signal
		expect(component.agentsState().status).toBe('idle');
	});

	it('should display agents when data is loaded successfully', async () => {
		// Arrange
		mockAgentService.setAgentsData([...mockAgentsData]);
		await po.detectAndWait(); // Allow signals and DOM to update

		// Assert
		expect(await po.isLoading()).toBeFalse();
		const displayedIds = await po.getDisplayedAgentIds();
		expect(displayedIds.length).toBe(2);
		expect(displayedIds).toContain('id1');
		expect(displayedIds).toContain('id2');
		expect(await po.getAgentName('id1')).toBe('Agent Alpha');
		expect(await po.getAgentState('id1')).toBe('completed'); // Assuming data-testid="agent-state-id1" shows this
	});

	it('should show "no agents" message when data is empty', async () => {
		// Arrange
		mockAgentService.setAgentsData([]);
		await po.detectAndWait();

		// Assert
		expect(await po.isLoading()).toBeFalse();
		expect(await po.getDisplayedAgentIds()).toEqual([]);
		expect(await po.getNoAgentsMessageText()).toContain('No agents found');
	});

	it('trackByFn should return agentId or index (non-PO test, component logic)', () => {
		expect(component.trackByFn(0, mockAgentsData[0])).toBe('id1');
		const agentWithoutId = { ...mockAgentsData[0], agentId: '' };
		expect(component.trackByFn(1, agentWithoutId)).toBe(1);
	});

	it('should refresh agents when refresh button is clicked', async () => {
		// Arrange
		const refreshSpy = spyOn(mockAgentService, 'refreshAgents').and.callThrough();
		mockAgentService.setAgentsData([]); // Initial empty state
		await po.detectAndWait();
		expect(await po.isLoading()).toBeFalse(); // Starts not loading

		// Act
		await po.clickRefreshButton(); // This calls detectAndWait internally

		// Assert
		expect(refreshSpy).toHaveBeenCalled();
		expect(await po.isLoading()).toBeTrue(); // Should be loading now

		// Simulate data arrival
		mockAgentService.setAgentsData([...mockAgentsData]);
		await po.detectAndWait();
		expect(await po.isLoading()).toBeFalse();
		expect((await po.getDisplayedAgentIds()).length).toBe(2);
	});

	it('should not open confirmation if no agents are selected for deletion', async () => {
		// Arrange
		const confirmOpenSpy = spyOn(mockFuseConfirmationService, 'open').and.callThrough();
		mockAgentService.setAgentsData([...mockAgentsData]);
		await po.detectAndWait();
		// Ensure nothing is selected
		expect(await po.getSelectedAgentIds()).toEqual([]);

		// Act
		await po.clickDeleteSelectedAgentsButton();

		// Assert
		expect(confirmOpenSpy).not.toHaveBeenCalled();
	});

	it('should delete selected agents after confirmation', async () => {
		// Arrange
		const confirmOpenSpy = spyOn(mockFuseConfirmationService, 'open').and.returnValue({ afterClosed: () => of('confirmed') });
		const deleteServiceSpy = spyOn(mockAgentService, 'deleteAgents').and.callThrough();
		mockAgentService.setAgentsData([...mockAgentsData]);
		await po.detectAndWait();

		await po.clickAgentRowCheckbox('id1'); // Select 'Agent Alpha'
		expect(await po.isAgentRowCheckboxChecked('id1')).toBeTrue();
		expect(await po.getSelectedAgentIds()).toEqual(['id1']);

		// Act
		await po.clickDeleteSelectedAgentsButton(); // This calls detectAndWait

		// Assert
		expect(confirmOpenSpy).toHaveBeenCalled();
		// isLoading becomes true due to service call initiation logic in component, then false after completion.
		// The PO's isLoading checks the DOM state which reflects the component's computed signal.
		// The mock service updates the state synchronously, so the loading state might be brief.
		// We'll check the end state.
		expect(deleteServiceSpy).toHaveBeenCalledWith(['id1']);
		await po.detectAndWait(); // Ensure DOM updates after delete

		expect(await po.isLoading()).toBeFalse();
		const displayedIds = await po.getDisplayedAgentIds();
		expect(displayedIds.length).toBe(1);
		expect(displayedIds[0]).toBe('id2');
		expect(await po.getSelectedAgentIds()).toEqual([]); // Selection should be cleared
	});

	it('should not delete agents if confirmation is cancelled', async () => {
		// Arrange
		const confirmOpenSpy = spyOn(mockFuseConfirmationService, 'open').and.returnValue({ afterClosed: () => of('cancelled') });
		const deleteServiceSpy = spyOn(mockAgentService, 'deleteAgents').and.callThrough();
		mockAgentService.setAgentsData([...mockAgentsData]);
		await po.detectAndWait();
		await po.clickAgentRowCheckbox('id1');

		// Act
		await po.clickDeleteSelectedAgentsButton();

		// Assert
		expect(confirmOpenSpy).toHaveBeenCalled();
		expect(deleteServiceSpy).not.toHaveBeenCalled();
		expect((await po.getDisplayedAgentIds()).length).toBe(2); // No change in displayed agents
		expect(await po.isAgentRowCheckboxChecked('id1')).toBeTrue(); // Still selected
	});

	it('getStateClass should return correct CSS class string (non-PO test, component logic)', () => {
		expect(component.getStateClass('completed')).toBe('state-completed');
		expect(component.getStateClass('Agent')).toBe('state-agent'); // Note: case sensitivity from spec
		expect(component.getStateClass('ERROR')).toBe('state-error');
	});

	it('master toggle should select all agents if none or some are selected', async () => {
		// Arrange
		mockAgentService.setAgentsData([...mockAgentsData]);
		await po.detectAndWait();
		expect(await po.isMasterToggleChecked()).toBeFalse();
		expect(await po.getSelectedAgentIds()).toEqual([]);

		// Act: Select all
		await po.clickMasterToggle();

		// Assert: All selected
		expect(await po.isMasterToggleChecked()).toBeTrue();
		expect(await po.isAgentRowCheckboxChecked('id1')).toBeTrue();
		expect(await po.isAgentRowCheckboxChecked('id2')).toBeTrue();
		expect((await po.getSelectedAgentIds()).length).toBe(2);
	});

	it('master toggle should clear selection if all agents are selected', async () => {
		// Arrange: Select all initially
		mockAgentService.setAgentsData([...mockAgentsData]);
		await po.detectAndWait();
		await po.clickMasterToggle(); // Selects all
		expect(await po.isMasterToggleChecked()).toBeTrue();

		// Act: Click master toggle again to clear selection
		await po.clickMasterToggle();

		// Assert: None selected
		expect(await po.isMasterToggleChecked()).toBeFalse();
		expect(await po.isAgentRowCheckboxChecked('id1')).toBeFalse();
		expect(await po.isAgentRowCheckboxChecked('id2')).toBeFalse();
		expect(await po.getSelectedAgentIds()).toEqual([]);
	});

	it('isAllSelected should reflect selection state (non-PO test, component logic)', async () => {
		// This test verifies the component's helper method logic.
		// Interactions are done via PO to set up state for the component method.
		mockAgentService.setAgentsData([...mockAgentsData]);
		await po.detectAndWait();

		expect(component.isAllSelected()).toBeFalse();

		// Select all using PO
		await po.clickMasterToggle();
		expect(component.isAllSelected()).toBeTrue();

		// Deselect one using PO
		await po.clickAgentRowCheckbox('id1');
		expect(component.isAllSelected()).toBeFalse();
	});

	it('should filter agents when search input changes', fakeAsync(async () => {
		// Arrange
		const refreshSpy = spyOn(mockAgentService, 'refreshAgents').and.callThrough();
		mockAgentService.setAgentsData([...mockAgentsData]); // Initial data
		await po.detectAndWait(); // Initial render
		tick(); // Clear any pending timers

		// Act
		// Use typeInSearchInputWithoutWait because we are in fakeAsync and want to control tick for debounce
		await po.typeInSearchInputWithoutWait('Agent Alpha');
		fixture.detectChanges(); // For input value change to be picked up by form control
		tick(300); // Debounce time
		await po.detectAndWait(); // For effects of refreshAgents call

		// Assert
		expect(refreshSpy).toHaveBeenCalled();
		expect(await po.isLoading()).toBeTrue(); // refreshAgents sets state to loading

		// Simulate filtered data arrival
		mockAgentService.setAgentsData([mockAgentsData[0]]); // Only Agent Alpha
		tick(); // Allow signal updates
		await po.detectAndWait(); // Allow DOM to update

		expect(await po.isLoading()).toBeFalse();
		const displayedIds = await po.getDisplayedAgentIds();
		expect(displayedIds.length).toBe(1);
		expect(displayedIds[0]).toBe('id1');
		expect(await po.getAgentName('id1')).toBe('Agent Alpha');
	}));
});
