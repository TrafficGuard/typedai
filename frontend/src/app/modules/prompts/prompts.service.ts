import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { BehaviorSubject, Observable, of } from 'rxjs';
import { tap, map, catchError } from 'rxjs/operators';

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

    private _prompts: BehaviorSubject<PromptPreview[] | null> = new BehaviorSubject<PromptPreview[] | null>(null);
    get prompts$(): Observable<PromptPreview[] | null> { return this._prompts.asObservable(); }

    private readonly _selectedPrompt = signal<Prompt | null>(null); // Retain signal for selectedPrompt as per existing code and no change request for it
    readonly selectedPrompt = this._selectedPrompt.asReadonly();

    constructor() {
        this._loadPrompts().subscribe();
    }

    private _loadPrompts(): Observable<PromptPreview[]> {
        return callApiRoute(this.httpClient, PROMPT_API.listPrompts).pipe(
            map(response => response.prompts),
            tap((prompts: PromptPreview[]) => {
                this._prompts.next(prompts);
            }),
            catchError((error) => {
                console.error('Error loading prompts:', error);
                this._prompts.next([]); // Emit empty array on error
                return of([]); // Complete the observable chain with an empty array
            })
        );
    }

    refreshPrompts(): Observable<PromptPreview[]> {
        return this._loadPrompts();
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
        return callApiRoute(this.httpClient, PROMPT_API.deletePrompt, { pathParams: { promptId } }).pipe(
            tap(() => {
                const currentPrompts = this._prompts.getValue();
                this._prompts.next((currentPrompts || []).filter(p => p.id !== promptId));
                if (this._selectedPrompt()?.id === promptId) {
                    this._selectedPrompt.set(null);
                }
            })
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
            error: (err) => console.error('Failed to load prompt from preview', err)
        });
    }
}
