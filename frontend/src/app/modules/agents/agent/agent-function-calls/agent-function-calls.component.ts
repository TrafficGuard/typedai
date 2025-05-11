import { Component, Input } from '@angular/core';
import { AgentContextApi } from '#shared/api/agent.api';
import { CommonModule } from '@angular/common';
import { MatCardModule } from '@angular/material/card';
import { MatExpansionModule } from '@angular/material/expansion';

@Component({
    selector: 'agent-function-calls',
    template: `
        <mat-card class="p-5">
            <div class="pb-8" *ngFor="let invoked of agentDetails?.functionCallHistory?.slice().reverse(); let i = index">
                <div class="mb-3 font-medium text-xl">{{ invoked.function_name }}</div>
            
                <div *ngFor="let param of invoked.parameters | keyvalue">
                    <div>
                        <strong>{{ param.key }}:</strong>
                        <ng-container *ngIf="param.value?.toString().length <= 200">
                            {{ param.value }}
                        </ng-container>
                        <mat-expansion-panel *ngIf="param.value?.toString().length > 200" class="mt-4" #expansionPanel>
                            <mat-expansion-panel-header [class.expanded-header]="expansionPanel.expanded">
                                <mat-panel-title class="font-normal" *ngIf="!expansionPanel.expanded">
                                    {{ param.value?.toString().substring(0, 200) }}...
                                </mat-panel-title>
                            </mat-expansion-panel-header>
                            <p>{{ param.value }}</p>
                        </mat-expansion-panel>
                    </div>
                </div>
                <mat-expansion-panel *ngIf="invoked.stdout" class="mt-4">
                    <mat-expansion-panel-header>
                        <mat-panel-title>Output</mat-panel-title>
                    </mat-expansion-panel-header>
                    <p>{{ invoked.stdout }}</p>
                </mat-expansion-panel>
                <mat-expansion-panel *ngIf="invoked.stderr" class="mt-4">
                    <mat-expansion-panel-header>
                        <mat-panel-title>Errors</mat-panel-title>
                    </mat-expansion-panel-header>
                    <p>{{ invoked.stderr }}</p>
                </mat-expansion-panel>
            </div>
        </mat-card>
    `,
    styles: `.mat-expansion-panel-header.mat-expanded.expanded-header {  height: 1.3em; padding-top: 1.2em; }`,
    standalone: true,
    imports: [CommonModule, MatCardModule, MatExpansionModule],
})
export class AgentFunctionCallsComponent {
    @Input() agentDetails: AgentContextApi | null = null;
}
