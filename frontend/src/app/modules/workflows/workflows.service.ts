import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import {environment} from "../../../environments/environment";



@Injectable({
  providedIn: 'root',
})
export class WorkflowsService {
  constructor(private http: HttpClient) {}

  runCodeEditorImplementRequirements(workingDirectory: string, requirements: string): Observable<any> {
    return this.http.post(`/api/workflows/edit`, { workingDirectory, requirements });
  }

  runCodebaseQuery(workingDirectory: string, query: string): Observable<{ response: string }> {
    return this.http.post<{ response: string }>(`/api/workflows/query`, { workingDirectory, query });
  }

  selectFilesToEdit(workingDirectory: string, requirements: string): Observable<any> {
    return this.http.post(`/api/workflows/select-files`, { workingDirectory, requirements });
  }

  getRepositories(): Observable<string[]> {
    return this.http.get<string[]>(`/api/workflows/repositories`);
  }
}
