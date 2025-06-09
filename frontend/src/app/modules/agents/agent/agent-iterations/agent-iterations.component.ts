import { animate, style, transition, trigger } from '@angular/animations';
import { CommonModule, JsonPipe, KeyValuePipe } from '@angular/common';
import {
	ChangeDetectionStrategy,
	Component,
	DestroyRef,
	type OnDestroy,
	ViewEncapsulation,
	WritableSignal,
	computed,
	inject,
	input,
	signal,
} from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { MatCardModule } from '@angular/material/card';
import { MatChipsModule } from '@angular/material/chips';
import { MatExpansionModule } from '@angular/material/expansion';
import { MatIconModule } from '@angular/material/icon';
import { MatListModule } from '@angular/material/list';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTabsModule } from '@angular/material/tabs';
// import { Subject, Subscription } from 'rxjs'; // No longer needed
import { distinctUntilChanged, filter, tap } from 'rxjs/operators';
import { AutonomousIteration, AutonomousIterationSummary } from '#shared/agent/agent.model';
import { FunctionCallResult } from '#shared/llm/llm.model';
import { AgentService } from '../../agent.service';

@Component({
	selector: 'agent-iterations',
	templateUrl: './agent-iterations.component.html',
	styleUrls: ['./agent-iterations.component.scss'],
	encapsulation: ViewEncapsulation.None,
	changeDetection: ChangeDetectionStrategy.OnPush,
	standalone: true,
	imports: [
		CommonModule,
		MatExpansionModule,
		MatProgressSpinnerModule,
		MatListModule,
		MatCardModule,
		MatChipsModule,
		MatIconModule,
		JsonPipe,
		MatTabsModule,
		KeyValuePipe,
	],
	animations: [
		trigger('summaryFade', [
			transition(':enter', [style({ opacity: 0 }), animate('250ms cubic-bezier(0.4, 0.0, 0.2, 1)', style({ opacity: 1 }))]),
			transition(':leave', [animate('250ms cubic-bezier(0.4, 0.0, 0.2, 1)', style({ opacity: 0 }))]),
		]),
	],
})
export class AgentIterationsComponent implements OnDestroy {
	agentId = input<string | null>(null);

	iterations = computed(() => {
		const state = this.agentService.agentIterationsState();
		if (state.status === 'success') {
			return state.data;
		}
		return [];
	});

	isLoading = computed(() => {
		const state = this.agentService.agentIterationsState();
		return state.status === 'loading';
	});

	errorLoading = computed(() => {
		const state = this.agentService.agentIterationsState();
		return state.status === 'error' ? state.error?.message || 'Failed to load iteration summary data.' : null;
	});
	expandedIterationData = signal<Record<number, { status: 'loading' | 'success' | 'error'; data?: AutonomousIteration; error?: any }>>({});

	private detailState = computed(() => this.agentService.selectedAgentIterationDetailState());

	private agentService = inject(AgentService);
	private destroyRef = inject(DestroyRef);

	constructor() {
		toObservable(this.agentId)
			.pipe(
				tap((id) => console.log(`AgentIterationsComponent: agentId input emitted (pre-distinct): '${id}'`)),
				distinctUntilChanged(),
				tap((id) => console.log(`AgentIterationsComponent: agentId input changed (post-distinct): '${id}'`)),
				takeUntilDestroyed(this.destroyRef),
			)
			.subscribe((currentAgentIdVal) => {
				if (currentAgentIdVal) {
					console.log(`AgentIterationsComponent: Subscription Handler - agentId is truthy ('${currentAgentIdVal}'), calling loadIterations.`);
					this.loadIterations(currentAgentIdVal);
				} else {
					console.log('AgentIterationsComponent: Subscription Handler - agentId is falsy. Clearing local iterations and service state.');
					this.expandedIterationData.set({});
					this.agentService.clearAgentIterations();
					this.agentService.clearSelectedAgentIterationDetail();
				}
			});

		// Handle error logging side effects
		toObservable(this.errorLoading)
			.pipe(
				filter((error) => error !== null),
				takeUntilDestroyed(this.destroyRef),
			)
			.subscribe((error) => {
				// error is already a string message from errorLoading computed
				console.error(`AgentIterationsComponent: Error from service state: ${error}`);
			});

		// Handle detail state side effects
		toObservable(this.detailState)
			.pipe(takeUntilDestroyed(this.destroyRef))
			.subscribe((detailState) => {
				if (detailState.status === 'success' && detailState.data) {
					this.expandedIterationData.update((s) => ({
						...s,
						[detailState.data.iteration]: { status: 'success', data: detailState.data },
					}));
					console.log(`AgentIterationsComponent: Synced details for iteration ${detailState.data.iteration}.`);
				} else if (detailState.status === 'error' && detailState.error) {
					const loadingIterationKey = Object.keys(this.expandedIterationData()).find((key) => this.expandedIterationData()[Number(key)]?.status === 'loading');
					if (loadingIterationKey) {
						this.expandedIterationData.update((s) => ({
							...s,
							[Number(loadingIterationKey)]: { status: 'error', error: detailState.error },
						}));
						console.error(`AgentIterationsComponent: Error loading details for iteration ${loadingIterationKey}:`, detailState.error);
					} else {
						console.error('AgentIterationsComponent: Unassociated error loading iteration detail:', detailState.error);
					}
				}
			});
	}

	ngOnDestroy(): void {
		// takeUntilDestroyed handles unsubscription for the agentId observable.
	}

	loadIterations(agentId: string): void {
		if (!agentId) {
			console.warn('AgentIterationsComponent: loadIterations called with no agentId.');
			this.expandedIterationData.set({});
			this.agentService.clearAgentIterations();
			this.agentService.clearSelectedAgentIterationDetail();
			return;
		}
		console.log(`AgentIterationsComponent: Requesting iteration summaries for agent ${agentId}`);
		this.agentService.loadAgentIterations(agentId);
	}

	fetchIterationDetails(iterSummary: AutonomousIterationSummary): void {
		const currentAgentId = this.agentId();
		if (!currentAgentId) {
			console.warn('AgentIterationsComponent: fetchIterationDetails called with no agentId.');
			return;
		}

		const iterationNum = iterSummary.iteration;
		const existingDetailState = this.expandedIterationData()[iterationNum];

		if (existingDetailState?.status === 'loading' || existingDetailState?.status === 'success') {
			console.log(`AgentIterationsComponent: Details for iteration ${iterationNum} already loading or loaded.`);
			return;
		}

		console.log(`AgentIterationsComponent: Requesting details for iteration ${iterationNum} of agent ${currentAgentId}`);
		this.expandedIterationData.update((s) => ({
			...s,
			[iterationNum]: { status: 'loading' },
		}));
		this.agentService.loadAgentIterationDetail(currentAgentId, iterationNum);
	}

	// Helper to check if function call has error
	hasError(call: FunctionCallResult): boolean {
		return !!call.stderr;
	}

	// TrackBy function for ngFor loop for performance
	trackByIteration(index: number, iteration: AutonomousIterationSummary): string {
		return iteration?.agentId && iteration?.iteration ? `${iteration.agentId}-${iteration.iteration}` : `${index}`;
	}
}
