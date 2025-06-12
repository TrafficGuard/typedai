import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTableModule } from '@angular/material/table';
import { AgentContextApi } from '#shared/agent/agent.schema';
import { FileMetadata } from '#shared/files/files.model';

@Component({
	selector: 'agent-tool-state',
	template: `
		<ng-container *ngIf="agentDetails(); else loading">
			<div class="p-4" data-testid="agent-tool-state-container">
				<div class="mb-4" data-testid="live-files-section">
					<h3 class="text-lg font-semibold mb-2">Live Files</h3>
					<ng-container *ngIf="liveFiles().length > 0; else noLiveFiles">
						<ul class="list-disc pl-5" data-testid="live-files-list">
							<li *ngFor="let file of liveFiles(); track file">{{ file }}</li>
						</ul>
					</ng-container>
					<ng-template #noLiveFiles>
						<p data-testid="no-live-files-message">No live files available.</p>
					</ng-template>
				</div>

				<div data-testid="file-store-section">
					<h3 class="text-lg font-semibold mb-2">File Store</h3>
					<ng-container *ngIf="fileStore().length > 0; else noFileStoreEntries">
						<table mat-table [dataSource]="fileStore()" class="mat-elevation-z8 w-full" data-testid="file-store-table">
							<!-- Columns Definition -->
							<ng-container *ngFor="let column of displayedColumns" [matColumnDef]="column">
								<th mat-header-cell *matHeaderCellDef>{{ column | titlecase }}</th>
								<td mat-cell *matCellDef="let entry">{{ entry[column] }}</td>
							</ng-container>

							<tr mat-header-row *matHeaderRowDef="displayedColumns"></tr>
							<tr mat-row *matRowDef="let row; columns: displayedColumns"></tr>
						</table>
					</ng-container>
					<ng-template #noFileStoreEntries>
						<p data-testid="no-file-store-entries-message">No file store entries available.</p>
					</ng-template>
				</div>
			</div>
		</ng-container>
		<ng-template #loading>
			<div class="flex justify-center items-center h-full">
				<mat-progress-spinner mode="indeterminate" data-testid="loading-spinner"></mat-progress-spinner>
			</div>
		</ng-template>
	`,
	// styleUrls: ['./agent-file-store.component.scss'], // Optional: Add styles if needed
	changeDetection: ChangeDetectionStrategy.OnPush,
	standalone: true,
	imports: [CommonModule, MatTableModule, MatProgressSpinnerModule],
})
export class AgentToolStateComponent {
	agentDetails = input.required<AgentContextApi>();

	liveFiles = computed(() => this.agentDetails()?.toolState.LiveFiles || []);
	fileStore = computed(() => this.agentDetails()?.toolState.FileStore || []);

	displayedColumns: string[] = ['filename', 'description', 'size', 'lastUpdated'];
}
