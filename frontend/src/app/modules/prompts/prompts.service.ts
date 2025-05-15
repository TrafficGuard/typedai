import { Injectable, inject, signal, WritableSignal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, of } from 'rxjs';
import { tap, map } from 'rxjs/operators';

import { callApiRoute } from 'app/core/api-route';
import { PROMPT_API } from '#shared/api/prompts.api';
import type {
    PromptSchemaModel,
    PromptListSchemaModel,
    PromptCreatePayload,
    PromptUpdatePayload,
} from '#shared/schemas/prompts.schema';
import type { Prompt, PromptPreview } from '#shared/model/prompts.model';

/** Calls the Prompt API routes */
@Injectable({ providedIn: 'root' })
export class PromptsService {
    private httpClient = inject(HttpClient);

    private readonly _prompts = signal<PromptPreview[] | null>(null);
    readonly prompts = this._prompts.asReadonly();
    private readonly _selectedPrompt = signal<Prompt | null>(null);
    readonly selectedPrompt = this._selectedPrompt.asReadonly();

    listPrompts(): Observable<PromptListSchemaModel> {
        return callApiRoute(this.httpClient, PROMPT_API.listPrompts);
    }

    loadPrompts(): Observable<void> {
        return this.listPrompts().pipe(
            tap((response: PromptListSchemaModel) => { this._prompts.set(response.prompts); }),
            map(() => undefined)
        );
    }

    createPrompt(payload: PromptCreatePayload): Observable<PromptSchemaModel> {
        return callApiRoute(this.httpClient, PROMPT_API.createPrompt, { body: payload });
    }

    getPromptById(promptId: string): Observable<PromptSchemaModel> {
        return callApiRoute(this.httpClient, PROMPT_API.getPromptById, { pathParams: { promptId } }).pipe(
            tap((response: PromptSchemaModel) => { this._selectedPrompt.set(response as Prompt); })
        );
    }

    getPromptRevision(promptId: string, revisionId: string): Observable<PromptSchemaModel> {
        return callApiRoute(this.httpClient, PROMPT_API.getPromptRevision, { pathParams: { promptId, revisionId } });
    }

    updatePrompt(promptId: string, payload: PromptUpdatePayload): Observable<PromptSchemaModel> {
        return callApiRoute(this.httpClient, PROMPT_API.updatePrompt, { pathParams: { promptId }, body: payload });
    }

    deletePrompt(promptId: string): Observable<void> {
        return callApiRoute(this.httpClient, PROMPT_API.deletePrompt, { pathParams: { promptId } });
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
            error: (err) => console.error('Failed to load prompt from preview', err)
        });
    }
}
