import { ChangeDetectionStrategy, Component, Input, OnInit, ChangeDetectorRef, OnChanges, SimpleChanges, ViewEncapsulation, OnDestroy } from '@angular/core';
import { CommonModule, JsonPipe, KeyValuePipe } from '@angular/common';
import { MatExpansionModule } from '@angular/material/expansion';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatListModule } from '@angular/material/list';
import { MatTabsModule } from '@angular/material/tabs';
import { MatCardModule } from '@angular/material/card';
import { MatChipsModule } from '@angular/material/chips';
import { MatIconModule } from '@angular/material/icon';
import { Static } from '@sinclair/typebox'; // Added Static import
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { AgentService } from '../../services/agent.service';
import { AutonomousIterationSchema } from '#shared/schemas/agent.schema'; // Import for Static type
import { AutonomousIteration } from '#shared/model/agent.model';
import {FunctionCallResult} from "#shared/model/llm.model";

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
export class AgentIterationsComponent implements OnInit, OnChanges, OnDestroy {
    @Input() agentId: string | null = null;

    // iterations$: Observable<AutonomousIteration[]>; // Removed observable property
    iterations: AutonomousIteration[] = []; // Use direct array property
    isLoading: boolean = false;
    errorLoading: string | null = null;

    private destroy$ = new Subject<void>(); // Subject for subscription cleanup

    constructor(
        private agentService: AgentService,
        private _changeDetectorRef: ChangeDetectorRef,
    ) {}

    ngOnInit(): void {}

    ngOnChanges(changes: SimpleChanges): void {
        if (changes.agentId) {
            if (this.agentId) {
                console.log(`AgentIterationsComponent: ngOnChanges detected agentId change to: ${this.agentId}`);
                this.loadIterations();
            } else {
                console.log('AgentIterationsComponent: ngOnChanges detected agentId is null/undefined. Clearing iterations.');
                // Clear iterations and reset state if agentId becomes null
                this.iterations = [];
                this.isLoading = false;
                this.errorLoading = null;
                this.destroy$.next(); // Cancel any pending request
                this._changeDetectorRef.markForCheck(); // Trigger CD to clear the view
            }
        }
    }

    ngOnDestroy(): void {
        this.destroy$.next();
        this.destroy$.complete();
    }

    loadIterations(): void {
        if (!this.agentId) {
            console.warn('AgentIterationsComponent: loadIterations called with no agentId.');
            return;
        }
        console.log(`AgentIterationsComponent: Loading iterations for agent ${this.agentId}`);

        this.isLoading = true;
        this.errorLoading = null;
        this.iterations = []; // Clear previous iterations before loading new ones
        this._changeDetectorRef.markForCheck(); // Update UI to show loading state immediately

        // Cancel previous pending request if any
        this.destroy$.next();

        this.agentService.getAgentIterations(this.agentId).pipe(
            takeUntil(this.destroy$) // Ensure subscription is cleaned up on destroy or new load
        ).subscribe({
            next: (loadedIterations: Static<typeof AutonomousIterationSchema>[]) => {
                console.log(`AgentIterationsComponent: Successfully loaded ${loadedIterations.length} iterations for agent ${this.agentId}`);
                
                this.iterations = loadedIterations.map(iter => {
                    // Ensure iter.memory and iter.toolState are treated as potentially undefined
                    // and default to empty objects for Object.entries if so.
                    const memoryMap = iter.memory ? new Map(Object.entries(iter.memory)) : new Map<string, string>();
                    const toolStateMap = iter.toolState ? new Map(Object.entries(iter.toolState)) : new Map<string, any>();

                    // Create a new object conforming to AutonomousIteration
                    return {
                        ...iter,
                        memory: memoryMap,
                        toolState: toolStateMap,
                    } as AutonomousIteration; // Cast to AutonomousIteration after transformation
                });

                this.isLoading = false;
                this.errorLoading = null;
                this._changeDetectorRef.markForCheck(); // Trigger UI update
            },
            error: (error) => {
                console.error(`AgentIterationsComponent: Error loading agent iterations for agent ${this.agentId}`, error);
                this.errorLoading = 'Failed to load iteration data.';
                this.isLoading = false;
                this.iterations = []; // Clear iterations on error
                this._changeDetectorRef.markForCheck(); // Trigger UI update
            },
            // No explicit complete handler needed as isLoading is handled in next/error
        });
    }

    // Helper to toggle expansion state for potentially large content sections
    toggleExpansion(iteration: AutonomousIteration, section: 'prompt' | 'agentPlan' | 'code' | 'functionCalls'): void {
        // Directly modify the property; Angular's change detection will pick it up
        // for bindings within the *ngFor loop when the loop itself rerenders or
        // if the object reference changes (which it doesn't here).
        // No markForCheck needed for simple property toggles bound in the template.
        iteration[`${section}Expanded`] = !iteration[`${section}Expanded`];
    }

    // Helper to check if function call has error
    hasError(call: FunctionCallResult): boolean {
        return !!call.stderr;
    }

    // TrackBy function for ngFor loop for performance
    trackByIteration(index: number, iteration: AutonomousIteration): string {
        // Use iteration number and agentId for a unique key if available, otherwise fallback to index
        return iteration?.agentId && iteration?.iteration ? `${iteration.agentId}-${iteration.iteration}` : `${index}`;
    }
}
