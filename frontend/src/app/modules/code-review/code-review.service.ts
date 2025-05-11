import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { CodeReviewConfig } from "#shared/model/codeReview.model";


interface Data<T> {
  data: T
}

@Injectable({
  providedIn: 'root',
})
export class CodeReviewService {
  private apiUrl = '/api/code-review-configs';

  constructor(private http: HttpClient) {}

  getCodeReviewConfigs(): Observable<Data<CodeReviewConfig[]>> {
    return this.http.get<Data<CodeReviewConfig[]>>(this.apiUrl);
  }

  getCodeReviewConfig(id: string): Observable<Data<CodeReviewConfig>> {
    return this.http.get<Data<CodeReviewConfig>>(`${this.apiUrl}/${id}`);
  }

  createCodeReviewConfig(config: Omit<CodeReviewConfig, 'id'>): Observable<string> {
    return this.http.post<string>(this.apiUrl, config);
  }

  updateCodeReviewConfig(id: string, config: Partial<CodeReviewConfig>): Observable<void> {
    return this.http.put<void>(`${this.apiUrl}/${id}`, config);
  }

  deleteCodeReviewConfig(id: string): Observable<void> {
    return this.http.delete<void>(`${this.apiUrl}/${id}`);
  }

  deleteCodeReviewConfigs(ids: string[]): Observable<void> {
    return this.http.post<void>(`${this.apiUrl}/bulk-delete`, { ids });
  }
}
