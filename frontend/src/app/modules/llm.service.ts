import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { EMPTY } from 'rxjs';
import { catchError, tap } from 'rxjs/operators';
import { createApiListState } from '../core/api-state.types';
import { callApiRoute } from 'app/core/api-route';
import { LLMS_API } from '#shared/llm/llm.api';
import { LlmInfo } from '#shared/llm/llm.model';

@Injectable({
	providedIn: 'root',
})
export class LlmService {
	private readonly httpClient = inject(HttpClient);

	private readonly _llmsState = createApiListState<LlmInfo>();
	readonly llmsState = this._llmsState.asReadonly();

	loadLlms(force = false): void {
		if (!force && (this._llmsState().status === 'loading' || this._llmsState().status === 'success')) return;

		this._llmsState.set({ status: 'loading' });

		callApiRoute(this.httpClient, LLMS_API.list)
			.pipe(
				tap((response) => {
					this._llmsState.set({ status: 'success', data: response.data });
				}),
				catchError((error: HttpErrorResponse) => {
					this._llmsState.set({
						status: 'error',
						error: error instanceof Error ? error : new Error('Failed to load LLMs'),
						code: error.status,
					});
					return EMPTY;
				}),
			)
			.subscribe();
	}

	refreshLlms(): void {
		this.loadLlms(true);
	}

	clearCache() {
		this.refreshLlms();
	}
}
