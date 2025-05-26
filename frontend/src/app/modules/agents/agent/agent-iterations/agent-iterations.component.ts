import { ChangeDetectionStrategy, Component, input, signal, effect, inject, OnDestroy, WritableSignal, ViewEncapsulation, DestroyRef, computed } from '@angular/core';
import { CommonModule, JsonPipe, KeyValuePipe } from '@angular/common';
import { MatExpansionModule } from '@angular/material/expansion';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatListModule } from '@angular/material/list';
import { MatTabsModule } from '@angular/material/tabs';
import { MatCardModule } from '@angular/material/card';
import { MatChipsModule } from '@angular/material/chips';
import { MatIconModule } from '@angular/material/icon';
// import { Subject, Subscription } from 'rxjs'; // No longer needed
import { distinctUntilChanged, tap } from 'rxjs/operators';
import { AgentService } from '../../agent.service';
import { AutonomousIteration, AutonomousIterationSummary } from '#shared/model/agent.model';
import { FunctionCallResult } from "#shared/model/llm.model";
import { toObservable, takeUntilDestroyed } from '@angular/core/rxjs-interop';

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
})
export class AgentIterationsComponent implements OnDestroy {
    agentId = input<string | null>(null);

    iterations: WritableSignal<AutonomousIterationSummary[]> = signal([]);
    isLoading: WritableSignal<boolean> = signal(false);
    errorLoading: WritableSignal<string | null> = signal(null);
    expandedIterationData = signal<Record<number, { status: 'loading' | 'success' | 'error', data?: AutonomousIteration, error?: any }>>({});

    private agentService = inject(AgentService);
    private destroyRef = inject(DestroyRef);

    constructor() {
        toObservable(this.agentId).pipe(
            tap(id => console.log(`AgentIterationsComponent: agentId input emitted (pre-distinct): '${id}'`)),
            distinctUntilChanged(),
            tap(id => console.log(`AgentIterationsComponent: agentId input changed (post-distinct): '${id}'`)),
            takeUntilDestroyed(this.destroyRef)
        ).subscribe(currentAgentIdVal => {
            if (currentAgentIdVal) {
                console.log(`AgentIterationsComponent: Subscription Handler - agentId is truthy ('${currentAgentIdVal}'), calling loadIterations.`);
                this.loadIterations(currentAgentIdVal);
            } else {
                console.log('AgentIterationsComponent: Subscription Handler - agentId is falsy. Clearing local iterations and service state.');
                this.iterations.set([]);
                this.isLoading.set(false);
                this.errorLoading.set(null);
                this.expandedIterationData.set({});
                this.agentService.clearAgentIterations();
                this.agentService.clearSelectedAgentIterationDetail(); // Assuming this method exists
            }
        });

        // Effect to react to service state changes for iteration summaries
        effect(() => {
            const state = this.agentService.agentIterationsState();
            console.log(`AgentIterationsComponent: Effect (Summary Sync) - agentIterationsState changed. Status: ${state.status}`);
            this.isLoading.set(state.status === 'loading');

            if (state.status === 'success') {
                const processedIterations = state.data;
                this.iterations.set(processedIterations);
                this.errorLoading.set(null);
                console.log(`AgentIterationsComponent: Effect (Summary Sync) - Synced ${processedIterations.length} iterations from service state.`);
            } else if (state.status === 'error') {
                const errorMessage = state.error?.message || 'Failed to load iteration summary data.';
                console.error(`AgentIterationsComponent: Effect (Summary Sync) - Error from service state: ${errorMessage}`, state.error);
                this.errorLoading.set(errorMessage);
                this.iterations.set([]);
            } else if (state.status === 'idle' || state.status === 'loading') {
                console.log(`AgentIterationsComponent: Effect (Summary Sync) - Service state is '${state.status}'. Setting local iterations to empty/loading.`);
                if (state.status === 'idle') {
                    this.iterations.set([]);
                }
                this.errorLoading.set(null);
            }
        });

        // Effect to react to service state changes for selected iteration detail
        effect(() => {
            const detailState = this.agentService.selectedAgentIterationDetailState();
            console.log(`AgentIterationsComponent: Effect (Detail Sync) - selectedAgentIterationDetailState changed. Status: ${detailState.status}`);

            if (detailState.status === 'success' && detailState.data) {
                this.expandedIterationData.update(s => ({
                    ...s,
                    [detailState.data.iteration]: { status: 'success', data: detailState.data }
                }));
                console.log(`AgentIterationsComponent: Effect (Detail Sync) - Synced details for iteration ${detailState.data.iteration}.`);
            } else if (detailState.status === 'error' && detailState.error) {
                // Try to associate error with a loading iteration.
                // This is a simplification; ideally, detailState would include the iteration number for the error.
                const loadingIterationKey = Object.keys(this.expandedIterationData()).find(
                    key => this.expandedIterationData()[Number(key)]?.status === 'loading'
                );
                if (loadingIterationKey) {
                     this.expandedIterationData.update(s => ({
                        ...s,
                        [Number(loadingIterationKey)]: { status: 'error', error: detailState.error }
                    }));
                    console.error(`AgentIterationsComponent: Effect (Detail Sync) - Error loading details for iteration ${loadingIterationKey}:`, detailState.error);
                } else {
                    // If no specific iteration was 'loading', this error is unassociated or for a non-expanded item.
                    console.error('AgentIterationsComponent: Effect (Detail Sync) - Unassociated error loading iteration detail:', detailState.error);
                }
            }
            // 'idle' or 'loading' states for details are primarily managed by fetchIterationDetails initiating the load.
        }, { allowSignalWrites: true }); // allowSignalWrites might be needed if effect updates signals that are read elsewhere in same cycle, though direct updates to expandedIterationData should be fine.
    }

    ngOnDestroy(): void {
        // takeUntilDestroyed handles unsubscription for the agentId observable.
    }

    loadIterations(agentId: string): void {
        if (!agentId) {
            console.warn('AgentIterationsComponent: loadIterations called with no agentId.');
            this.iterations.set([]);
            this.isLoading.set(false);
            this.errorLoading.set(null);
            this.expandedIterationData.set({});
            this.agentService.clearAgentIterations();
            this.agentService.clearSelectedAgentIterationDetail(); // Assuming this method exists
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
        this.expandedIterationData.update(s => ({
            ...s,
            [iterationNum]: { status: 'loading' }
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
