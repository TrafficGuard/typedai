import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { CommonModule, DatePipe, JsonPipe, KeyValuePipe } from '@angular/common';
import { MatCardModule } from '@angular/material/card';
import { MatExpansionModule } from '@angular/material/expansion';
import { MatTooltipModule } from '@angular/material/tooltip';

// TODO: Verify the correct path for these shared types
import type { AgentContextApi, Iteration, LlmCall } from '#shared/agent/agent.schema';

@Component({
    selector: 'app-agent-iterations',
    templateUrl: './agent-iterations.component.html',
    styleUrls: ['./agent-iterations.component.scss'],
    standalone: true,
    imports: [
        CommonModule,
        DatePipe,
        JsonPipe,
        KeyValuePipe,
        MatExpansionModule,
        MatCardModule,
        MatTooltipModule,
    ],
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AgentIterationsComponent {
    agentDetails = input.required<AgentContextApi>();

    readonly reversedIterations = computed(() => {
        const details = this.agentDetails();
        return details && details.iterations ? details.iterations.slice().reverse() : [];
    });

    readonly llmCallMap = computed(() => {
        const details = this.agentDetails();
        const map = new Map<string, LlmCall>();
        if (details && details.llmCalls) {
            for (const call of details.llmCalls) {
                // Assuming LlmCall has a unique identifier, e.g., llmCallId
                if (call.llmCallId) {
                    map.set(call.llmCallId, call);
                }
            }
        }
        return map;
    });

    getLlmCallById(llmCallId: string): LlmCall | undefined {
        return this.llmCallMap().get(llmCallId);
    }

    trackByIterationId(index: number, iteration: Iteration): string {
        // Assuming Iteration has a unique identifier, e.g., iterationId
        return iteration.iterationId;
    }

    hasKeys(obj: object | null | undefined): boolean {
        return obj ? Object.keys(obj).length > 0 : false;
    }
}
