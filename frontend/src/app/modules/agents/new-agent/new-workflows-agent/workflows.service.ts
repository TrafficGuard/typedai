import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, EMPTY } from 'rxjs';
import { catchError, tap } from 'rxjs/operators';
import { createApiListState, ApiListState } from '../../../../../core/api-state.types';

@Injectable({
  providedIn: 'root',
})
export class WorkflowsService {
  private readonly httpClient = inject(HttpClient);

  private readonly _repositoriesState = createApiListState<string>();
  readonly repositoriesState = this._repositoriesState.asReadonly();

  constructor() {}

  loadRepositories(): void {
    if (this._repositoriesState().status === 'loading') {
      return;
    }

    this._repositoriesState.set({ status: 'loading' });

    this.httpClient.get<string[]>('/api/workflows/repositories').pipe(
      tap(response => {
        this._repositoriesState.set({ status: 'success', data: response });
      }),
      catchError(error => {
        this._repositoriesState.set({
          status: 'error',
          error: error instanceof Error ? error : new Error('Failed to load repositories'),
          code: error?.status
        });
        return EMPTY;
      })
    ).subscribe();
  }

  runCodeEditorImplementRequirements(workingDirectory: string, requirements: string): Observable<any> {
    return this.httpClient.post(`/api/workflows/edit`, { workingDirectory, requirements });
  }

  runCodebaseQuery(workingDirectory: string, query: string): Observable<{ response: string }> {
    return this.httpClient.post<{ response: string }>(`/api/workflows/query`, { workingDirectory, query });
  }

  selectFilesToEdit(workingDirectory: string, requirements: string): Observable<any> {
    return this.httpClient.post(`/api/workflows/select-files`, { workingDirectory, requirements });
  }
}
