import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { CodeReviewConfig } from "#shared/model/codeReview.model";
import { callApiRoute } from '../../core/api-route';
import { CODE_REVIEW_API } from '#shared/api/codeReview.api';
import { CodeReviewConfigCreate, CodeReviewConfigUpdate } from '#shared/schemas/codeReview.schema';

@Injectable({
  providedIn: 'root',
})
export class CodeReviewServiceClient {
  constructor(private http: HttpClient) {}

  getCodeReviewConfigs(): Observable<CodeReviewConfig[]> {
    return callApiRoute(this.http, CODE_REVIEW_API.list);
  }

  getCodeReviewConfig(id: string): Observable<CodeReviewConfig> {
    return callApiRoute(this.http, CODE_REVIEW_API.getById, { pathParams: { id } });
  }

  createCodeReviewConfig(config: CodeReviewConfigCreate): Observable<{ message: string }> {
    return callApiRoute(this.http, CODE_REVIEW_API.create, { body: config });
  }

  updateCodeReviewConfig(id: string, config: CodeReviewConfigUpdate): Observable<{ message: string }> {
    return callApiRoute(this.http, CODE_REVIEW_API.update, { pathParams: { id }, body: config });
  }

  deleteCodeReviewConfig(id: string): Observable<{ message: string }> {
    return callApiRoute(this.http, CODE_REVIEW_API.delete, { pathParams: { id } });
  }

  // TODO: Refactor to use callApiRoute once a 'bulkDelete' endpoint is added to CODE_REVIEW_API.
  deleteCodeReviewConfigs(ids: string[]): Observable<void> {
    return this.http.post<void>('/api/code-review-configs/bulk-delete', { ids });
  }
}
