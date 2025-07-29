import { TestbedHarnessEnvironment } from '@angular/cdk/testing/testbed'; // Required for MatExpansionPanelHarness
import { WritableSignal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MatExpansionModule } from '@angular/material/expansion'; // Required for MatExpansionPanelHarness
import { NoopAnimationsModule } from '@angular/platform-browser/animations';

import { ApiEntityState, ApiListState, createApiEntityState, createApiListState } from 'app/core/api-state.types';
import { AutonomousIteration, AutonomousIterationSummary } from '#shared/agent/agent.model';
import { FunctionCallResult } from '#shared/llm/llm.model';
import { AgentService } from '../../agent.service';
import { AgentIterationsComponent } from './agent-iterations.component';
import { AgentIterationsPo } from './agent-iterations.component.po';

xdescribe('AgentIterationsComponent', () => {
	let component: AgentIterationsComponent;
	let fixture: ComponentFixture<AgentIterationsComponent>;
	let po: AgentIterationsPo;
	let agentServiceSpy: jasmine.SpyObj<AgentService>;

	// Mock states that the component will consume from the service
	let mockAgentIterationsState: WritableSignal<ApiListState<AutonomousIterationSummary>>;
	let mockSelectedAgentIterationDetailState: WritableSignal<ApiEntityState<AutonomousIteration>>;

	const mockIterationSummary1: AutonomousIterationSummary = {
		agentId: 'test-agent',
		iteration: 1,
		summary: 'Test iteration 1 summary',
		cost: 0.01,
	};
	const mockIterationSummary2: AutonomousIterationSummary = {
		agentId: 'test-agent',
		iteration: 2,
		summary: 'Test iteration 2 summary',
		cost: 0.02,
	};
	const mockIterationDetail1: AutonomousIteration = {
		agentId: 'test-agent',
		iteration: 1,
		cost: 0.01,
		summary: 'Test iteration 1 summary',
		functions: ['TestFunction'],
		prompt: '<prompt>Test prompt for iteration 1</prompt>',
		response: 'Test response for iteration 1',
		images: [],
		expandedUserRequest: 'Expanded request',
		observationsReasoning: 'Observations and reasoning',
		agentPlan: '<plan>Test plan for iteration 1</plan>',
		nextStepDetails: 'Next step details',
		draftCode: 'print("draft")',
		codeReview: 'Looks good',
		code: 'print("final code for iteration 1")',
		executedCode: 'print("final code")',
		functionCalls: [{ function_name: 'func1', parameters: { p: 1 }, stdout: 'output1', stderr: '' }],
		memory: { key1: 'value1' },
		toolState: { tool1: { state: 'active' }, LiveFiles: ['file1.txt'] },
		stats: { requestTime: 0, timeToFirstToken: 0, totalTime: 100, inputTokens: 10, outputTokens: 20, cost: 0, llmId: 'test-model' },
	};

	beforeEach(async () => {
		mockAgentIterationsState = createApiListState<AutonomousIterationSummary>();
		mockSelectedAgentIterationDetailState = createApiEntityState<AutonomousIteration>();

		agentServiceSpy = jasmine.createSpyObj('AgentService', [
			'loadAgentIterations',
			'loadAgentIterationDetail',
			'clearAgentIterations',
			'clearSelectedAgentIterationDetail',
		]);

		// Make the spy return the mock signals for the component to read
		Object.defineProperty(agentServiceSpy, 'agentIterationsState', {
			value: mockAgentIterationsState.asReadonly(),
			writable: false,
		});
		Object.defineProperty(agentServiceSpy, 'selectedAgentIterationDetailState', {
			value: mockSelectedAgentIterationDetailState.asReadonly(),
			writable: false,
		});

		await TestBed.configureTestingModule({
			imports: [NoopAnimationsModule, AgentIterationsComponent, MatExpansionModule], // MatExpansionModule for Harness
			providers: [{ provide: AgentService, useValue: agentServiceSpy }],
		}).compileComponents();

		fixture = TestBed.createComponent(AgentIterationsComponent);
		component = fixture.componentInstance;
		po = await AgentIterationsPo.create(fixture);
	});

	it('should create', () => {
		expect(component).toBeTruthy();
		expect(po).toBeTruthy();
	});

	it('should display loading spinner initially when agentId is set and iterations are loading', async () => {
		mockAgentIterationsState.set({ status: 'loading' });
		fixture.componentRef.setInput('agentId', 'agent123');
		await po.detectAndWait(); // Ensure changes are processed after input set

		expect(await po.isOverallLoading()).toBe(true);
		expect(agentServiceSpy.loadAgentIterations).toHaveBeenCalledWith('agent123');
	});

	it('should load and display iterations when agentId input signal changes', async () => {
		const testAgentId = 'agent123';
		agentServiceSpy.loadAgentIterations.and.callFake(() => {
			mockAgentIterationsState.set({ status: 'success', data: [mockIterationSummary1, mockIterationSummary2] });
		});

		fixture.componentRef.setInput('agentId', testAgentId);
		await po.detectAndWait(); // Ensure changes are processed after input set

		expect(agentServiceSpy.loadAgentIterations).toHaveBeenCalledWith(testAgentId);
		expect(await po.getIterationCount()).toBe(2);
		const summaries = await po.getIterationPanelSummaries();
		expect(summaries.length).toBe(2);
		expect(summaries[0].summary).toContain('Test iteration 1 summary');
		expect(summaries[1].summary).toContain('Test iteration 2 summary');
		expect(await po.isOverallLoading()).toBe(false);
	});

	it('should display "no iterations" message when agentId is valid but no iterations are returned', async () => {
		const testAgentId = 'agent123';
		agentServiceSpy.loadAgentIterations.and.callFake(() => {
			mockAgentIterationsState.set({ status: 'success', data: [] });
		});

		fixture.componentRef.setInput('agentId', testAgentId);
		await po.detectAndWait(); // Ensure changes are processed after input set

		expect(await po.isNoIterationsMessageDisplayed()).toBe(true);
		expect(await po.getNoIterationsMessageText()).toContain('No iterations found');
	});

	it('should clear iterations and display "no iterations" message when agentId input signal becomes null', async () => {
		// Initial load with data
		agentServiceSpy.loadAgentIterations.and.callFake(() => {
			mockAgentIterationsState.set({ status: 'success', data: [mockIterationSummary1] });
		});
		fixture.componentRef.setInput('agentId', 'oldAgentId');
		await po.detectAndWait(); // Ensure changes are processed after input set
		expect(await po.getIterationCount()).toBe(1);

		// Set agentId to null
		agentServiceSpy.clearAgentIterations.and.callFake(() => {
			mockAgentIterationsState.set({ status: 'idle' }); // Or success with empty data
		});
		fixture.componentRef.setInput('agentId', null);
		await po.detectAndWait(); // Ensure changes are processed after input set

		expect(agentServiceSpy.clearAgentIterations).toHaveBeenCalled();
		expect(await po.getIterationCount()).toBe(0);
		// Depending on how clear works, it might go to idle then no-iterations if idle means empty
		// The component logic for agentId=null clears its local state and service state.
		// If service state becomes {status: 'success', data: []} or {status: 'idle'} which results in iterations() being empty
		expect(await po.isNoIterationsMessageDisplayed()).toBe(true);
	});

	it('should display error message when loading iterations fails', async () => {
		const testAgentId = 'agent123';
		agentServiceSpy.loadAgentIterations.and.callFake(() => {
			mockAgentIterationsState.set({ status: 'error', error: new Error('Load summary error') });
		});

		fixture.componentRef.setInput('agentId', testAgentId);
		await po.detectAndWait(); // Ensure changes are processed after input set

		expect(await po.getOverallError()).toContain('Load summary error');
	});

	it('should fetch and display iteration details when an iteration panel is expanded', async () => {
		const testAgentId = 'agent123';
		agentServiceSpy.loadAgentIterations.and.callFake(() => {
			mockAgentIterationsState.set({ status: 'success', data: [mockIterationSummary1] });
		});
		fixture.componentRef.setInput('agentId', testAgentId);
		await po.detectAndWait(); // Ensure changes are processed after input set

		agentServiceSpy.loadAgentIterationDetail.and.callFake((id, iterNum) => {
			expect(id).toBe(testAgentId);
			expect(iterNum).toBe(1);
			mockSelectedAgentIterationDetailState.set({ status: 'loading' }); // Simulate loading first
			// Simulate async loading of detail
			// setTimeout is a macrotask. fixture.whenStable() (called by po.detectAndWait()) should wait for it.
			setTimeout(() => {
				mockSelectedAgentIterationDetailState.set({ status: 'success', data: mockIterationDetail1 });
				fixture.detectChanges(); // Trigger change detection after state update
			}, 0);
		});

		await po.expandIterationPanel(1); // This calls detectAndWait internally, which should handle the setTimeout

		expect(agentServiceSpy.loadAgentIterationDetail).toHaveBeenCalledWith(testAgentId, 1);
		expect(await po.isIterationDetailLoading(1)).toBe(true); // Check loading state immediately

		// This detectAndWait ensures that the effects of the setTimeout (state change + detectChanges in mock)
		// are processed and the DOM is updated.
		await po.detectAndWait();

		expect(await po.isIterationDetailDisplayed(1)).toBe(true);
		expect(await po.getIterationPrompt(1)).toContain('Test prompt for iteration 1');
		expect(await po.getIterationPlan(1)).toContain('Test plan for iteration 1');
		expect(await po.getIterationCode(1)).toContain('final code for iteration 1');
	});

	it('should display error message if fetching iteration details fails', async () => {
		const testAgentId = 'agent123';
		agentServiceSpy.loadAgentIterations.and.callFake(() => {
			mockAgentIterationsState.set({ status: 'success', data: [mockIterationSummary1] });
		});
		fixture.componentRef.setInput('agentId', testAgentId);
		await po.detectAndWait(); // Ensure changes are processed after input set

		agentServiceSpy.loadAgentIterationDetail.and.callFake(() => {
			mockSelectedAgentIterationDetailState.set({ status: 'error', error: new Error('Detail load error') });
		});

		await po.expandIterationPanel(1); // This calls detectAndWait
		// An additional detectAndWait might be needed if the error state propagation isn't immediate
		// or if expandIterationPanel's detectAndWait doesn't fully capture the async error update.
		await po.detectAndWait();

		expect(await po.getIterationDetailError(1)).toContain('Detail load error');
	});

	it('should display error icon for function calls with errors', async () => {
		const testAgentId = 'agent123';
		const iterationDetailWithFnError: AutonomousIteration = {
			...mockIterationDetail1,
			functionCalls: [
				{ function_name: 'goodFunc', parameters: {}, stdout: 'ok', stderr: '' },
				{ function_name: 'badFunc', parameters: {}, stdout: '', stderr: 'Something went wrong' },
			],
		};

		agentServiceSpy.loadAgentIterations.and.callFake(() => {
			mockAgentIterationsState.set({ status: 'success', data: [mockIterationSummary1] });
		});
		fixture.componentRef.setInput('agentId', testAgentId);
		await po.detectAndWait(); // Ensure changes are processed after input set

		agentServiceSpy.loadAgentIterationDetail.and.callFake(() => {
			mockSelectedAgentIterationDetailState.set({ status: 'success', data: iterationDetailWithFnError });
		});

		await po.expandIterationPanel(1); // This calls detectAndWait
		// An additional detectAndWait might be needed if the state propagation isn't immediate
		await po.detectAndWait();

		expect(await po.getFunctionCallCount(1)).toBe(2);
		expect(await po.hasFunctionCallError(1, 0)).toBe(false); // goodFunc
		expect(await po.hasFunctionCallError(1, 1)).toBe(true); // badFunc
	});

	// Test for component's internal logic like trackByIteration and hasError can be kept if they are complex
	// or removed if the focus is purely on DOM interaction via PO.
	// For hasError, its effect on DOM is tested above.
	// trackByIteration is an optimization, less critical for behavior testing via PO.
});
