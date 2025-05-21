import { inject, Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
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

  getCodeReviewConfigs(): Observable<CodeReviewConfigListResponse> {
    return callApiRoute(this.http, CODE_REVIEW_API.list);
  }

  getCodeReviewConfig(id: string): Observable<CodeReviewConfig> {
    return callApiRoute(this.http, CODE_REVIEW_API.getById, { pathParams: { id } });
  }

  createCodeReviewConfig(config: CodeReviewConfigCreate): Observable<MessageResponse> {
    return callApiRoute(this.http, CODE_REVIEW_API.create, { body: config });
  }

  updateCodeReviewConfig(id: string, config: CodeReviewConfigUpdate): Observable<MessageResponse> {
    return callApiRoute(this.http, CODE_REVIEW_API.update, { pathParams: { id }, body: config });
  }

  deleteCodeReviewConfig(id: string): Observable<MessageResponse> {
    return callApiRoute(this.http, CODE_REVIEW_API.delete, { pathParams: { id } });
  }

  deleteCodeReviewConfigs(ids: string[]): Observable<MessageResponse> {
    const body: BulkDeleteRequest = { ids };
    return callApiRoute(this.http, CODE_REVIEW_API.bulkDelete, { body });
  }
}
