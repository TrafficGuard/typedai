import { ChangeDetectionStrategy, Component, input, signal, effect, inject, OnDestroy, WritableSignal, ViewEncapsulation } from '@angular/core';
import { CommonModule, JsonPipe, KeyValuePipe } from '@angular/common';
import { MatExpansionModule } from '@angular/material/expansion';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatListModule } from '@angular/material/list';
import { MatTabsModule } from '@angular/material/tabs';
import { MatCardModule } from '@angular/material/card';
import { MatChipsModule } from '@angular/material/chips';
import { MatIconModule } from '@angular/material/icon';
import { Subject, Subscription } from 'rxjs'; // Keep Subject for manual cancellation if needed, or just use destroyRef
import { takeUntil } from 'rxjs/operators';
import { AgentService } from '../../agent.service';
import { AutonomousIteration } from '#shared/model/agent.model';
import { FunctionCallResult } from "#shared/model/llm.model";

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
    private destroy$ = new Subject<void>(); // For managing ongoing subscriptions during agentId changes

    constructor() {
        effect(() => {
            const currentAgentId = this.agentId();
            if (currentAgentId) {
                console.log(`AgentIterationsComponent: effect detected agentId change to: ${currentAgentId}`);
                this.loadIterations(currentAgentId);
            } else {
                console.log('AgentIterationsComponent: effect detected agentId is null/undefined. Clearing iterations.');
                this.iterations.set([]);
                this.isLoading.set(false);
                this.errorLoading.set(null);
                this.destroy$.next(); // Cancel any pending request for previous agentId
            }
        });
    }

    ngOnDestroy(): void {
        this.destroy$.next();
        this.destroy$.complete();
    }

    loadIterations(agentId: string): void {
        if (!agentId) {
            console.warn('AgentIterationsComponent: loadIterations called with no agentId.');
            return;
        }
        console.log(`AgentIterationsComponent: Loading iterations for agent ${agentId}`);

        this.isLoading.set(true);
        this.errorLoading.set(null);
        this.iterations.set([]); // Clear previous iterations

        // Cancel previous pending request if any, before starting a new one
        this.destroy$.next();

        this.agentService.getAgentIterations(agentId).pipe(
            takeUntil(this.destroy$) // Ensure subscription is cleaned up on destroy or new load for a different agentId
        ).subscribe({
            next: (loadedIterations: AutonomousIteration[]) => {
                console.log(`AgentIterationsComponent: Successfully loaded ${loadedIterations.length} iterations for agent ${agentId}`);

                const processedIterations = loadedIterations.map(iter => {
                    return {
                        ...iter,
                        memory: iter.memory ?? {},
                        toolState: iter.toolState ?? {},
                    } as AutonomousIteration;
                });
                this.iterations.set(processedIterations);
                this.isLoading.set(false);
                this.errorLoading.set(null);
            },
            error: (error) => {
                console.error(`AgentIterationsComponent: Error loading agent iterations for agent ${agentId}`, error);
                this.errorLoading.set('Failed to load iteration data.');
                this.isLoading.set(false);
                this.iterations.set([]);
            },
        });
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
