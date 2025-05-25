import {ChangeDetectionStrategy, Component, ViewEncapsulation, inject, signal, effect, WritableSignal, DestroyRef} from '@angular/core';
import { MatSnackBar } from '@angular/material/snack-bar';
import { ActivatedRoute, RouterModule } from '@angular/router';
import { MatTabsModule } from '@angular/material/tabs';
// MatCardModule, MatFormFieldModule etc. are not directly used by AgentComponent's template, but by its children.
// Children will import them.
import { CommonModule } from '@angular/common';
import { AgentContextApi } from '#shared/schemas/agent.schema';
import { AgentDetailsComponent } from './agent-details/agent-details.component';
import { AgentMemoryComponent } from './agent-memory/agent-memory.component';
import { AgentFunctionCallsComponent } from './agent-function-calls/agent-function-calls.component';
import { AgentLlmCallsComponent } from './agent-llm-calls/agent-llm-calls.component';
import { AgentIterationsComponent } from './agent-iterations/agent-iterations.component';
import { AgentToolStateComponent } from './agent-tool-state/agent-tool-state.component';
import { AgentService } from "../agent.service";
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { distinctUntilChanged, map, tap } from 'rxjs/operators';

@Component({
    selector: 'agent',
    templateUrl: './agent.component.html',
    encapsulation: ViewEncapsulation.None,
    changeDetection: ChangeDetectionStrategy.OnPush,
    standalone: true,
    imports: [
        CommonModule, // For @if, @defer
        RouterModule, // If any router-links or outlets were in this component's template
        MatTabsModule,
        AgentDetailsComponent,
        AgentMemoryComponent,
        AgentFunctionCallsComponent,
        AgentLlmCallsComponent,
        AgentIterationsComponent,
        AgentToolStateComponent,
    ],
})
export class AgentComponent {
    agentDetails: WritableSignal<AgentContextApi | null> = signal(null);

    private route = inject(ActivatedRoute);
    private snackBar = inject(MatSnackBar);
    private agentService = inject(AgentService);
    private destroyRef = inject(DestroyRef);

    constructor() {
        this.route.paramMap.pipe(
            map(params => params.get('id')),
            tap(id => console.log(`AgentComponent: paramMap emitted ID (pre-distinct): '${id}'`)),
            distinctUntilChanged(),
            tap(id => console.log(`AgentComponent: paramMap emitted ID (post-distinct, to be processed): '${id}'`)),
            takeUntilDestroyed(this.destroyRef)
        ).subscribe(currentAgentIdVal => {
            console.log(`AgentComponent: Subscription Handler - Processed agentId from paramMap: '${currentAgentIdVal}'`);
            if (currentAgentIdVal) {
                console.log(`AgentComponent: Subscription Handler - agentId is truthy ('${currentAgentIdVal}'), calling agentService.loadAgentDetails.`);
                this.agentService.loadAgentDetails(currentAgentIdVal);
            } else {
                console.log(`AgentComponent: Subscription Handler - agentId is falsy ('${currentAgentIdVal}'), calling agentService.clearSelectedAgentDetails.`);
                this.agentService.clearSelectedAgentDetails();
            }
        });

        effect(() => {
            const state = this.agentService.selectedAgentDetailsState();
            // Updated log:
            console.log(`AgentComponent: Effect (State Sync) - agentService.selectedAgentDetailsState() changed. Status: ${state.status}`);
            if (state.status === 'success') {
                const apiDetails = state.data;
                const details = {...apiDetails};
                details.toolState = details.toolState ?? {};
                details.output = null;
                if (details.state === 'completed') {
                    const maybeCompletedFunctionCall = details.functionCallHistory?.length
                        ? details.functionCallHistory.slice(-1)[0]
                        : null;
                    details.output = (details.error ?? maybeCompletedFunctionCall?.parameters?.['note']) ?? '';
                }
                this.agentDetails.set(details);
                // Updated log:
                console.log('AgentComponent: Effect (State Sync) - Agent Details Processed and Set from Service State. New local agentDetails:', JSON.stringify(details)); // Stringify for better object logging
            } else if (state.status === 'error') {
                // Updated log:
                console.error('AgentComponent: Effect (State Sync) - Error in agentService.selectedAgentDetailsState()', state.error);
                this.snackBar.open('Error loading agent details', 'Close', { duration: 3000 });
                this.agentDetails.set(null);
            } else if (state.status === 'not_found' || state.status === 'forbidden') {
                // Updated log:
                console.log(`AgentComponent: Effect (State Sync) - Agent service state is '${state.status}'. Clearing local agentDetails.`);
                this.snackBar.open(`Agent ${state.status}`, 'Close', {duration: 3000});
                this.agentDetails.set(null);
            } else { // idle or loading
                // Updated log:
                console.log(`AgentComponent: Effect (State Sync) - Agent service state is '${state.status}'. Clearing local agentDetails.`);
                this.agentDetails.set(null);
            }
        });
    }

    public handleRefreshAgentDetails(): void {
        const agentCtx = this.agentDetails();
        if (agentCtx?.agentId) {
            this.agentService.loadAgentDetails(agentCtx.agentId);
        } else {
            console.warn('AgentComponent: refreshRequested, but no agentId found in current agentDetails.');
        }
    }
}
