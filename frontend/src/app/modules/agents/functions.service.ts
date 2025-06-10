import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { EMPTY, Observable } from 'rxjs';
import { catchError, retry, tap } from 'rxjs/operators';
import { createApiListState } from '../../core/api-state.types';
import { callApiRoute } from "../../core/api-route";
import { AGENT_API } from "#shared/agent/agent.api";

@Injectable({
	providedIn: 'root',
})
export class FunctionsService {
	private readonly http = inject(HttpClient);
	private readonly _functionsState = createApiListState<string>();
	readonly functionsState = this._functionsState.asReadonly();

	constructor() {}

	public getFunctions(): void {
		if (this._functionsState().status === 'loading') return;

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
        return callApiRoute(this.http, AGENT_API.getAvailableFunctions).pipe(retry(3));
    }
}
