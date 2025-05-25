import { Injectable } from '@angular/core';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Observable, BehaviorSubject, throwError } from 'rxjs';
import { tap, shareReplay, map, catchError, retry } from 'rxjs/operators';

export interface LLM {
  id: string;
  name: string;
  isConfigured: boolean;
}

@Injectable({
  providedIn: 'root',
})
export class LlmService {
  private llmsSubject = new BehaviorSubject<LLM[]>([]);
  private llmsLoaded = false;

  constructor(private http: HttpClient) {}

  getLlms(): Observable<LLM[]> {
    if (!this.llmsLoaded) {
      return this.fetchLlms().pipe(
        tap((llms) => {
          this.llmsSubject.next(llms);
          this.llmsLoaded = true;
        }),
        shareReplay(1)
      );
    }
    return this.llmsSubject.asObservable();
  }

  private fetchLlms(): Observable<LLM[]> {
    return this.http.get<{ data: LLM[] }>(`/api/llms/list`).pipe(
      map((response) => response.data),
      retry(3),
      catchError(this.handleError)
    );
  }

  clearCache() {
    this.llmsLoaded = false;
    this.llmsSubject.next([]);
    this.getLlms();
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
