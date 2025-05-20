import { CommonModule } from '@angular/common';
import { Component, input, signal, effect, inject, WritableSignal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatExpansionModule } from '@angular/material/expansion';
import { MatIconModule } from '@angular/material/icon';
import { MatSnackBar } from '@angular/material/snack-bar';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
// import { environment } from 'environments/environment'; // Not used directly
import { LlmMessage } from '#shared/model/llm.model';
import { LlmCall } from '#shared/model/llmCall.model';
import { AgentService } from '../../services/agent.service';
import { Router } from '@angular/router';
import { Prompt as AppPrompt } from '#shared/model/prompts.model'; // Use an alias if 'Prompt' is ambiguous
import { AgentLinks, GoogleCloudLinks } from "../../services/agent-links";

@Component({
	selector: 'agent-llm-calls',
	templateUrl: './agent-llm-calls.component.html',
	styleUrl: 'agent-llm-calls.component.scss',
	standalone: true,
	imports: [CommonModule, MatCardModule, MatIconModule, MatExpansionModule, MatButtonModule],
})
export class AgentLlmCallsComponent {
	agentId = input<string | null>(null);
	llmCalls: WritableSignal<LlmCall[]> = signal([]);
    agentLinks: AgentLinks = new GoogleCloudLinks();

	private sanitizer = inject(DomSanitizer);
	private snackBar = inject(MatSnackBar);
	private agentService = inject(AgentService);
	private router = inject(Router);

	constructor() {
        effect(() => {
            const currentAgentId = this.agentId();
            if (currentAgentId) {
                this.loadLlmCalls(currentAgentId);
            } else {
                this.llmCalls.set([]);
            }
        });
    }

	loadLlmCalls(agentId: string): void {
        this.llmCalls.set([]); // Clear previous calls
		this.agentService.getLlmCalls(agentId).subscribe(
			(calls) => {
                const processedCalls = calls.map(call => {
                    // Add any error as a message for display
                    // Note: This modifies the 'messages' array that will be sent to Prompt Studio.
                    // Consider if 'error' role messages should be part of the prompt data.
                    const messagesWithError = [...(call.messages as LlmMessage[])]; // Clone to avoid direct mutation if source is shared
                    if (call.error) {
                        messagesWithError.push({role: 'error', content: call.error} as unknown as LlmMessage);
                    }
                    return { ...call, messages: messagesWithError };
                });
				this.llmCalls.set(processedCalls);
			},
			(error) => {
				console.error('Error loading LLM calls', error);
				this.snackBar.open('Error loading LLM calls', 'Close', {
					duration: 3000,
				});
                this.llmCalls.set([]); // Clear on error
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
        return this.agentLinks.llmCallUrl(call);
	}

	getLlmName(llmId: string): string {
		return llmId; // Placeholder, ideally map to a friendly name if available
	}

    openInPromptStudio(call: LlmCall): void {
        const promptData: Partial<AppPrompt> = {
            name: call.description,
            appId: call.description,
            messages: call.messages as LlmMessage[], // Already processed to include error if any
            settings: {
                llmId: call.llmId,
                ...call.settings,
            },
            tags: [call.id]
        };

        console.log('AgentLlmCallsComponent: Navigating to Prompt Studio with state (llmCallData):', promptData);

        this.router.navigate(['/ui/prompts/new'], {
            state: { llmCallData: promptData } // The key is 'llmCallData'
        }).catch(err => console.error('Failed to navigate to Prompt Studio:', err));
    }
}
