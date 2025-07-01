import { Signal, WritableSignal, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MatSnackBar } from '@angular/material/snack-bar';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { ActivatedRoute, ParamMap, convertToParamMap } from '@angular/router';
import { BehaviorSubject, of } from 'rxjs';

import { AgentContextApi } from '#shared/agent/agent.schema';
import { ApiEntityState, createApiEntityState } from '../../../core/api-state.types';
import { AgentService } from '../agent.service';
import { AgentComponent } from './agent.component';
import { AgentPo } from './agent.component.po';

// Mocks
class MockAgentService {
	private _selectedAgentDetailsStateSignal: WritableSignal<ApiEntityState<AgentContextApi>>;
	readonly selectedAgentDetailsState: Signal<ApiEntityState<AgentContextApi>>;

	constructor() {
		this._selectedAgentDetailsStateSignal = createApiEntityState<AgentContextApi>();
		this.selectedAgentDetailsState = this._selectedAgentDetailsStateSignal.asReadonly();
	}
	loadAgentDetails(agentId: string): void {
		// This method will be spied upon in tests.
	}
	clearSelectedAgentDetails(): void {
		// This method will be spied upon in tests.
	}
	setAgentDetailsState(newState: ApiEntityState<AgentContextApi>) {
		this._selectedAgentDetailsStateSignal.set(newState);
	}
}

const initialParamMap = new BehaviorSubject<ParamMap>(convertToParamMap({ id: 'test-agent-id' }));
const mockActivatedRoute = {
	paramMap: initialParamMap.asObservable(),
	snapshot: {
		paramMap: convertToParamMap({ id: 'test-agent-id' }),
	},
};

class MockMatSnackBar {
	open(message: string, action?: string, config?: any) {
		// This method will be spied upon in tests.
	}
}

xdescribe('AgentComponent', () => {
	let component: AgentComponent;
	let fixture: ComponentFixture<AgentComponent>;
	let mockAgentService: MockAgentService;
	let mockMatSnackBar: MockMatSnackBar;
	let po: AgentPo;

	beforeEach(async () => {
		mockAgentService = new MockAgentService();
		mockMatSnackBar = new MockMatSnackBar();
		// Reset BehaviorSubject for paramMap before each test if necessary, or manage its state carefully.
		// For most tests, the initial 'test-agent-id' is fine. Specific tests can alter it.
		initialParamMap.next(convertToParamMap({ id: 'test-agent-id' }));

		await TestBed.configureTestingModule({
			imports: [
				AgentComponent, // Standalone component
				NoopAnimationsModule,
			],
			providers: [
				{ provide: AgentService, useValue: mockAgentService },
				{ provide: ActivatedRoute, useValue: mockActivatedRoute },
				{ provide: MatSnackBar, useValue: mockMatSnackBar },
			],
		}).compileComponents();

		fixture = TestBed.createComponent(AgentComponent);
		component = fixture.componentInstance;
		po = await AgentPo.create(fixture); // AgentPo.create handles initial fixture.detectChanges() and whenStable()
	});

	it('should create', () => {
		expect(component).toBeTruthy();
	});

	it('should call loadAgentDetails on init if agentId is available via route params', async () => {
		const loadSpy = spyOn(mockAgentService, 'loadAgentDetails').and.callThrough();
		// Effect in constructor subscribes to paramMap. AgentPo.create calls detectChanges.
		await po.detectAndWait(); // Ensure effects related to route params run.
		expect(loadSpy).toHaveBeenCalledWith('test-agent-id');
	});

	it('should call clearSelectedAgentDetails if route param agentId becomes null', async () => {
		const loadSpy = spyOn(mockAgentService, 'loadAgentDetails').and.callThrough();
		const clearSpy = spyOn(mockAgentService, 'clearSelectedAgentDetails').and.callThrough();

		// Initial load with 'test-agent-id'
		await po.detectAndWait();
		expect(loadSpy).toHaveBeenCalledWith('test-agent-id');
		loadSpy.calls.reset(); // Reset spy for the next check

		// Simulate route change to null ID
		initialParamMap.next(convertToParamMap({ id: null }));
		await po.detectAndWait();

		expect(clearSpy).toHaveBeenCalled();
		expect(loadSpy).not.toHaveBeenCalled(); // Ensure load is not called for null ID
	});

	describe('Snackbar notifications', () => {
		it('should display a snackbar when agent details loading fails with a generic error', async () => {
			const snackBarSpy = spyOn(mockMatSnackBar, 'open');
			mockAgentService.setAgentDetailsState({ status: 'error', error: new Error('Test error') });
			await po.detectAndWait(); // Trigger change detection for the effect to run

			expect(snackBarSpy).toHaveBeenCalledWith('Error loading agent details', 'Close', { duration: 3000 });
		});

		it('should display a snackbar when agent is not found', async () => {
			const snackBarSpy = spyOn(mockMatSnackBar, 'open');
			mockAgentService.setAgentDetailsState({ status: 'not_found' });
			await po.detectAndWait();

			expect(snackBarSpy).toHaveBeenCalledWith('Agent not_found', 'Close', { duration: 3000 });
		});

		it('should display a snackbar when agent access is forbidden', async () => {
			const snackBarSpy = spyOn(mockMatSnackBar, 'open');
			mockAgentService.setAgentDetailsState({ status: 'forbidden' });
			await po.detectAndWait();

			expect(snackBarSpy).toHaveBeenCalledWith('Agent forbidden', 'Close', { duration: 3000 });
		});
	});

	describe('Tab interactions', () => {
		it('should have "Details" tab selected by default', async () => {
			await po.detectAndWait();
			const selectedLabel = await po.getSelectedTabLabel();
			expect(selectedLabel).toBe('Details');
		});

		it('should allow selecting a different tab', async () => {
			await po.detectAndWait();
			await po.selectTabByLabel('Memory');
			// po.selectTabByLabel already calls detectAndWait
			const selectedLabel = await po.getSelectedTabLabel();
			expect(selectedLabel).toBe('Memory');
		});

		it('should list all expected tabs', async () => {
			await po.detectAndWait();
			const labels = await po.getAllTabLabels();
			expect(labels).toEqual(['Details', 'Memory', 'Function Calls', 'LLM Calls', 'Iterations', 'Tool State']);
		});
	});

	describe('handleRefreshAgentDetails', () => {
		it('should call loadAgentDetails with the current agentId if agent details are successfully loaded', async () => {
			mockAgentService.setAgentDetailsState({
				status: 'success',
				data: { agentId: 'test-agent-id', name: 'Test Agent', state: 'agent', toolState: {}, functionCallHistory: [] } satisfies Partial<AgentContextApi> as AgentContextApi,
			});
			await po.detectAndWait();

			const loadSpy = spyOn(mockAgentService, 'loadAgentDetails').and.callThrough();
			component.handleRefreshAgentDetails();
			await po.detectAndWait();

			expect(loadSpy).toHaveBeenCalledWith('test-agent-id');
		});

		it('should not call loadAgentDetails if agent details are not successfully loaded (e.g., status is idle)', async () => {
			mockAgentService.setAgentDetailsState({ status: 'idle' }); // Agent not loaded
			await po.detectAndWait();

			const loadSpy = spyOn(mockAgentService, 'loadAgentDetails').and.callThrough();
			const consoleWarnSpy = spyOn(console, 'warn');
			component.handleRefreshAgentDetails();
			await po.detectAndWait();

			expect(loadSpy).not.toHaveBeenCalled();
			expect(consoleWarnSpy).toHaveBeenCalledWith('AgentComponent: refreshRequested, but no agentId found in current agentDetails.');
		});

		it('should not call loadAgentDetails if agent details status is error', async () => {
			mockAgentService.setAgentDetailsState({ status: 'error', error: new Error('some error') });
			await po.detectAndWait();

			const loadSpy = spyOn(mockAgentService, 'loadAgentDetails').and.callThrough();
			const consoleWarnSpy = spyOn(console, 'warn');
			component.handleRefreshAgentDetails();
			await po.detectAndWait();

			expect(loadSpy).not.toHaveBeenCalled();
			expect(consoleWarnSpy).toHaveBeenCalledWith('AgentComponent: refreshRequested, but no agentId found in current agentDetails.');
		});
	});

	describe('agentDetails computed signal', () => {
		it('should return null if service state is not "success"', async () => {
			mockAgentService.setAgentDetailsState({ status: 'loading' });
			await po.detectAndWait();
			expect(component.agentDetails()).toBeNull();

			mockAgentService.setAgentDetailsState({ status: 'error', error: new Error('test') });
			await po.detectAndWait();
			expect(component.agentDetails()).toBeNull();

			mockAgentService.setAgentDetailsState({ status: 'not_found' });
			await po.detectAndWait();
			expect(component.agentDetails()).toBeNull();
		});

		it('should transform data correctly when service state is "success" and agent is running', async () => {
			const mockApiData: AgentContextApi = {
				agentId: 'agent1',
				name: 'Test Agent',
				state: 'agent',
				toolState: undefined, // To test the ?? {}
				functionCallHistory: [],
				// Add other mandatory fields from AgentContextApi as needed, or cast to Partial if appropriate for the test
				hilCount: 0,
				hilBudget: 0,
				inputPrompt: 'Test prompt',
				messages: [],
				type: 'autonomous',
				subtype: '',
				executionId: '',
				typedAiRepoDir: '',
				traceId: '',
				user: '',
				functions: undefined,
				callStack: [],
				cost: 0,
				budgetRemaining: 0,
				llms: undefined,
				fileSystem: undefined,
				useSharedRepos: false,
				memory: undefined,
				lastUpdate: 0,
				metadata: undefined,
				pendingMessages: [],
				iterations: 0,
				invoking: [],
				notes: [],
				userPrompt: ''
			};
			mockAgentService.setAgentDetailsState({ status: 'success', data: mockApiData });
			await po.detectAndWait();

			const details = component.agentDetails();
			expect(details).not.toBeNull();
			expect(details?.agentId).toBe('agent1');
			expect(details?.toolState).toEqual({}); // Check toolState initialization
			expect(details?.output).toBeNull(); // Check output for non-completed state
		});

		it('should set output from error if agent state is "completed" and error exists', async () => {
			const mockApiData: Partial<AgentContextApi> = {
				// Using Partial for brevity
				agentId: 'agent1',
				name: 'Test Agent',
				state: 'completed',
				error: 'Completion Error',
			};
			mockAgentService.setAgentDetailsState({ status: 'success', data: mockApiData as AgentContextApi });
			await po.detectAndWait();
			const details = component.agentDetails();
			expect(details?.output).toBe('Completion Error');
		});

		it('should set output from last function call note if agent state is "completed", no error, and history exists', async () => {
			const mockApiData: Partial<AgentContextApi> = {
				agentId: 'agent1',
				name: 'Test Agent',
				state: 'completed',
				error: null,
				functionCallHistory: [{ function_name: 'func1', parameters: { note: 'Final Note' } }],
			};
			mockAgentService.setAgentDetailsState({ status: 'success', data: mockApiData as AgentContextApi });
			await po.detectAndWait();
			const details = component.agentDetails();
			expect(details?.output).toBe('Final Note');
		});

		it('should set output to empty string if agent state is "completed", no error, no note in last function call', async () => {
			const mockApiData: Partial<AgentContextApi> = {
				agentId: 'agent1',
				name: 'Test Agent',
				state: 'completed',
				error: null,
				functionCallHistory: [{ function_name: 'func1', parameters: {} }],
			};
			mockAgentService.setAgentDetailsState({ status: 'success', data: mockApiData as AgentContextApi });
			await po.detectAndWait();
			const details = component.agentDetails();
			expect(details?.output).toBe(''); // Falls back to empty string if note is undefined
		});

		it('should set output to empty string if agent state is "completed", no error, and no function call history', async () => {
			const mockApiData: Partial<AgentContextApi> = {
				agentId: 'agent1',
				name: 'Test Agent',
				state: 'completed',
				error: null,
				functionCallHistory: [],
			};
			mockAgentService.setAgentDetailsState({ status: 'success', data: mockApiData as AgentContextApi });
			await po.detectAndWait();
			const details = component.agentDetails();
			expect(details?.output).toBe('');
		});
	});
});
