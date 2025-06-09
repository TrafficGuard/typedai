import { HttpClient } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { EMPTY, type Observable } from 'rxjs';
import { catchError, map, tap } from 'rxjs/operators';

import { callApiRoute } from 'app/core/api-route';
import { ApiListState, createApiListState } from 'app/core/api-state.types';
import { CallSettings, LlmMessage } from '#shared/llm/llm.model';
import { PROMPT_API } from '#shared/prompts/prompts.api';
import { Prompt, PromptPreview } from '#shared/prompts/prompts.model';
import {
	PromptCreatePayload,
	PromptGenerateResponseSchemaModel,
	PromptListSchemaModel,
	PromptSchemaModel,
	PromptUpdatePayload,
} from '#shared/prompts/prompts.schema';

/** Calls the Prompt API routes */
@Injectable({ providedIn: 'root' })
export class PromptsService {
	private httpClient = inject(HttpClient);

	private readonly _promptsState = createApiListState<PromptPreview>();
	readonly promptsState = this._promptsState.asReadonly();

    readonly _selectedPrompt = signal<Prompt | null>(null); // Retain signal for selectedPrompt as per existing code and no change request for it
	readonly selectedPrompt = this._selectedPrompt.asReadonly();

	constructor() {
		this.loadPrompts();
	}

	public loadPrompts(): void {
		if (this._promptsState().status === 'success' || this._promptsState().status === 'loading') {
			return;
		}
		this._promptsState.set({ status: 'loading' });

		callApiRoute(this.httpClient, PROMPT_API.listPrompts)
			.pipe(
				map((response) => response.prompts),
				tap((prompts: PromptPreview[]) => {
					this._promptsState.set({ status: 'success', data: prompts });
				}),
				catchError((error) => {
					console.error('Error loading prompts:', error);
					this._promptsState.set({
						status: 'error',
						error: error instanceof Error ? error : new Error('Failed to load prompts'),
						code: error?.status,
					});
					return EMPTY;
				}),
			)
			.subscribe();
	}

	public refreshPrompts(): void {
		this._promptsState.set({ status: 'idle' });
		this.loadPrompts();
	}

	createPrompt(payload: PromptCreatePayload): Observable<PromptSchemaModel> {
		return callApiRoute(this.httpClient, PROMPT_API.createPrompt, { body: payload });
	}

	getPromptById(promptId: string): Observable<PromptSchemaModel> {
		return callApiRoute(this.httpClient, PROMPT_API.getPromptById, { pathParams: { promptId } }).pipe(
			tap((response: PromptSchemaModel) => {
				this._selectedPrompt.set(response as Prompt);
			}),
		);
	}

	getPromptRevision(promptId: string, revisionId: string): Observable<PromptSchemaModel> {
		return callApiRoute(this.httpClient, PROMPT_API.getPromptRevision, { pathParams: { promptId, revisionId } });
	}

	updatePrompt(promptId: string, payload: PromptUpdatePayload): Observable<PromptSchemaModel> {
		return callApiRoute(this.httpClient, PROMPT_API.updatePrompt, { pathParams: { promptId }, body: payload });
	}

	deletePrompt(promptId: string): Observable<void> {
		return callApiRoute(this.httpClient, PROMPT_API.deletePrompt, { pathParams: { promptId } }).pipe(
			tap(() => {
				const currentState = this._promptsState();
				if (currentState.status === 'success') {
					this._promptsState.set({ status: 'success', data: currentState.data.filter((p) => p.id !== promptId) });
				}
				if (this._selectedPrompt()?.id === promptId) {
					this._selectedPrompt.set(null);
				}
			}),
			// callApiRoute for DELETE 204 already returns Observable<void>
		);
	}

	clearSelectedPrompt(): void {
		this._selectedPrompt.set(null);
	}

	setSelectedPromptFromPreview(promptPreview: PromptPreview | null): void {
		if (promptPreview === null) {
			this._selectedPrompt.set(null);
			return;
		}
		this.getPromptById(promptPreview.id).subscribe({
			error: (err) => console.error('Failed to load prompt from preview', err),
		});
	}

	generateFromMessages(messages: LlmMessage[], options: CallSettings & { llmId?: string }): Observable<PromptGenerateResponseSchemaModel> {
		return callApiRoute(this.httpClient, PROMPT_API.generateFromMessages, {
			body: { messages, options },
		});
	}
}
