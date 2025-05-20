import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, ChangeDetectorRef, Component, Input, OnChanges, OnInit, SimpleChanges } from '@angular/core';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatTableModule } from '@angular/material/table';
import { AgentContextApi } from '#shared/schemas/agent.schema';
import { FileMetadata } from '#shared/model/files.model';
import { AgentService } from '../../services/agent.service'; // Changed from 'import type'

@Component({
	selector: 'agent-tool-state',
	templateUrl: './agent-tool-state.component.html',
	// styleUrls: ['./agent-file-store.component.scss'], // Optional: Add styles if needed
	changeDetection: ChangeDetectionStrategy.OnPush,
	standalone: true,
	imports: [CommonModule, MatTableModule, MatProgressSpinnerModule, MatSnackBarModule],
})
export class AgentToolStateComponent implements OnInit, OnChanges {
	@Input() agentDetails!: AgentContextApi;

	// FileStore fields
	fileStore: FileMetadata[] = [];
	liveFiles: string[] = [];

	displayedColumns: string[] = ['filename', 'description', 'size', 'lastUpdated'];

	constructor(
		private agentService: AgentService,
		private _changeDetectorRef: ChangeDetectorRef,
		private _snackBar: MatSnackBar,
	) {}

	ngOnInit(): void {
		// Initial load handled by ngOnChanges
	}

	ngOnChanges(changes: SimpleChanges): void {
		// Check if agentDetails input has changed and has a current value
		if (changes.agentDetails?.currentValue) {
			// Use direct properties if available, otherwise default to empty arrays
			this.liveFiles = this.agentDetails.liveFiles || [];
			this.fileStore = this.agentDetails.fileStore || [];
		} else {
			// Reset if agentDetails is not available (e.g., initially or set to null/undefined)
			this.liveFiles = [];
			this.fileStore = [];
		}

		// Trigger change detection as we might have updated the arrays
		this._changeDetectorRef.markForCheck();
	}
}
