import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTableModule } from '@angular/material/table';
import { AgentContextApi } from '#shared/agent/agent.schema';
import { FileMetadata } from '#shared/files/files.model';
// AgentService is not used in this component's logic after refactor
// import { AgentService } from '../../services/agent.service';

@Component({
	selector: 'agent-tool-state',
	templateUrl: './agent-tool-state.component.html',
	// styleUrls: ['./agent-file-store.component.scss'], // Optional: Add styles if needed
	changeDetection: ChangeDetectionStrategy.OnPush,
	standalone: true,
	imports: [CommonModule, MatTableModule, MatProgressSpinnerModule],
})
export class AgentToolStateComponent {
	agentDetails = input.required<AgentContextApi>();

	liveFiles = computed(() => this.agentDetails()?.liveFiles || []);
	fileStore = computed(() => this.agentDetails()?.fileStore || []);

	displayedColumns: string[] = ['filename', 'description', 'size', 'lastUpdated'];

	// ngOnInit and ngOnChanges are no longer needed as computed signals handle derivations.
}
