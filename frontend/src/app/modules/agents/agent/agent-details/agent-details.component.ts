import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, DestroyRef, OnInit, WritableSignal, computed, inject, input, output, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatDialog } from '@angular/material/dialog';
import { MatExpansionModule } from '@angular/material/expansion';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatListModule } from '@angular/material/list';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatRadioModule } from '@angular/material/radio';
import { MatSelectModule } from '@angular/material/select';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { Router } from '@angular/router';
import { MarkdownComponent, MarkdownModule, MarkdownService, MarkedRenderer, provideMarkdown } from 'ngx-markdown';
import { catchError, filter, finalize, of, throwError } from 'rxjs';
import { AgentRunningState } from '#shared/agent/agent.model';
import { AgentContextApi } from '#shared/agent/agent.schema';
import { ClipboardButtonComponent } from '../../../chat/conversation/clipboard-button.component';
import { LLM, LlmService } from '../../../llm.service';
import { AgentLinks, GoogleCloudLinks } from '../../agent-links';
import { AGENT_ROUTE_DEFINITIONS } from '../../agent.routes';
import { AgentService } from '../../agent.service';
import { FunctionsService } from '../../functions.service';
import { FunctionEditModalComponent } from '../function-edit-modal/function-edit-modal.component';
import { ResumeAgentModalComponent } from '../resume-agent-modal/resume-agent-modal.component';

@Component({
	selector: 'agent-details',
	templateUrl: './agent-details.component.html',
	styleUrl: 'agent-details.component.scss',
	standalone: true,
	changeDetection: ChangeDetectionStrategy.OnPush,
	imports: [
		CommonModule,
		MatCardModule,
		MatListModule,
		MatButtonModule,
		MatIconModule,
		MatExpansionModule,
		MatFormFieldModule,
		MatInputModule,
		ReactiveFormsModule,
		MatSelectModule,
		MatCheckboxModule,
		MatRadioModule,
		MatTooltipModule,
		MatProgressSpinnerModule,
		MarkdownModule,
	],
	providers: [provideMarkdown()],
})
export class AgentDetailsComponent implements OnInit {
	agentDetails = input.required<AgentContextApi>();
	refreshRequested = output<void>();

	feedbackForm: FormGroup;
	hilForm: FormGroup;
	errorForm: FormGroup;

	isSubmitting = signal(false);
	isResumingError = signal(false);
	isForcingStop = signal(false);
	isRequestingHil = signal(false);
	userPromptExpanded = signal(false);
	outputExpanded = signal(false);

	private functionsData = computed(() => {
		const state = this.functionsService.functionsState();
		if (state.status === 'success') {
			return state.data;
		}
		return [];
	});

	private functionsError = computed(() => {
		const state = this.functionsService.functionsState();
		return state.status === 'error' ? state.error : null;
	});

	allAvailableFunctions = computed(() => this.functionsData());
	// llmNameMap is derived from llmService.llmsState, which is the ApiListState signal
	llmNameMap = computed(() => {
		const state = this.llmService.llmsState();
		if (state.status === 'success') {
			return new Map(state.data.map((llm) => [llm.id, llm.name]));
		}
		return new Map(); // Return empty map if not in success state
	});

	agentLinks: AgentLinks = new GoogleCloudLinks();
	readonly routes = AGENT_ROUTE_DEFINITIONS;

	private formBuilder = inject(FormBuilder);
	private snackBar = inject(MatSnackBar);
	private dialog = inject(MatDialog);
	private functionsService = inject(FunctionsService);
	private markdown = inject(MarkdownService);
	private router = inject(Router);
	private agentService = inject(AgentService);
	protected llmService = inject(LlmService); // Make protected to access in template
	private readonly destroyRef = inject(DestroyRef);

	constructor() {
		this.feedbackForm = this.formBuilder.group({ feedback: ['', Validators.required] });
		this.hilForm = this.formBuilder.group({ feedback: [''] });
		this.errorForm = this.formBuilder.group({ errorDetails: ['', Validators.required] });

		// Handle error side effects with RxJS
		toObservable(this.functionsError)
			.pipe(
				filter((error) => error !== null),
				takeUntilDestroyed(this.destroyRef),
			)
			.subscribe((error) => {
				console.error('Error loading functions in AgentDetailsComponent:', error);
				this.snackBar.open('Error loading available functions', 'Close', { duration: 3000 });
			});
	}

	ngOnInit(): void {
		this.functionsService.getFunctions();
		this.llmService.loadLlms();

		this.markdown.options = {
			renderer: new MarkedRenderer(),
			gfm: true,
			breaks: true,
		};
	}

	handleRefreshAgentDetails(): void {
		this.refreshRequested.emit();
	}

	onSubmitFeedback(): void {
		if (!this.feedbackForm.valid) return;
		const feedback = this.feedbackForm.get('feedback')?.value;
		this.isSubmitting.set(true);
		const currentAgentDetails = this.agentDetails();

		this.agentService
			.submitFeedback(currentAgentDetails.agentId, currentAgentDetails.executionId, feedback)
			.pipe(
				takeUntilDestroyed(this.destroyRef),
				catchError((error) => {
					console.error('Error submitting feedback:', error);
					this.snackBar.open('Error submitting feedback', 'Close', { duration: 3000 });
					return of(null);
				}),
				finalize(() => {
					this.isSubmitting.set(false);
				}),
			)
			.subscribe((response) => {
				if (response) {
					this.feedbackForm.reset();
					this.snackBar.open('Feedback submitted successfully', 'Close', { duration: 3000 });
					this.handleRefreshAgentDetails();
				}
			});
	}

	onResumeHil(): void {
		if (!this.hilForm.valid) return;
		this.isSubmitting.set(true);
		const feedback = this.hilForm.get('feedback')?.value;
		const currentAgentDetails = this.agentDetails();
		this.agentService
			.resumeAgent(currentAgentDetails.agentId, currentAgentDetails.executionId, feedback)
			.pipe(
				takeUntilDestroyed(this.destroyRef),
				catchError((error) => {
					console.error('Error resuming agent:', error);
					this.snackBar.open('Error resuming agent', 'Close', { duration: 3000 });
					return of(null);
				}),
				finalize(() => {
					this.isSubmitting.set(false);
				}),
			)
			.subscribe((response) => {
				if (response) {
					this.snackBar.open('Agent resumed successfully', 'Close', { duration: 3000 });
					this.hilForm.reset();
					this.handleRefreshAgentDetails();
				}
			});
	}

	onResumeError(): void {
		if (!this.errorForm.valid) return;
		this.isResumingError.set(true);
		const errorDetails = this.errorForm.get('errorDetails')?.value;
		const currentAgentDetails = this.agentDetails();

		this.agentService
			.resumeError(currentAgentDetails.agentId, currentAgentDetails.executionId, errorDetails)
			.pipe(
				takeUntilDestroyed(this.destroyRef),
				catchError((error) => {
					console.error('Error resuming agent:', error);
					this.snackBar.open('Error resuming agent', 'Close', { duration: 3000 });
					return of(null);
				}),
				finalize(() => {
					this.isResumingError.set(false);
				}),
			)
			.subscribe((response) => {
				if (response) {
					this.snackBar.open('Agent resumed successfully', 'Close', { duration: 3000 });
					this.errorForm.reset();
					this.handleRefreshAgentDetails();
				}
			});
	}

	cancelAgent(): void {
		const currentAgentDetails = this.agentDetails();
		this.agentService
			.cancelAgent(currentAgentDetails.agentId, currentAgentDetails.executionId, 'None provided')
			.pipe(
				takeUntilDestroyed(this.destroyRef),
				catchError((error) => {
					console.error('Error cancelling agent:', error);
					this.snackBar.open('Error cancelling agent', 'Close', { duration: 3000 });
					return of(null);
				}),
			)
			.subscribe((response) => {
				if (response) {
					this.snackBar.open('Agent cancelled successfully', 'Close', { duration: 3000 });
					this.router.navigate(this.routes.nav.list()).catch(console.error);
				}
			});
	}

	displayState(state: AgentRunningState): string {
		switch (state) {
			case 'agent':
				return 'Agent control loop';
			case 'functions':
				return 'Calling functions';
			case 'error':
				return 'Error';
			case 'hil':
			case 'hitl_threshold':
				return 'Human-in-the-loop check';
			case 'hitl_feedback':
				return 'Agent requested feedback';
			case 'completed':
				return 'Completed';
			default:
				return state;
		}
	}

	traceUrl(agent: AgentContextApi): string {
		return this.agentLinks.traceUrl(agent);
	}

	logsUrl(agent: AgentContextApi): string {
		return this.agentLinks.logsUrl(agent);
	}

	databaseUrl(agent: AgentContextApi): string {
		return this.agentLinks.agentDatabaseUrl(agent);
	}

	getLlmName(llmId: string): string {
		if (!llmId) return 'Unknown';
		return this.llmNameMap().get(llmId) || llmId;
	}

	openFunctionEditModal(): void {
		const currentAgentDetails = this.agentDetails();
		console.log('Opening function edit modal');
		console.log('Current functions:', currentAgentDetails.functions);
		console.log('All available functions:', this.allAvailableFunctions());

		const dialogRef = this.dialog.open(FunctionEditModalComponent, {
			width: '400px',
			data: {
				functions: currentAgentDetails.functions?.functionClasses || [], // Pass functionClasses array
				allFunctions: this.allAvailableFunctions() || [],
			},
		});

		dialogRef.afterClosed().subscribe((result) => {
			if (result) {
				console.log('Dialog closed with result:', result);
				this.saveFunctions(result);
			} else {
				console.log('Dialog closed without result');
			}
		});
	}

	saveFunctions(selectedFunctions: string[]): void {
		const currentAgentDetails = this.agentDetails();
		this.agentService
			.updateAgentFunctions(currentAgentDetails.agentId, selectedFunctions)
			.pipe(
				takeUntilDestroyed(this.destroyRef),
				catchError((error) => {
					console.error('Error updating agent functions:', error);
					this.snackBar.open('Error updating agent functions', 'Close', { duration: 3000 });
					return throwError(() => new Error('Error updating agent functions'));
				}),
			)
			.subscribe({
				next: (updatedAgent) => {
					// Assuming service returns updated agent
					this.snackBar.open('Agent functions updated successfully', 'Close', { duration: 3000 });
					// The parent (AgentComponent) should reload agentDetails via refreshRequested event
					this.handleRefreshAgentDetails();
				},
			});
	}

	forceStopAgent(): void {
		this.isForcingStop.set(true);
		const currentAgentDetails = this.agentDetails();
		this.agentService
			.forceStopAgent(currentAgentDetails.agentId)
			.pipe(
				takeUntilDestroyed(this.destroyRef),
				catchError((error) => {
					console.error('Error forcing agent stop:', error);
					this.snackBar.open('Error forcing agent stop', 'Close', { duration: 3000 });
					return of(null);
				}),
				finalize(() => {
					this.isForcingStop.set(false);
				}),
			)
			.subscribe((response) => {
				if (response !== null) {
					this.snackBar.open('Agent stop request sent successfully. Refreshing details...', 'Close', { duration: 4000 });
					this.handleRefreshAgentDetails();
				}
			});
	}

	requestHilCheck(): void {
		this.isRequestingHil.set(true);
		const currentAgentDetails = this.agentDetails();
		this.agentService
			.requestHilCheck(currentAgentDetails.agentId, currentAgentDetails.executionId)
			.pipe(
				takeUntilDestroyed(this.destroyRef),
				catchError((error) => {
					console.error('Error requesting HIL check:', error);
					this.snackBar.open('Error requesting HIL check', 'Close', { duration: 3000 });
					return of(null);
				}),
				finalize(() => {
					this.isRequestingHil.set(false);
				}),
			)
			.subscribe((response) => {
				if (response !== null) {
					this.snackBar.open('HIL check requested successfully. Refreshing...', 'Close', { duration: 4000 });
					this.handleRefreshAgentDetails();
				}
			});
	}

	canRequestHil(): boolean {
		const currentAgentDetails = this.agentDetails();
		if (!currentAgentDetails) return false;
		const allowedStates: AgentRunningState[] = ['workflow', 'agent', 'functions', 'hitl_tool'];
		return allowedStates.includes(currentAgentDetails.state) && !currentAgentDetails.hilRequested;
	}

	openResumeModal(): void {
		const dialogRef = this.dialog.open(ResumeAgentModalComponent, {
			width: '500px',
		});

		dialogRef.afterClosed().subscribe((result) => {
			if (result) this.resumeCompletedAgent(result.resumeInstructions);
		});
	}

	private resumeCompletedAgent(resumeInstructions: string): void {
		this.isSubmitting.set(true);
		const currentAgentDetails = this.agentDetails();
		this.agentService
			.resumeCompletedAgent(currentAgentDetails.agentId, currentAgentDetails.executionId, resumeInstructions)
			.pipe(
				takeUntilDestroyed(this.destroyRef),
				catchError((error) => {
					console.error('Error resuming completed agent:', error);
					this.snackBar.open('Error resuming completed agent', 'Close', { duration: 3000 });
					return of(null);
				}),
				finalize(() => {
					this.isSubmitting.set(false);
				}),
			)
			.subscribe((response) => {
				if (response) {
					this.snackBar.open('Agent resumed successfully', 'Close', { duration: 3000 });
					this.refreshRequested.emit();
				}
			});
	}

	protected readonly clipboardButton = ClipboardButtonComponent;
}
