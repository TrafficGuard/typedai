import { Injectable, computed } from '@angular/core';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Observable, throwError, EMPTY } from 'rxjs';
import { tap, map, catchError, retry } from 'rxjs/operators';
import { toObservable } from '@angular/core/rxjs-interop';
import { createApiListState, ApiListState } from '../core/api-state.types';

export interface LLM {
  id: string;
  name: string;
  isConfigured: boolean;
}

@Injectable({
  providedIn: 'root',
})
export class LlmService {
  private readonly _llmsState = createApiListState<LLM>();
  readonly llmsState = this._llmsState.asReadonly();

  constructor(private http: HttpClient) {}

  loadLlms(): void {
    if (this._llmsState().status === 'loading') return;

    this._llmsState.set({ status: 'loading' });

    this.fetchLlms().pipe(
      tap((llms: LLM[]) => {
        this._llmsState.set({ status: 'success', data: llms });
      }),
      catchError((error: HttpErrorResponse) => {
        this._llmsState.set({
          status: 'error',
          error: error instanceof Error ? error : new Error('Failed to load LLMs'),
          code: error.status
        });
        return EMPTY;
      })
    ).subscribe();
  }

  getLlms(): Observable<LLM[]> {
    this.loadLlms();
    return this.llms$;
  }

  private fetchLlms(): Observable<LLM[]> {
    return this.http.get<{ data: LLM[] }>(`/api/llms/list`).pipe(
      map((response) => response.data),
      retry(3),
      catchError(this.handleError)
    );
  }

  refreshLlms(): void {
    this.loadLlms();
  }

  clearCache() {
    this.refreshLlms();
  }

  get llms$(): Observable<LLM[]> {
    const llmsSignal = computed(() => {
      const state = this._llmsState();
      return state.status === 'success' ? state.data : [];
    });
    return toObservable(llmsSignal);
  }

  private handleError(error: HttpErrorResponse) {
    let errorMessage = 'An error occurred';
    if (error.error instanceof ErrorEvent) {
      // Client-side error
      errorMessage = `Error: ${error.error.message}`;
    } else {
      // Server-side error
      errorMessage = `Error Code: ${error.status}\nMessage: ${error.message}`;
    }
    console.error(errorMessage);
    return throwError(() => new Error(errorMessage));
  }
}
