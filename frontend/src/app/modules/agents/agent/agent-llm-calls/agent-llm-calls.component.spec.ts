import { WritableSignal, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MatSnackBar } from '@angular/material/snack-bar';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { Router } from '@angular/router';

import { LlmMessage } from '#shared/llm/llm.model';
import { LlmCall, LlmCallSummary } from '#shared/llmCall/llmCall.model';
import { ApiEntityState, ApiListState } from '../../../../core/api-state.types';
import { AgentService } from '../../agent.service';
import { AgentLlmCallsComponent } from './agent-llm-calls.component';
import { AgentLlmCallsPo } from './agent-llm-calls.component.po';

describe('AgentLlmCallsComponent', () => {
	let component: AgentLlmCallsComponent;
	let fixture: ComponentFixture<AgentLlmCallsComponent>;
	let po: AgentLlmCallsPo;
	let mockAgentService: jasmine.SpyObj<AgentService>;
	let mockRouter: jasmine.SpyObj<Router>;
	let mockMatSnackBar: jasmine.SpyObj<MatSnackBar>;

	let llmCallsStateSignal: WritableSignal<ApiListState<LlmCallSummary>>;
	let selectedLlmCallDetailStateSignal: WritableSignal<ApiEntityState<LlmCall>>;

	const testAgentId = 'agent-123';

	beforeEach(async () => {
		llmCallsStateSignal = signal<ApiListState<LlmCallSummary>>({ status: 'idle' });
		selectedLlmCallDetailStateSignal = signal<ApiEntityState<LlmCall>>({ status: 'idle' });

		mockAgentService = jasmine.createSpyObj('AgentService', [
			'loadLlmCalls',
			'loadLlmCallDetail',
			'clearLlmCalls',
			'clearSelectedLlmCallDetail',
			'llmCallsState', // Method that returns the signal
			'selectedLlmCallDetailState', // Method that returns the signal
		]);
		// Configure spies to return the writable signals
		(mockAgentService.llmCallsState as jasmine.Spy).and.returnValue(llmCallsStateSignal);
		(mockAgentService.selectedLlmCallDetailState as jasmine.Spy).and.returnValue(selectedLlmCallDetailStateSignal);

		mockRouter = jasmine.createSpyObj('Router', ['navigate']);
		mockMatSnackBar = jasmine.createSpyObj('MatSnackBar', ['open']);

		await TestBed.configureTestingModule({
			imports: [AgentLlmCallsComponent, NoopAnimationsModule],
			providers: [
				{ provide: AgentService, useValue: mockAgentService },
				{ provide: Router, useValue: mockRouter },
				{ provide: MatSnackBar, useValue: mockMatSnackBar },
			],
		}).compileComponents();

		fixture = TestBed.createComponent(AgentLlmCallsComponent);
		component = fixture.componentInstance;
		po = new AgentLlmCallsPo(fixture); // Use new instead of static create for consistency with BaseSpecPo constructor

		// Set input. Important to do this before first detectChanges if ngOnInit relies on it.
		fixture.componentRef.setInput('agentId', testAgentId);
		await po.detectAndWait(); // Trigger initial data binding and ngOnInit
	});

	it('should create', () => {
		expect(component).toBeTruthy();
		expect(po).toBeTruthy();
	});

	it('should load LLM calls on init if agentId is provided', async () => {
		expect(mockAgentService.loadLlmCalls).toHaveBeenCalledWith(testAgentId);
	});

	it('should display loading spinner when llmCallsState is loading', async () => {
		llmCallsStateSignal.set({ status: 'loading' });
		await po.detectAndWait();
		expect(await po.isLoading()).toBeTrue();
	});

	it('should display error message when llmCallsState is error', async () => {
		llmCallsStateSignal.set({ status: 'error', error: new Error('Failed to load') });
		await po.detectAndWait();
		expect(await po.isErrorDisplayed()).toBeTrue();
		expect(await po.getErrorMessage()).toContain('Error loading LLM calls'); // Component's internal snackbar message
		expect(mockMatSnackBar.open).toHaveBeenCalledWith('Error loading LLM calls', 'Close', { duration: 3000 });
	});

	it('should display "no LLM calls" message when llmCallsState is success with empty data', async () => {
		llmCallsStateSignal.set({ status: 'success', data: [] });
		await po.detectAndWait();
		expect(await po.isNoCallsMessageDisplayed()).toBeTrue();
	});

	describe('With LLM Call Summaries', () => {
		const mockLlmCallSummaries: LlmCallSummary[] = [
			{
				id: 'call1',
				llmId: 'model-a',
				description: 'First Call',
				promptTokens: 10,
				completionTokens: 20,
				totalTokens: 30,
				timestamp: new Date().toISOString(),
				cost: 0.01,
				latency: 1000,
			},
			{
				id: 'call2',
				llmId: 'model-b',
				description: 'Second Call',
				promptTokens: 15,
				completionTokens: 25,
				totalTokens: 40,
				timestamp: new Date().toISOString(),
				cost: 0.02,
				latency: 1500,
			},
		];

		beforeEach(async () => {
			llmCallsStateSignal.set({ status: 'success', data: mockLlmCallSummaries });
			await po.detectAndWait();
		});

		it('should display LLM call summaries in expansion panels', async () => {
			expect(await po.getLlmCallPanelCount()).toBe(mockLlmCallSummaries.length);
			const panel0 = await po.getLlmCallPanel(0);
			expect(panel0).toBeTruthy();
			// Check title/description - assuming getLlmCallPanelTitle is implemented to get header text
			// For now, we'll rely on the panel existing. A more specific check would be:
			// expect(await po.getLlmCallPanelTitle(0)).toContain(mockLlmCallSummaries[0].description);
		});

		it('should fetch and display LLM call details when a panel is expanded', async () => {
			await po.expandLlmCallPanel(0);
			expect(mockAgentService.loadLlmCallDetail).toHaveBeenCalledWith(testAgentId, mockLlmCallSummaries[0].id);

			// Simulate detail loading
			selectedLlmCallDetailStateSignal.set({ status: 'loading' });
			await po.detectAndWait(); // Update for the loading state of the detail
			expect(await po.isLlmCallDetailLoading(0)).toBeTrue();

			const mockLlmCallDetail: LlmCall = {
				...mockLlmCallSummaries[0],
				messages: [
					{ role: 'user', content: 'Hello' },
					{ role: 'assistant', content: 'Hi there!' },
				],
				settings: { temperature: 0.7 },
				responseRaw: 'Raw response',
				inputCost: 0.005,
				outputCost: 0.005,
			};
			selectedLlmCallDetailStateSignal.set({ status: 'success', data: mockLlmCallDetail });
			await po.detectAndWait();

			expect(await po.isLlmCallDetailLoading(0)).toBeFalse();
			expect(await po.getLlmCallMessageRole(0, 0)).toContain('user');
			expect(await po.getLlmCallMessageContent(0, 0)).toContain('Hello');
		});

		it('should handle error when fetching LLM call details', async () => {
			await po.expandLlmCallPanel(0);
			expect(mockAgentService.loadLlmCallDetail).toHaveBeenCalledWith(testAgentId, mockLlmCallSummaries[0].id);

			selectedLlmCallDetailStateSignal.set({ status: 'error', error: new Error('Detail fetch failed') });
			await po.detectAndWait();

			expect(await po.isLlmCallDetailErrorDisplayed(0)).toBeTrue();
			// Check for error message display within the panel if implemented
		});

		it('should navigate to Prompt Studio when "Open in Prompt Studio" button is clicked', async () => {
			const mockLlmCallDetail: LlmCall = {
				...mockLlmCallSummaries[0],
				messages: [{ role: 'user', content: 'Test prompt' } as LlmMessage],
				settings: { temperature: 0.5 },
				responseRaw: 'Test response',
				inputCost: 0.001,
				outputCost: 0.002,
			};
			// Pre-load detail for the test
			selectedLlmCallDetailStateSignal.set({ status: 'success', data: mockLlmCallDetail });
			await po.expandLlmCallPanel(0); // Ensure panel is expanded and details are "loaded"

			await po.clickPromptStudioButton(0);

			const expectedPromptData = {
				name: mockLlmCallDetail.description || `LLM Call ${mockLlmCallDetail.id}`,
				appId: mockLlmCallDetail.description || mockLlmCallDetail.id,
				messages: mockLlmCallDetail.messages,
				settings: {
					llmId: mockLlmCallDetail.llmId,
					...mockLlmCallDetail.settings,
				},
				tags: [mockLlmCallDetail.id],
			};

			expect(mockRouter.navigate).toHaveBeenCalledWith(['/ui/prompts/new'], {
				state: { llmCallData: jasmine.objectContaining(expectedPromptData) },
			});
		});

		it('should show snackbar if trying to open in Prompt Studio while details are loading', async () => {
			await po.expandLlmCallPanel(0); // This triggers loadLlmCallDetail
			selectedLlmCallDetailStateSignal.set({ status: 'loading' }); // Explicitly set to loading
			await po.detectAndWait();

			await po.clickPromptStudioButton(0); // Attempt to click while loading

			expect(mockMatSnackBar.open).toHaveBeenCalledWith('Full details are currently loading. Please wait and try again.', 'Close', { duration: 3000 });
			expect(mockRouter.navigate).not.toHaveBeenCalled();
		});

		it('should show snackbar and attempt to fetch details if trying to open in Prompt Studio and details not loaded', async () => {
			// Ensure panel is expanded but details are not yet loaded (e.g. initial state or error)
			selectedLlmCallDetailStateSignal.set({ status: 'idle' }); // Or 'error'
			await po.expandLlmCallPanel(0); // This triggers loadLlmCallDetail

			// Need to reset the spy since expandLlmCallPanel already called it
			mockAgentService.loadLlmCallDetail.calls.reset();

			await po.clickPromptStudioButton(0);

			expect(mockMatSnackBar.open).toHaveBeenCalledWith('Fetching full details for Prompt Studio. Please try again shortly.', 'Close', { duration: 3500 });
			expect(mockAgentService.loadLlmCallDetail).toHaveBeenCalledWith(testAgentId, mockLlmCallSummaries[0].id);
			expect(mockRouter.navigate).not.toHaveBeenCalled();
		});
	});

	it('should clear LLM calls and details when agentId input becomes null', async () => {
		fixture.componentRef.setInput('agentId', null);
		await po.detectAndWait();

		expect(mockAgentService.clearLlmCalls).toHaveBeenCalled();
		expect(mockAgentService.clearSelectedLlmCallDetail).toHaveBeenCalled();
		// Check if UI reflects cleared state, e.g., no panels, no-calls message if applicable
		expect(await po.getLlmCallPanelCount()).toBe(0);
	});
});
