import { Injectable } from '@angular/core';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Observable, BehaviorSubject, throwError } from 'rxjs';
import { tap, shareReplay, map, catchError, retry } from 'rxjs/operators';
import {environment} from "../../../../environments/environment";

@Injectable({
  providedIn: 'root',
})
export class FunctionsService {
  private functionsSubject = new BehaviorSubject<string[]>([]);
  private functionsLoaded = false;

  constructor(private http: HttpClient) {}

  getFunctions(): Observable<string[]> {
    if (!this.functionsLoaded) {
      return this.fetchFunctions().pipe(
        tap((llms) => {
          this.functionsSubject.next(llms);
          this.functionsLoaded = true;
        }),
        shareReplay(1)
      );
    }
    return this.functionsSubject.asObservable();
  }

  private fetchFunctions(): Observable<string[]> {
    return this.http.get<string[]>(`${environment.apiBaseUrl}agent/v1/functions`).pipe(
      retry(3),
      catchError(this.handleError)
    );
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
