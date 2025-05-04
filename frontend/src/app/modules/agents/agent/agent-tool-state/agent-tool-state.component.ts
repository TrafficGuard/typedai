import { ChangeDetectionStrategy, Component, Input, OnInit, ChangeDetectorRef, OnChanges, SimpleChanges } from '@angular/core';
import { AgentService } from '../../services/agent.service';
import {AgentContext, FileMetadata} from '../../agent.types';
import { CommonModule } from '@angular/common';
import { MatTableModule } from '@angular/material/table';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';

@Component({
    selector: 'agent-tool-state',
    templateUrl: './agent-tool-state.component.html',
    // styleUrls: ['./agent-file-store.component.scss'], // Optional: Add styles if needed
    changeDetection: ChangeDetectionStrategy.OnPush,
    standalone: true,
    imports: [
        CommonModule,
        MatTableModule,
        MatProgressSpinnerModule,
        MatSnackBarModule,
    ],
})
export class AgentToolStateComponent implements OnInit, OnChanges {
    @Input() agentDetails!: AgentContext;

    // FileStore fields
    files: FileMetadata[] = [];
    liveFiles: string[] = [];

    displayedColumns: string[] = ['filename', 'description', 'size', 'lastUpdated'];

    constructor(
        private agentService: AgentService,
        private _changeDetectorRef: ChangeDetectorRef,
        private _snackBar: MatSnackBar
    ) {}

    ngOnInit(): void {
        // Initial load handled by ngOnChanges
    }

    ngOnChanges(changes: SimpleChanges): void {
        // Check if agentDetails input has changed and has a current value
        if (changes['agentDetails'] && changes['agentDetails'].currentValue) {
            const toolStateMap = this.agentDetails?.toolState;

            if (toolStateMap) {
                // Safely get LiveFilesState, default to empty array if not found
                // Assuming LiveFilesState is string[] based on usage
                this.liveFiles = (toolStateMap.get('LiveFiles') as string[]) || [];

                // Safely get FileStoreState, default to empty array if not found
                // Assuming FileStoreState is FileMetadata[] based on usage
                this.files = (toolStateMap.get('FileStore') as FileMetadata[]) || [];
            } else {
                // Reset if toolState is not available
                this.liveFiles = [];
                this.files = [];
            }
        } else {
             // Reset if agentDetails is not available (e.g., initially or set to null/undefined)
             this.liveFiles = [];
             this.files = [];
        }

        // Trigger change detection as we might have updated the arrays
        this._changeDetectorRef.markForCheck();
    }
}
