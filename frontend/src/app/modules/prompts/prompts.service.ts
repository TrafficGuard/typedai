import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

import { callApiRoute } from '../../../core/api-route';
import { PROMPT_API } from '#shared/api/prompts.api.ts';
import type {
    PromptSchemaModel,
    PromptListSchemaModel,
    PromptCreatePayload,
    PromptUpdatePayload,
} from '#shared/schemas/prompts.schema.ts';

/** Calls the Prompt API routes */
@Injectable({ providedIn: 'root' })
export class PromptsService {
    private httpClient = inject(HttpClient);

    listPrompts(): Observable<PromptListSchemaModel> {
        return callApiRoute(this.httpClient, PROMPT_API.listPrompts);
    }

    createPrompt(payload: PromptCreatePayload): Observable<PromptSchemaModel> {
        return callApiRoute(this.httpClient, PROMPT_API.createPrompt, { body: payload });
    }

    getPromptById(promptId: string): Observable<PromptSchemaModel> {
        return callApiRoute(this.httpClient, PROMPT_API.getPromptById, { pathParams: { promptId } });
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
}
