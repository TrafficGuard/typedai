import { Component, input } from '@angular/core';
import { AgentContextApi } from '#shared/agent/agent.schema';
import { CommonModule, KeyValuePipe } from '@angular/common';
import { MatCardModule } from '@angular/material/card';
import { MatExpansionModule } from '@angular/material/expansion';

@Component({
    selector: 'agent-function-calls',
    template: `
        <mat-card class="p-5">
            @for (invoked of agentDetails()?.functionCallHistory?.slice().reverse(); track invoked.function_name + $index) {
                <div class="pb-8">
                    <div class="mb-3 font-medium text-xl">{{ invoked.function_name }}</div>

                    @for (param of invoked.parameters | keyvalue; track param.key) {
                        <div>
                            <strong>{{ param.key }}:</strong>
                            @if (param.value?.toString().length <= 200) {
                                {{ param.value }}
                            } @else {
                                <mat-expansion-panel class="mt-4" #expansionPanel>
                                    <mat-expansion-panel-header [class.expanded-header]="expansionPanel.expanded">
                                        <mat-panel-title class="font-normal" *ngIf="!expansionPanel.expanded">
                                            {{ param.value?.toString().substring(0, 200) }}...
                                        </mat-panel-title>
                                    </mat-expansion-panel-header>
                                    <p>{{ param.value }}</p>
                                </mat-expansion-panel>
                            }
                        </div>
                    }
                    @if (invoked.stdout) {
                        <mat-expansion-panel class="mt-4">
                            <mat-expansion-panel-header>
                                <mat-panel-title>Output</mat-panel-title>
                            </mat-expansion-panel-header>
                            <p>{{ invoked.stdout }}</p>
                        </mat-expansion-panel>
                    }
                    @if (invoked.stderr) {
                        <mat-expansion-panel class="mt-4">
                            <mat-expansion-panel-header>
                                <mat-panel-title>Errors</mat-panel-title>
                            </mat-expansion-panel-header>
                            <p>{{ invoked.stderr }}</p>
                        </mat-expansion-panel>
                    }
                </div>
            }
        </mat-card>
    `,
    styles: `.mat-expansion-panel-header.mat-expanded.expanded-header {  height: 1.3em; padding-top: 1.2em; }`,
    standalone: true,
    imports: [CommonModule, MatCardModule, MatExpansionModule, KeyValuePipe],
})
export class AgentFunctionCallsComponent {
    agentDetails = input<AgentContextApi | null>(null);
}
