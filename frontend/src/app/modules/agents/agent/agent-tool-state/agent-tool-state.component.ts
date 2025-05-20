import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatTableModule } from '@angular/material/table';
import { AgentContextApi } from '#shared/schemas/agent.schema';
import { FileMetadata } from '#shared/model/files.model';
// AgentService is not used in this component's logic after refactor
// import { AgentService } from '../../services/agent.service';

@Component({
	selector: 'agent-tool-state',
	templateUrl: './agent-tool-state.component.html',
	// styleUrls: ['./agent-file-store.component.scss'], // Optional: Add styles if needed
	changeDetection: ChangeDetectionStrategy.OnPush,
	standalone: true,
	imports: [CommonModule, MatTableModule, MatProgressSpinnerModule, MatSnackBarModule],
})
export class AgentToolStateComponent {
	agentDetails = input.required<AgentContextApi>();

	liveFiles = computed(() => this.agentDetails()?.liveFiles || []);
	fileStore = computed(() => this.agentDetails()?.fileStore || []);

	displayedColumns: string[] = ['filename', 'description', 'size', 'lastUpdated'];

	// private agentService = inject(AgentService); // Not used
	// private _snackBar = inject(MatSnackBar); // Not used

	constructor() {}

	// ngOnInit and ngOnChanges are no longer needed as computed signals handle derivations.
}
