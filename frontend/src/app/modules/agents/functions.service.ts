import type { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, WritableSignal, signal, inject } from '@angular/core';
import { EMPTY, type Observable } from 'rxjs';
import { catchError, retry, tap } from 'rxjs/operators';
import { environment } from '../../../environments/environment';
import { ApiListState, createApiListState } from '../../core/api-state.types';

@Injectable({
	providedIn: 'root',
})
export class FunctionsService {
	private readonly http = inject(HttpClient);
	private readonly _functionsState = createApiListState<string>();
	readonly functionsState = this._functionsState.asReadonly();

	constructor() {}

	public getFunctions(): void {
		if (this._functionsState().status === 'loading') {
			return;
		}
		this._functionsState.set({ status: 'loading' });

		this.fetchFunctions()
			.pipe(
				tap((fetchedFunctions: string[]) => {
					this._functionsState.set({ status: 'success', data: fetchedFunctions });
				}),
				catchError((error: HttpErrorResponse) => {
					this._functionsState.set({
						status: 'error',
						error: error instanceof Error ? error : new Error('Failed to load functions'),
						code: error.status,
					});
					return EMPTY;
				}),
			)
			.subscribe();
	}

	private fetchFunctions(): Observable<string[]> {
		return this.http.get<string[]>(`${environment.apiBaseUrl}agent/v1/functions`).pipe(retry(3));
	}
}
