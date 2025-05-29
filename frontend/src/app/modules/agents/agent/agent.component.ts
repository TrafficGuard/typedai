// MatCardModule, MatFormFieldModule etc. are not directly used by AgentComponent's template, but by its children.
// Children will import them.
import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, DestroyRef, ViewEncapsulation, computed, effect, inject, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTabsModule } from '@angular/material/tabs';
import { ActivatedRoute, RouterModule } from '@angular/router';
import { distinctUntilChanged, filter, map, tap } from 'rxjs/operators';
import { AgentContextApi } from '#shared/agent/agent.schema';
import { AgentService } from '../agent.service';
import { AgentDetailsComponent } from './agent-details/agent-details.component';
import { AgentFunctionCallsComponent } from './agent-function-calls/agent-function-calls.component';
import { AgentIterationsComponent } from './agent-iterations/agent-iterations.component';
import { AgentLlmCallsComponent } from './agent-llm-calls/agent-llm-calls.component';
import { AgentMemoryComponent } from './agent-memory/agent-memory.component';
import { AgentToolStateComponent } from './agent-tool-state/agent-tool-state.component';

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
	private route = inject(ActivatedRoute);
	private snackBar = inject(MatSnackBar);
	private agentService = inject(AgentService);
	private destroyRef = inject(DestroyRef);

	agentDetails = computed(() => {
		const state = this.agentService.selectedAgentDetailsState();
		console.log(`AgentComponent: Computed (State Sync) - agentService.selectedAgentDetailsState() changed. Status: ${state.status}`);

		if (state.status === 'success') {
			const apiDetails = state.data;
			const details = { ...apiDetails };
			details.toolState = details.toolState ?? {};
			details.output = null;
			if (details.state === 'completed') {
				const maybeCompletedFunctionCall = details.functionCallHistory?.length ? details.functionCallHistory.slice(-1)[0] : null;
				details.output = details.error ?? maybeCompletedFunctionCall?.parameters?.note ?? '';
			}
			console.log(
				'AgentComponent: Computed (State Sync) - Agent Details Processed and Set from Service State. New local agentDetails:',
				JSON.stringify(details),
			);
			return details;
		}

		console.log(`AgentComponent: Computed (State Sync) - Agent service state is '${state.status}'. Returning null.`);
		return null;
	});

	private errorState = computed(() => {
		const state = this.agentService.selectedAgentDetailsState();
		if (state.status === 'error') {
			return { type: 'error', message: 'Error loading agent details', error: state.error };
		}
		if (state.status === 'not_found') {
			return { type: 'not_found', message: 'Agent not_found' };
		}
		if (state.status === 'forbidden') {
			return { type: 'forbidden', message: 'Agent forbidden' };
		}
		return null;
	});

	constructor() {
		this.route.paramMap
			.pipe(
				map((params) => params.get('id')),
				tap((id) => console.log(`AgentComponent: paramMap emitted ID (pre-distinct): '${id}'`)),
				distinctUntilChanged(),
				tap((id) => console.log(`AgentComponent: paramMap emitted ID (post-distinct, to be processed): '${id}'`)),
				takeUntilDestroyed(this.destroyRef),
			)
			.subscribe((currentAgentIdVal) => {
				console.log(`AgentComponent: Subscription Handler - Processed agentId from paramMap: '${currentAgentIdVal}'`);
				if (currentAgentIdVal) {
					console.log(`AgentComponent: Subscription Handler - agentId is truthy ('${currentAgentIdVal}'), calling agentService.loadAgentDetails.`);
					this.agentService.loadAgentDetails(currentAgentIdVal);
				} else {
					console.log(`AgentComponent: Subscription Handler - agentId is falsy ('${currentAgentIdVal}'), calling agentService.clearSelectedAgentDetails.`);
					this.agentService.clearSelectedAgentDetails();
				}
			});

		toObservable(this.errorState)
			.pipe(
				filter((errorState) => errorState !== null),
				takeUntilDestroyed(this.destroyRef),
			)
			.subscribe((errorState) => {
				if (errorState.type === 'error') {
					console.error('AgentComponent: Error in agentService.selectedAgentDetailsState()', errorState.error);
				} else {
					console.log(`AgentComponent: Agent service state is '${errorState.type}'. Showing notification.`);
				}
				this.snackBar.open(errorState.message, 'Close', { duration: 3000 });
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
