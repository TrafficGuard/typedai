import { HttpClientTestingModule } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { Router } from '@angular/router';
import { RouterTestingModule } from '@angular/router/testing';
import { Static } from '@sinclair/typebox';
import { of, throwError } from 'rxjs';
import { AgentContextApi, AutonomousSubTypeSchema } from '#shared/agent/agent.schema';
import { ApiListState } from '../../../../core/api-state.types';
import { LLM, LlmService } from '../../../llm.service';
import { AGENT_ROUTE_DEFINITIONS } from '../../agent.routes';
import { AgentService } from '../../agent.service';
import { FunctionsService } from '../../functions.service';
import { FunctionEditModalComponent } from '../function-edit-modal/function-edit-modal.component';
import { ResumeAgentModalComponent } from '../resume-agent-modal/resume-agent-modal.component';
import { AgentDetailsComponent } from './agent-details.component';
import { AgentDetailsPo } from './agent-details.component.po';
import { AgentRunningState, AgentType } from '#shared/agent/agent.model';

describe('AgentDetailsComponent', () => {
	let component: AgentDetailsComponent;
	let fixture: ComponentFixture<AgentDetailsComponent>;
	let po: AgentDetailsPo;
	let router: Router;
	let dialog: MatDialog;
	let snackBar: MatSnackBar;

	let mockAgentService: jasmine.SpyObj<AgentService>;
	let mockFunctionsService: jasmine.SpyObj<FunctionsService>;
	let mockLlmService: jasmine.SpyObj<LlmService>;

	const initialMockAgentContext: AgentContextApi = {
		agentId: 'test-agent-id',
		executionId: 'test-exec-id',
		name: 'Test Agent',
		type: 'autonomous' as AgentType,
		subtype: 'xml' as Static<typeof AutonomousSubTypeSchema>,
		state: 'completed' as AgentRunningState,
		userPrompt: 'Test user prompt',
		inputPrompt: 'Test system prompt',
		functions: { functionClasses: ['TestFunc1', 'TestFunc2'] },
		llms: { easy: 'llm1', medium: 'llm2', hard: 'llm3' },
		cost: 123.45,
		fileSystem: { basePath: '/base', workingDirectory: '/test' },
		lastUpdate: Date.now(),
		hilBudget: 10,
		budgetRemaining: 5,
		iterations: 3,
		typedAiRepoDir: 'test-repo-dir',
		traceId: 'test-trace-id',
		user: 'test-user-id',
		callStack: [],
		useSharedRepos: true,
		memory: { key: 'value' },
		metadata: { meta: 'data' },
		pendingMessages: [],
		invoking: [],
		notes: ['note1'],
		messages: [{ role: 'user', content: 'Hello' }],
		functionCallHistory: [],
		hilCount: 1,
		output: 'Test agent output',
		hilRequested: false,
	};
	let currentMockAgentContext: AgentContextApi;

	const mockLlms: LLM[] = [
		{ id: 'llm1', name: 'LLM One', isConfigured: true },
		{ id: 'llm2', name: 'LLM Two', isConfigured: true },
		{ id: 'llm3', name: 'LLM Three', isConfigured: true },
	];

	const mockAvailableFunctions = ['TestFunc1', 'TestFunc2', 'AnotherFunc'];

	beforeEach(async () => {
		currentMockAgentContext = { ...initialMockAgentContext }; // Reset context for each test

		mockAgentService = jasmine.createSpyObj('AgentService', [
			'submitFeedback',
			'resumeAgent',
			'resumeError',
			'cancelAgent',
			'updateAgentFunctions',
			'forceStopAgent',
			'requestHilCheck',
			'resumeCompletedAgent',
		]);
		mockAgentService.submitFeedback.and.returnValue(of(currentMockAgentContext));
		mockAgentService.resumeAgent.and.returnValue(of(currentMockAgentContext));
		mockAgentService.resumeError.and.returnValue(of(currentMockAgentContext));
		mockAgentService.cancelAgent.and.returnValue(of(currentMockAgentContext));
		mockAgentService.updateAgentFunctions.and.returnValue(of(currentMockAgentContext)); // Simulate returning updated agent
		mockAgentService.forceStopAgent.and.returnValue(of(null));
		mockAgentService.requestHilCheck.and.returnValue(of(null));
		mockAgentService.resumeCompletedAgent.and.returnValue(of(currentMockAgentContext));

		mockFunctionsService = jasmine.createSpyObj('FunctionsService', ['getFunctions'], {
			functionsState: signal<ApiListState<string>>({ status: 'success', data: mockAvailableFunctions }),
		});

		mockLlmService = jasmine.createSpyObj('LlmService', ['loadLlms'], {
			llmsState: signal<ApiListState<LLM>>({ status: 'success', data: mockLlms }),
		});

		await TestBed.configureTestingModule({
			imports: [AgentDetailsComponent, NoopAnimationsModule, HttpClientTestingModule, RouterTestingModule.withRoutes([]), MatDialogModule, MatSnackBarModule],
			providers: [
				{ provide: AgentService, useValue: mockAgentService },
				{ provide: FunctionsService, useValue: mockFunctionsService },
				{ provide: LlmService, useValue: mockLlmService },
			],
		}).compileComponents();

		fixture = TestBed.createComponent(AgentDetailsComponent);
		component = fixture.componentInstance;
		router = TestBed.inject(Router);
		dialog = TestBed.inject(MatDialog);
		snackBar = TestBed.inject(MatSnackBar);

		// Set required inputs using fixture.componentRef.setInput
		fixture.componentRef.setInput('agentDetails', currentMockAgentContext);

		po = await AgentDetailsPo.create(fixture); // fixture.detectChanges() and whenStable() is called in create
	});

	it('should create and display initial agent details', async () => {
		expect(component).toBeTruthy();
		expect(await po.getAgentNameText()).toBe(currentMockAgentContext.name);
		expect(await po.getAgentStateText()).toBe('Completed'); // From displayState mapping
		expect(await po.getUserPromptText()).toBe(currentMockAgentContext.userPrompt);
		expect(await po.getLlmEasyName()).toBe('LLM One');
		expect(await po.getLlmMediumName()).toBe('LLM Two');
		expect(await po.getLlmHardName()).toBe('LLM Three');
	});

	describe('Feedback Submission', () => {
		it('should submit feedback successfully and refresh details', async () => {
			const feedbackText = 'This is great!';
			spyOn(component.refreshRequested, 'emit');
			spyOn(snackBar, 'open');

			await po.typeFeedback(feedbackText);
			await po.clickSubmitFeedback();

			expect(mockAgentService.submitFeedback).toHaveBeenCalledWith(currentMockAgentContext.agentId, currentMockAgentContext.executionId, feedbackText);
			expect(await po.getFeedbackInputValue()).toBe('');
			expect(snackBar.open).toHaveBeenCalledWith('Feedback submitted successfully', 'Close', { duration: 3000 });
			expect(component.refreshRequested.emit).toHaveBeenCalled();
		});

		it('should disable submit feedback button if feedback is empty and enable when not empty', async () => {
			expect(await po.isSubmitFeedbackButtonEnabled()).toBe(false); // Initially empty due to form creation
			await po.typeFeedback('Some feedback');
			expect(await po.isSubmitFeedbackButtonEnabled()).toBe(true);
			await po.typeFeedback('');
			expect(await po.isSubmitFeedbackButtonEnabled()).toBe(false);
		});

		it('should show error snackbar if feedback submission fails', async () => {
			const feedbackText = 'This will fail';
			mockAgentService.submitFeedback.and.returnValue(throwError(() => new Error('Submission failed')));
			spyOn(snackBar, 'open');

			await po.typeFeedback(feedbackText);
			await po.clickSubmitFeedback();

			expect(snackBar.open).toHaveBeenCalledWith('Error submitting feedback', 'Close', { duration: 3000 });
		});
	});

	describe('HIL Resume', () => {
		it('should resume HIL successfully with feedback', async () => {
			currentMockAgentContext.state = 'hil';
			fixture.componentRef.setInput('agentDetails', currentMockAgentContext);
			await po.detectAndWait();

			const hilFeedback = 'Resume with this info';
			spyOn(component.refreshRequested, 'emit');
			spyOn(snackBar, 'open');

			await po.typeHilFeedback(hilFeedback);
			await po.clickResumeHil();

			expect(mockAgentService.resumeAgent).toHaveBeenCalledWith(currentMockAgentContext.agentId, currentMockAgentContext.executionId, hilFeedback);
			expect(await po.getHilFeedbackInputValue()).toBe('');
			expect(snackBar.open).toHaveBeenCalledWith('Agent resumed successfully', 'Close', { duration: 3000 });
			expect(component.refreshRequested.emit).toHaveBeenCalled();
		});
	});

	describe('Error Resume', () => {
		it('should resume from error successfully', async () => {
			currentMockAgentContext.state = 'error';
			fixture.componentRef.setInput('agentDetails', currentMockAgentContext);
			await po.detectAndWait();

			const errorDetails = 'Fixed the error, try again.';
			spyOn(component.refreshRequested, 'emit');
			spyOn(snackBar, 'open');

			await po.typeErrorDetails(errorDetails);
			await po.clickResumeError();

			expect(mockAgentService.resumeError).toHaveBeenCalledWith(currentMockAgentContext.agentId, currentMockAgentContext.executionId, errorDetails);
			expect(await po.getErrorDetailsInputValue()).toBe('');
			expect(snackBar.open).toHaveBeenCalledWith('Agent resumed successfully', 'Close', { duration: 3000 });
			expect(component.refreshRequested.emit).toHaveBeenCalled();
		});
	});

	describe('Cancel Agent', () => {
		it('should cancel agent and navigate to list', async () => {
			spyOn(router, 'navigate').and.resolveTo(true);
			spyOn(snackBar, 'open');

			await po.clickCancelAgent();

			expect(mockAgentService.cancelAgent).toHaveBeenCalledWith(currentMockAgentContext.agentId, currentMockAgentContext.executionId, 'None provided');
			expect(snackBar.open).toHaveBeenCalledWith('Agent cancelled successfully', 'Close', { duration: 3000 });
			expect(router.navigate).toHaveBeenCalledWith(AGENT_ROUTE_DEFINITIONS.nav.list());
		});
	});

	describe('Display State', () => {
		const states: Array<[AgentRunningState, string]> = [
			['agent', 'Agent control loop'],
			['functions', 'Calling functions'],
			['error', 'Error'],
			['hil', 'Human-in-the-loop check'],
			['hitl_threshold', 'Human-in-the-loop check'],
			['hitl_feedback', 'Agent requested feedback'],
			['completed', 'Completed'],
			['workflow', 'workflow'], // Default case
		];
		for (const [state, expectedDisplay] of states) {
			it(`should display '${expectedDisplay}' for state '${state}'`, async () => {
				fixture.componentRef.setInput('agentDetails', { ...currentMockAgentContext, state });
				await po.detectAndWait();
				expect(await po.getAgentStateText()).toBe(expectedDisplay);
			});
		}
	});

	describe('Agent Links', () => {
		it('should display correct trace, logs, and database URLs', async () => {
			// Assuming GoogleCloudLinks implementation for URLs
			const expectedTraceUrl = component.agentLinks.traceUrl(currentMockAgentContext);
			const expectedLogsUrl = component.agentLinks.logsUrl(currentMockAgentContext);
			const expectedDbUrl = component.agentLinks.agentDatabaseUrl(currentMockAgentContext);

			expect(await po.getTraceUrl()).toBe(expectedTraceUrl);
			expect(await po.getLogsUrl()).toBe(expectedLogsUrl);
			expect(await po.getDatabaseUrl()).toBe(expectedDbUrl);
		});
	});

	describe('Function Editing', () => {
		it('should open function edit modal with current and all available functions', async () => {
			spyOn(dialog, 'open').and.callThrough();
			await po.clickEditFunctions();

			expect(dialog.open).toHaveBeenCalledWith(
				FunctionEditModalComponent,
				jasmine.objectContaining({
					data: {
						functions: currentMockAgentContext.functions?.functionClasses,
						allFunctions: mockAvailableFunctions,
					},
				}),
			);
		});

		it('should save functions when dialog returns new selection and refresh', fakeAsync(() => {
			const selectedFunctions = ['TestFunc1', 'AnotherFunc'];
			spyOn(dialog, 'open').and.returnValue({ afterClosed: () => of(selectedFunctions) } as any);
			spyOn(component.refreshRequested, 'emit');
			spyOn(snackBar, 'open');

			po.clickEditFunctions(); // This is async due to detectAndWait
			tick(); // Allow microtasks from dialog.afterClosed().subscribe to run

			expect(mockAgentService.updateAgentFunctions).toHaveBeenCalledWith(currentMockAgentContext.agentId, selectedFunctions);
			expect(snackBar.open).toHaveBeenCalledWith('Agent functions updated successfully', 'Close', { duration: 3000 });
			expect(component.refreshRequested.emit).toHaveBeenCalled();
		}));
	});

	describe('Force Stop Agent', () => {
		it('should call forceStopAgent and refresh on success', async () => {
			spyOn(component.refreshRequested, 'emit');
			spyOn(snackBar, 'open');
			mockAgentService.forceStopAgent.and.returnValue(of({} as any)); // Simulate successful stop (non-null response)

			await po.clickForceStopAgent();

			expect(mockAgentService.forceStopAgent).toHaveBeenCalledWith(currentMockAgentContext.agentId);
			expect(snackBar.open).toHaveBeenCalledWith('Agent stop request sent successfully. Refreshing details...', 'Close', { duration: 4000 });
			expect(component.refreshRequested.emit).toHaveBeenCalled();
		});
	});

	describe('Request HIL Check', () => {
		it('should call requestHilCheck and refresh on success', async () => {
			currentMockAgentContext.state = 'agent'; // A state where HIL can be requested
			currentMockAgentContext.hilRequested = false;
			fixture.componentRef.setInput('agentDetails', currentMockAgentContext);
			await po.detectAndWait();

			spyOn(component.refreshRequested, 'emit');
			spyOn(snackBar, 'open');
			mockAgentService.requestHilCheck.and.returnValue(of({} as any)); // Simulate successful request

			await po.clickRequestHil();

			expect(mockAgentService.requestHilCheck).toHaveBeenCalledWith(currentMockAgentContext.agentId, currentMockAgentContext.executionId);
			expect(snackBar.open).toHaveBeenCalledWith('HIL check requested successfully. Refreshing...', 'Close', { duration: 4000 });
			expect(component.refreshRequested.emit).toHaveBeenCalled();
		});

		it('should enable HIL request button for allowed states and not already requested', async () => {
			const allowedStates: AgentRunningState[] = ['workflow', 'agent', 'functions', 'hitl_tool'];
			for (const state of allowedStates) {
				fixture.componentRef.setInput('agentDetails', { ...currentMockAgentContext, state, hilRequested: false });
				await po.detectAndWait();
				expect(await po.isRequestHilButtonEnabled())
					.withContext(`State: ${state}`)
					.toBe(true);
			}
		});

		it('should disable HIL request button if already requested', async () => {
			fixture.componentRef.setInput('agentDetails', { ...currentMockAgentContext, state: 'agent', hilRequested: true });
			await po.detectAndWait();
			expect(await po.isRequestHilButtonEnabled()).toBe(false);
		});

		it('should disable HIL request button for disallowed states', async () => {
			const disallowedStates: AgentRunningState[] = ['completed', 'error', 'hil'];
			for (const state of disallowedStates) {
				fixture.componentRef.setInput('agentDetails', { ...currentMockAgentContext, state, hilRequested: false });
				await po.detectAndWait();
				expect(await po.isRequestHilButtonEnabled())
					.withContext(`State: ${state}`)
					.toBe(false);
			}
		});
	});

	describe('Resume Completed Agent', () => {
		it('should open resume modal and call resumeCompletedAgent on dialog close', fakeAsync(() => {
			currentMockAgentContext.state = 'completed';
			fixture.componentRef.setInput('agentDetails', currentMockAgentContext);
			po.detectAndWait(); // Ensure component updates with new state

			const resumeInstructions = 'Continue with these new instructions.';
			spyOn(dialog, 'open').and.returnValue({ afterClosed: () => of({ resumeInstructions }) } as any);
			spyOn(component.refreshRequested, 'emit');
			spyOn(snackBar, 'open');

			// Need to ensure the button is visible and clickable for 'completed' state
			// The template has *ngIf="agentDetails().state === 'completed'" for this button
			po.clickResumeCompleted(); // This is async
			tick(); // For dialog.afterClosed()

			expect(dialog.open).toHaveBeenCalledWith(ResumeAgentModalComponent, jasmine.any(Object));
			expect(mockAgentService.resumeCompletedAgent).toHaveBeenCalledWith(
				currentMockAgentContext.agentId,
				currentMockAgentContext.executionId,
				resumeInstructions,
			);
			expect(snackBar.open).toHaveBeenCalledWith('Agent resumed successfully', 'Close', { duration: 3000 });
			expect(component.refreshRequested.emit).toHaveBeenCalled();
		}));
	});

	describe('Output Expansion Panel', () => {
		it('should toggle output expansion panel and display output', async () => {
			fixture.componentRef.setInput('agentDetails', { ...currentMockAgentContext, output: 'Detailed output here.' });
			await po.detectAndWait();

			expect(await po.isOutputExpanded()).toBe(false); // Assuming it starts collapsed by default signal value
			await po.toggleOutputExpansion();
			expect(await po.isOutputExpanded()).toBe(true);
			expect(await po.getOutputText()).toBe('Detailed output here.');

			await po.toggleOutputExpansion();
			expect(await po.isOutputExpanded()).toBe(false);
		});
	});
});
