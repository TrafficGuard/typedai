import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { EMPTY, Observable, of, throwError } from 'rxjs';
import { catchError, map, tap } from 'rxjs/operators';
import { CODE_REVIEW_API } from '#shared/codeReview/codeReview.api';
import { CodeReviewConfig } from '#shared/codeReview/codeReview.model';
import {
	BulkDeleteRequest,
	CodeReviewConfigCreate,
	CodeReviewConfigListResponse,
	CodeReviewConfigUpdate,
	MessageResponse,
} from '#shared/codeReview/codeReview.schema';
import { callApiRoute } from '../../core/api-route';
import { ApiListState, createApiListState } from '../../core/api-state.types';

@Injectable({
	providedIn: 'root',
})
export class CodeReviewServiceClient {
	private http = inject(HttpClient);
	private readonly _configsState = createApiListState<CodeReviewConfig>();
	readonly configsState = this._configsState.asReadonly();

	private loadConfigs(): void {
		const currentState = this._configsState();
		if (currentState.status === 'success') {
			return; // Data already successfully loaded
		}
		if (currentState.status === 'loading') {
			return; // Already loading
		}

		this._configsState.set({ status: 'loading' });

		callApiRoute(this.http, CODE_REVIEW_API.list)
			.pipe(
				tap((configs) => {
					this._configsState.set({ status: 'success', data: configs });
				}),
				catchError((error) => {
					this._configsState.set({
						status: 'error',
						error: error instanceof Error ? error : new Error('Failed to load configs'),
						code: error?.status,
					});
					return EMPTY;
				}),
			)
			.subscribe();
	}

	getCodeReviewConfigs(): void {
		this.loadConfigs();
	}

	refreshConfigs(): void {
		this._configsState.set({ status: 'idle' }); // Reset state to force reload
		this.loadConfigs();
	}

	getCodeReviewConfig(id: string): Observable<CodeReviewConfig> {
		return callApiRoute(this.http, CODE_REVIEW_API.getById, { pathParams: { id } });
	}

	createCodeReviewConfig(config: CodeReviewConfigCreate): Observable<MessageResponse> {
		return callApiRoute(this.http, CODE_REVIEW_API.create, { body: config }).pipe(
			tap((response) => {
				const currentState = this._configsState();
				if (currentState.status === 'success') {
					// Note: Assuming the API returns the created config in the response
					// If not, we would need to reload the entire list
					this.loadConfigs();
				}
			}),
		);
	}

	updateCodeReviewConfig(id: string, config: CodeReviewConfigUpdate): Observable<MessageResponse> {
		return callApiRoute(this.http, CODE_REVIEW_API.update, { pathParams: { id }, body: config }).pipe(
			tap(() => {
				const currentState = this._configsState();
				if (currentState.status === 'success') {
					const updatedConfigs = currentState.data.map((c) => (c.id === id ? { ...c, ...config } : c));
					this._configsState.set({ status: 'success', data: updatedConfigs });
				}
			}),
		);
	}

	deleteCodeReviewConfig(id: string): Observable<MessageResponse> {
		return callApiRoute(this.http, CODE_REVIEW_API.delete, { pathParams: { id } }).pipe(
			tap(() => {
				const currentState = this._configsState();
				if (currentState.status === 'success') {
					const filteredConfigs = currentState.data.filter((c) => c.id !== id);
					this._configsState.set({ status: 'success', data: filteredConfigs });
				}
			}),
		);
	}

	deleteCodeReviewConfigs(ids: string[]): Observable<MessageResponse> {
		const body: BulkDeleteRequest = { ids };
		return callApiRoute(this.http, CODE_REVIEW_API.bulkDelete, { body }).pipe(
			tap(() => {
				const currentState = this._configsState();
				if (currentState.status === 'success') {
					const filteredConfigs = currentState.data.filter((c) => !ids.includes(c.id));
					this._configsState.set({ status: 'success', data: filteredConfigs });
				}
			}),
		);
	}
}
