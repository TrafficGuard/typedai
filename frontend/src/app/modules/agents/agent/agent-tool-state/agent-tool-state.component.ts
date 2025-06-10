import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTableModule } from '@angular/material/table';
import { AgentContextApi } from '#shared/agent/agent.schema';
import { FileMetadata } from '#shared/files/files.model';

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

	liveFiles = computed(() => this.agentDetails()?.toolState.LiveFiles || []);
	fileStore = computed(() => this.agentDetails()?.toolState.FileStore || []);

	displayedColumns: string[] = ['filename', 'description', 'size', 'lastUpdated'];
}
