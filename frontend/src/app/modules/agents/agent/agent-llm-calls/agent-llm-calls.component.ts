import { CommonModule } from '@angular/common';
import { Component, Input, type OnInit } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatExpansionModule } from '@angular/material/expansion';
import { MatIconModule } from '@angular/material/icon';
import { MatSnackBar } from '@angular/material/snack-bar';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { environment } from 'environments/environment';
import type { LlmMessage } from '#shared/model/llm.model';
import type { LlmCall } from '#shared/model/llmCall.model';
import { AgentService } from '../../services/agent.service';
import { Router } from '@angular/router';
import type { Prompt } from '#shared/model/prompts.model';

@Component({
	selector: 'agent-llm-calls',
	templateUrl: './agent-llm-calls.component.html',
	styleUrl: 'agent-llm-calls.component.scss',
	standalone: true,
	imports: [CommonModule, MatCardModule, MatIconModule, MatExpansionModule, MatButtonModule],
})
export class AgentLlmCallsComponent implements OnInit {
	@Input() agentId: string | null = null;
	llmCalls: LlmCall[] = [];

	constructor(
		private sanitizer: DomSanitizer,
		private snackBar: MatSnackBar,
		private agentService: AgentService,
		private router: Router // Inject Router
	) {}

	ngOnInit(): void {
		if (this.agentId) {
			this.loadLlmCalls();
		}
	}

	loadLlmCalls(): void {
		this.agentService.getLlmCalls(this.agentId).subscribe(
			(calls) => {
				this.llmCalls = calls;
				this.llmCalls.forEach((call) => {
					for (const msg of call.messages) {
						if (typeof msg.content === 'string') msg.content = msg.content.replace('\\n', '<br/>');
					}
                    // Add any error as a message for display
                    if(call.error) {
                        (call.messages as LlmMessage[]).push({role: 'error', content: call.error} as unknown as LlmMessage)
                    }
				});
			},
			(error) => {
				console.error('Error loading LLM calls', error);
				this.snackBar.open('Error loading LLM calls', 'Close', {
					duration: 3000,
				});
			},
		);
	}

	isStringContent(content: any): content is string {
		return typeof content === 'string';
	}

	isArrayContent(content: any): content is Array<{ type: string; [key: string]: any }> {
		return Array.isArray(content);
	}

	// Helper to cast content to array for the template loop
	getContentAsArray(content: any): Array<{ type: string; [key: string]: any }> {
		return content as Array<{ type: string; [key: string]: any }>;
	}

	getPreviewContent(content: LlmMessage['content']): string {
		if (this.isStringContent(content)) return content;

		if (this.isArrayContent(content)) {
			// If it's an array, try to find the first text part.
			const firstTextPart = content.find((part) => part.type === 'text');

			if (firstTextPart && firstTextPart.type === 'text') return firstTextPart.text;

			// If no text part found or it wasn't the expected type, create a generic preview
			const partTypes = content.map((part) => `[${part.type}]`).join(', ');
			return partTypes || '[Empty Content Array]';
		}
		// Default for null/undefined or unexpected types
		return '';
	}

	convertNewlinesToHtml(text: string): SafeHtml {
		text ??= '';
		return this.sanitizer.bypassSecurityTrustHtml(text.replaceAll('\\n', '<br/>').replaceAll('\\t', '&nbsp;&nbsp;&nbsp;&nbsp;'));
	}

	llmCallUrl(call: LlmCall): string {
		return `https://console.cloud.google.com/firestore/databases/${
			environment.firestoreDb || '(default)'
		}/data/panel/LlmCall/${call.id}?project=${environment.gcpProject}`;
	}

	getLlmName(llmId: string): string {
		return llmId;
	}

    openInPromptStudio(call: LlmCall): void {
        const prompt: Prompt = {
            userId: '',
            revisionId: 1,
            name: call.description || call.id,
            id: call.id,
            messages: call.messages as LlmMessage[],
            settings: {
                llmId: call.llmId,
                ...call.settings
            },
            tags: [call.id]
        };

        this.router.navigate(['/ui/prompts/new'], {
            state: { llmCallData: prompt }
        }).catch(err => console.error('Failed to navigate to Prompt Studio:', err));
    }
}
