import { ChangeDetectionStrategy, Component, input, signal, effect, inject, OnDestroy, WritableSignal, ViewEncapsulation, DestroyRef } from '@angular/core';
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
import { AutonomousIteration } from '#shared/model/agent.model';
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

    iterations: WritableSignal<AutonomousIteration[]> = signal([]);
    isLoading: WritableSignal<boolean> = signal(false);
    errorLoading: WritableSignal<string | null> = signal(null);

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
                this.agentService.clearAgentIterations();
            }
        });

        // Effect to react to service state changes
        effect(() => {
            const state = this.agentService.agentIterationsState();
            console.log(`AgentIterationsComponent: Effect (Service Sync) - agentIterationsState changed. Status: ${state.status}`);
            this.isLoading.set(state.status === 'loading');

            if (state.status === 'success') {
                const processedIterations = state.data.map(iter => ({
                    ...iter,
                    memory: iter.memory ?? {},
                    toolState: iter.toolState ?? {},
                } as AutonomousIteration));
                this.iterations.set(processedIterations);
                this.errorLoading.set(null);
                console.log(`AgentIterationsComponent: Effect (Service Sync) - Synced ${processedIterations.length} iterations from service state.`);
            } else if (state.status === 'error') {
                const errorMessage = state.error?.message || 'Failed to load iteration data.';
                console.error(`AgentIterationsComponent: Effect (Service Sync) - Error from service state: ${errorMessage}`, state.error);
                this.errorLoading.set(errorMessage);
                this.iterations.set([]);
            } else if (state.status === 'idle' || state.status === 'loading') {
                console.log(`AgentIterationsComponent: Effect (Service Sync) - Service state is '${state.status}'. Setting local iterations to empty/loading.`);
                if (state.status === 'idle') {
                    this.iterations.set([]); // Clear iterations only on 'idle'
                }
                this.errorLoading.set(null); // Clear error on 'idle' or 'loading'
            }
        });
    }

    ngOnDestroy(): void {
        // takeUntilDestroyed handles unsubscription for the agentId observable.
        // Service state clearing is handled when agentId becomes falsy or if the service manages its own lifecycle.
    }

    loadIterations(agentId: string): void {
        if (!agentId) {
            console.warn('AgentIterationsComponent: loadIterations called with no agentId.');
            // Ensure local state reflects no data if agentId is invalid
            this.iterations.set([]);
            this.isLoading.set(false);
            this.errorLoading.set(null);
            this.agentService.clearAgentIterations(); // Clear service state if appropriate
            return;
        }
        console.log(`AgentIterationsComponent: Requesting iterations for agent ${agentId}`);
        // isLoading, errorLoading, and iterations are now set by the effect reacting to agentService.agentIterationsState()
        this.agentService.loadAgentIterations(agentId);
    }

    // Helper to toggle expansion state for potentially large content sections
    // This approach of adding a temporary property directly to the iteration object
    // might not be ideal with signals if the object reference itself doesn't change.
    // For simplicity, keeping it, but a map of expanded states keyed by iteration ID might be cleaner.
    toggleExpansion(iteration: AutonomousIteration, section: 'prompt' | 'agentPlan' | 'code' | 'functionCalls'): void {
        iteration[`${section}Expanded`] = !iteration[`${section}Expanded`];
        // Force a new array reference to trigger ngFor updates if simple property change isn't detected
        // this.iterations.update(current => [...current]); // Uncomment if expansion doesn't work
    }

    // Helper to check if function call has error
    hasError(call: FunctionCallResult): boolean {
        return !!call.stderr;
    }

    // TrackBy function for ngFor loop for performance
    trackByIteration(index: number, iteration: AutonomousIteration): string {
        return iteration?.agentId && iteration?.iteration ? `${iteration.agentId}-${iteration.iteration}` : `${index}`;
    }
}
