import {ChangeDetectionStrategy, Component, ViewEncapsulation, inject, signal, effect, WritableSignal} from '@angular/core';
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
import { toSignal } from '@angular/core/rxjs-interop';
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

    // Get agentId from route params
    readonly agentId = toSignal(
        this.route.paramMap.pipe(
            tap(params => console.log(`AgentComponent: route.paramMap emitted. Has 'id': ${params.has('id')}, Value: '${params.get('id')}'`, params)),
            map(params => params.get('id')),
            tap(id => console.log(`AgentComponent: value for agentId signal after map (pre-distinctUntilChanged): '${id}'`)),
            distinctUntilChanged(),
            tap(id => console.log(`AgentComponent: value for agentId signal after distinctUntilChanged (toSignal input): '${id}'`))
        )
    );

    constructor() {
        effect(() => {
            const currentAgentIdVal = this.agentId(); // Read the new readonly signal
            console.log(`AgentComponent: effect for agentId. Current value: '${currentAgentIdVal}'`); // Keep or adjust logging as needed
            if (currentAgentIdVal) {
                console.log(`AgentComponent: agentId is truthy ('${currentAgentIdVal}'), calling loadAgentDetails.`);
                this.loadAgentDetails(); // loadAgentDetails will internally use this.agentId()
            } else {
                // This case handles when agentId becomes null (e.g. route change to one without :id, or initial state before paramMap emits)
                console.log(`AgentComponent: agentId is falsy ('${currentAgentIdVal}'), clearing details.`);
                this.agentDetails.set(null);
                this.agentService.clearSelectedAgentDetails();
            }
        });

        effect(() => {
            const state = this.agentService.selectedAgentDetailsState();
            if (state.status === 'success') {
                const apiDetails = state.data;
                // Process apiDetails here before setting the signal
                const details = {...apiDetails}; // Clone to avoid mutating the source from service if it's cached
                details.toolState = details.toolState ?? {};
                details.output = null;
                if (details.state === 'completed') {
                    const maybeCompletedFunctionCall = details.functionCallHistory?.length
                        ? details.functionCallHistory.slice(-1)[0]
                        : null;
                    details.output = (details.error ?? maybeCompletedFunctionCall?.parameters?.['note']) ?? '';
                }
                this.agentDetails.set(details);
                console.log('Agent Details Processed and Set from Service State:', details);
            } else if (state.status === 'error') {
                console.error('Error loading agent details from service state', state.error);
                this.snackBar.open('Error loading agent details', 'Close', { duration: 3000 });
                this.agentDetails.set(null);
            } else if (state.status === 'not_found' || state.status === 'forbidden') {
                this.snackBar.open(`Agent ${state.status}`, 'Close', {duration: 3000});
                this.agentDetails.set(null);
            } else { // idle or loading
                this.agentDetails.set(null);
            }
        });
    }

    loadAgentDetails(): void {
        const currentAgentId = this.agentId();
        if (!currentAgentId) {
            this.agentDetails.set(null);
            this.agentService.clearSelectedAgentDetails(); // Ensure service state is idle
            return;
        }
        // agentDetails signal is updated by the effect reacting to agentService.selectedAgentDetailsState()
        this.agentService.loadAgentDetails(currentAgentId);
    }
}
