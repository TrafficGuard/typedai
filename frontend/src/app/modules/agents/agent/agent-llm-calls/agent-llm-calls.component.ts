import { CommonModule } from '@angular/common';
import { Component, input, inject, computed, signal, DestroyRef, WritableSignal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatExpansionModule } from '@angular/material/expansion';
import { MatIconModule } from '@angular/material/icon';
import { MatSnackBar } from '@angular/material/snack-bar';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { distinctUntilChanged, filter } from 'rxjs/operators';
// import { environment } from 'environments/environment'; // Not used directly
import { LlmMessage, LlmCallMessageSummaryPart } from '#shared/model/llm.model';
import { LlmCall, LlmCallSummary } from '#shared/model/llmCall.model';
import { AgentService } from '../../agent.service';
import { Router } from '@angular/router';
import { Prompt as AppPrompt } from '#shared/model/prompts.model'; // Use an alias if 'Prompt' is ambiguous
import { AgentLinks, GoogleCloudLinks } from "../../agent-links";

@Component({
	selector: 'agent-llm-calls',
	templateUrl: './agent-llm-calls.component.html',
	styleUrl: 'agent-llm-calls.component.scss',
	standalone: true,
	imports: [CommonModule, MatCardModule, MatIconModule, MatExpansionModule, MatButtonModule, MatProgressSpinnerModule],
})
export class AgentLlmCallsComponent {
	agentId = input<string | null>(null);
	readonly llmCalls = computed<LlmCallSummary[]>(() => {
        const state = this.agentService.llmCallsState();
        if (state.status === 'success') {
            return state.data; // data is LlmCallSummary[]
        }
        return []; // Default for idle, loading, or error states
    });
    agentLinks: AgentLinks = new GoogleCloudLinks();

    expandedLlmCallData = signal<Record<string, { status: 'loading' | 'success' | 'error', data?: LlmCall, error?: any }>>({});

	private sanitizer = inject(DomSanitizer);
	private snackBar = inject(MatSnackBar);
	private agentService = inject(AgentService);
	private router = inject(Router);
    private destroyRef = inject(DestroyRef);

    // Expose the state signal for the template
    readonly llmCallsStateForTemplate = this.agentService.llmCallsState;

    private llmCallsError = computed(() => {
        const state = this.agentService.llmCallsState();
        return state.status === 'error' ? state.error : null;
    });

    private detailState = computed(() => this.agentService.selectedLlmCallDetailState());

	constructor() {
        toObservable(this.agentId).pipe(
            distinctUntilChanged(),
            takeUntilDestroyed(this.destroyRef)
        ).subscribe(currentAgentId => {
            if (currentAgentId) {
                this.loadLlmCalls(currentAgentId);
            } else {
                this.agentService.clearLlmCalls();
                this.expandedLlmCallData.set({});
                this.agentService.clearSelectedLlmCallDetail(); // Assumes this method exists in AgentService
            }
        });

        toObservable(this.llmCallsError).pipe(
            filter(error => error !== null),
            takeUntilDestroyed(this.destroyRef)
        ).subscribe(error => {
            console.error('Error loading LLM calls from service state', error);
            this.snackBar.open('Error loading LLM calls', 'Close', { duration: 3000 });
        });

        toObservable(this.detailState).pipe(
            takeUntilDestroyed(this.destroyRef)
        ).subscribe(detailState => {
            if (detailState.status === 'success' && detailState.data) {
                this.expandedLlmCallData.update(s => ({
                    ...s,
                    [detailState.data.id]: { status: 'success', data: detailState.data }
                }));
            } else if (detailState.status === 'error' && detailState.error) {
                // Attempt to find which call was loading to mark its error.
                // detailState.data is not available in error state. We need to find the callId
                // by looking for a call that was in 'loading' state.
                const loadingEntry = Object.entries(this.expandedLlmCallData()).find(([, value]) => value.status === 'loading');
                if (loadingEntry) {
                    const targetCallId = loadingEntry[0];
                    this.expandedLlmCallData.update(s => ({
                        ...s,
                        [targetCallId]: { status: 'error', error: detailState.error }
                    }));
                } else {
                    console.error('LLM Call Detail Error: Could not map error to a specific call in expandedLlmCallData. Error:', detailState.error);
                }
            }
        });
    }

	loadLlmCalls(agentId: string): void {
        if (!agentId) {
            this.agentService.clearLlmCalls();
            this.expandedLlmCallData.set({});
            this.agentService.clearSelectedLlmCallDetail();
            return;
        }
		this.agentService.loadLlmCalls(agentId);
	}

    fetchLlmCallDetails(summary: LlmCallSummary): void {
        const currentAgentId = this.agentId();
        if (!currentAgentId) {
            console.warn('No agentId for LLM call details');
            return;
        }
        const callId = summary.id;
        const existingState = this.expandedLlmCallData()[callId];
        if (existingState?.status === 'loading' || existingState?.status === 'success') {
            return;
        }
        this.expandedLlmCallData.update(s => ({ ...s, [callId]: { status: 'loading' } }));
        this.agentService.loadLlmCallDetail(currentAgentId, callId);
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

	llmCallUrl(call: LlmCallSummary | LlmCall): string { // Can be summary or full call
        // Assuming AgentLinks can handle LlmCallSummary if it only needs id or common fields
        return this.agentLinks.llmCallUrl(call as LlmCall); // Cast for now, ensure llmCallUrl is flexible
	}

	getLlmName(llmId: string): string {
		return llmId; // Placeholder, ideally map to a friendly name if available
	}

    async openInPromptStudio(callInput: LlmCallSummary | LlmCall): Promise<void> {
        let fullCallData: LlmCall | undefined;

        if (!('messages' in callInput)) { // It's an LlmCallSummary
            const summary = callInput as LlmCallSummary;
            const existingDetail = this.expandedLlmCallData()[summary.id];
            if (existingDetail?.status === 'success' && existingDetail.data) {
                fullCallData = existingDetail.data;
            } else if (existingDetail?.status === 'loading') {
                this.snackBar.open('Full details are currently loading. Please wait and try again.', 'Close', { duration: 3000 });
                return;
            } else { // Not loaded or error state, try fetching
                this.fetchLlmCallDetails(summary);
                this.snackBar.open('Fetching full details for Prompt Studio. Please try again shortly.', 'Close', { duration: 3500 });
                return; // User needs to click again once loaded
            }
        } else { // It's already LlmCall
            fullCallData = callInput as LlmCall;
        }

        if (!fullCallData || !fullCallData.messages) { // Ensure messages are present
            this.snackBar.open('Could not load full LLM call details (missing messages) for Prompt Studio.', 'Close', { duration: 3000 });
            return;
        }

        const promptData: Partial<AppPrompt> = {
            name: fullCallData.description || `LLM Call ${fullCallData.id}`,
            appId: fullCallData.description || fullCallData.id, // Or a more suitable appId if available
            messages: fullCallData.messages as LlmMessage[],
            settings: {
                llmId: fullCallData.llmId,
                ...fullCallData.settings,
            },
            tags: [fullCallData.id]
        };

        console.log('AgentLlmCallsComponent: Navigating to Prompt Studio with state (llmCallData):', promptData);

        this.router.navigate(['/ui/prompts/new'], {
            state: { llmCallData: promptData } // The key is 'llmCallData'
        }).catch(err => console.error('Failed to navigate to Prompt Studio:', err));
    }
}
