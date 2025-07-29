import { CommonModule, KeyValuePipe } from '@angular/common'; // NgForOf, NgIf are part of CommonModule
import { Component, input, signal } from '@angular/core';
import { MatCardModule } from '@angular/material/card';
import { MatExpansionModule } from '@angular/material/expansion';
import { AgentContextApi } from '#shared/agent/agent.schema';
import { MarkdownModule, provideMarkdown } from 'ngx-markdown';

@Component({
	selector: 'agent-memory',
	templateUrl: './agent-memory.component.html',
	providers: [provideMarkdown()],
	imports: [
		CommonModule, // Includes NgForOf, NgIf
		MatCardModule,
		MarkdownModule,
		MatExpansionModule,
		KeyValuePipe,
	],
})
export class AgentMemoryComponent {
	agentDetails = input<AgentContextApi | null>(null);
	memoryExpanded = signal<{ [key: string]: boolean }>({});

	convertMemoryValue(value: any): string {
		// Stringify the value with pretty printing
		const jsonString = JSON.stringify(value, null, 2);
		// Replace escaped newlines (\\n) from JSON stringification with actual newlines (\n)
		const stringWithNewlines = jsonString.replace(/\\n/g, '\n');
		// Replace actual newlines (\n) with HTML line break tags (<br/>)
		const htmlString = stringWithNewlines.replace(/\n/g, '<br/>');
		return htmlString;
	}

	toggleExpansion(key: string): void {
		this.memoryExpanded.update((current) => ({
			...current,
			[key]: !current[key],
		}));
	}
}
