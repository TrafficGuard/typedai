import { inject, Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { BehaviorSubject, Observable, throwError, of } from 'rxjs';
import { tap, catchError, map } from 'rxjs/operators';
import { CodeReviewConfig } from "#shared/model/codeReview.model";
import { callApiRoute } from '../../core/api-route';
import { CODE_REVIEW_API } from '#shared/api/code-review.api';
import {
    CodeReviewConfigCreate,
    CodeReviewConfigUpdate,
    MessageResponse,
    BulkDeleteRequest,
    CodeReviewConfigListResponse
} from '#shared/schemas/codeReview.schema';

@Injectable({
  providedIn: 'root',
})
export class CodeReviewServiceClient {
  private http = inject(HttpClient);
  private _configs$ = new BehaviorSubject<CodeReviewConfig[] | null>(null);
  private configsLoaded = false;

  get configs$(): Observable<CodeReviewConfig[] | null> {
    return this._configs$.asObservable();
  }

  getCodeReviewConfigs(): Observable<CodeReviewConfig[]> {
    if (this.configsLoaded && this._configs$.value !== null) {
      return this._configs$.pipe(map(configs => configs ?? [])) as Observable<CodeReviewConfig[]>;
    }
    return callApiRoute(this.http, CODE_REVIEW_API.list).pipe(
      tap((response: CodeReviewConfig[]) => {
        this._configs$.next(response);
        this.configsLoaded = true;
      }),
      catchError((err) => {
        console.error('Error loading code review configs:', err);
        this._configs$.next(null);
        this.configsLoaded = false;
        return throwError(() => err);
      })
    );
  }

  refreshConfigs(): Observable<CodeReviewConfig[]> {
    this.configsLoaded = false;
    this._configs$.next(null);
    return this.getCodeReviewConfigs();
  }

  getCodeReviewConfig(id: string): Observable<CodeReviewConfig> {
    return callApiRoute(this.http, CODE_REVIEW_API.getById, { pathParams: { id } });
  }

  createCodeReviewConfig(config: CodeReviewConfigCreate): Observable<MessageResponse> {
    return callApiRoute(this.http, CODE_REVIEW_API.create, { body: config }).pipe(
      tap(() => {
        this.refreshConfigs().subscribe({
          error: (err) => console.error("Failed to refresh configs after create", err)
        });
      })
    );
  }

  updateCodeReviewConfig(id: string, config: CodeReviewConfigUpdate): Observable<MessageResponse> {
    return callApiRoute(this.http, CODE_REVIEW_API.update, { pathParams: { id }, body: config }).pipe(
      tap(() => {
        this.refreshConfigs().subscribe({
          error: (err) => console.error("Failed to refresh configs after update", err)
        });
      })
    );
  }

  deleteCodeReviewConfig(id: string): Observable<MessageResponse> {
    return callApiRoute(this.http, CODE_REVIEW_API.delete, { pathParams: { id } }).pipe(
      tap(() => {
        this.refreshConfigs().subscribe({
          error: (err) => console.error("Failed to refresh configs after delete", err)
        });
      })
    );
  }

  deleteCodeReviewConfigs(ids: string[]): Observable<MessageResponse> {
    const body: BulkDeleteRequest = { ids };
    return callApiRoute(this.http, CODE_REVIEW_API.bulkDelete, { body }).pipe(
      tap(() => {
        this.refreshConfigs().subscribe({
          error: (err) => console.error("Failed to refresh configs after bulk delete", err)
        });
      })
    );
  }
}
