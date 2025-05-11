import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import {
  BehaviorSubject,
  Observable,
  throwError,
} from 'rxjs';
import {
  catchError,
  map,
  tap,
} from 'rxjs/operators';
import { AgentContextApi } from "#shared/api/agent.api";
import {LlmCall} from "#shared/model/llmCall.model";
import {AutonomousIteration} from "#shared/model/agent.model";
import {Pagination} from "../../../core/types";


@Injectable({ providedIn: 'root' })
export class AgentService {
  /** Holds the list of agents */
  private _agents$: BehaviorSubject<AgentContextApi[]> = new BehaviorSubject<AgentContextApi[]>(null);

  /** Exposes the agents as an observable */
  public agents$ = this._agents$.asObservable();

  private _pagination: BehaviorSubject<Pagination | null> =
    new BehaviorSubject({
        length: 0,
        size: 0,
        endIndex: 0,
        page: 0,
        lastPage: 0,
        startIndex: 0
  });

  constructor(private _httpClient: HttpClient) {
    // Load initial data
    this.loadAgents();
  }

  get pagination$(): Observable<Pagination> {
      return this._pagination.asObservable();
  }

  /** Loads agents from the server and updates the BehaviorSubject */
  private loadAgents(): void {
    this._httpClient.get<{ data: AgentContextApi[] }>('/api/agent/v1/list').pipe(
      map(response => response.data || []),
      tap(agents => this._agents$.next(agents)),
      catchError(error => {
        console.error('Error fetching agents', error);
        return throwError(error);
      })
    ).subscribe();
  }

  /** Retrieves the current list of agents */
  getAgents(): Observable<AgentContextApi[]> {
    return this.agents$;
  }

  /**
   * Refreshes the agents data from the server
   */
  refreshAgents(): void {
    this.loadAgents();
  }

  /** Get agent details */
  getAgentDetails(agentId: string): Observable<AgentContextApi> {
    return this._httpClient.get<AgentContextApi>(`/api/agent/v1/details/${agentId}`).pipe(
        catchError(error => this.handleError('Load agent', error))
    );
  }

  /** Get LLM calls */
  getLlmCalls(agentId: string): Observable<LlmCall[]> {
    return this._httpClient.get<{ data: LlmCall[] }>(`/api/llms/calls/agent/${agentId}`).pipe(
      map(response => response.data || [])
    );
  }

  /** Get iterations for an autonomous agent */
  getAgentIterations(agentId: string): Observable<AutonomousIteration[]> {
    return this._httpClient.get<AutonomousIteration[]>(`/api/agent/v1/iterations/${agentId}`).pipe(
      catchError(error => this.handleError('Load agent iterations', error))
    );
  }

  /** Updates the local cache when an agent is modified */
  private updateAgentInCache(updatedAgent: AgentContextApi): void {
    const agents = this._agents$.getValue() ?? [];
    const index = agents.findIndex(agent => agent.agentId === updatedAgent.agentId) ?? -1;
    if (index !== -1) {
      const updatedAgents = [...agents];
      updatedAgents[index] = updatedAgent;
      this._agents$.next(updatedAgents);
    } else {
      // Optionally handle the case where the agent isn't found
      // For example, add the new agent to the list
      this._agents$.next([...agents, updatedAgent]);
    }
  }

  /** Removes agents from the local cache */
  private removeAgentsFromCache(agentIds: string[]): void {
    const agents = this._agents$.getValue();
    const updatedAgents = agents.filter(agent => !agentIds.includes(agent.agentId));
    this._agents$.next(updatedAgents);
  }

  /** Handles errors and logs them */
  private handleError(operation: string, error: any): Observable<never> {
    console.error(`Error during ${operation}`, error);
    return throwError(error);
  }

  /** Submits feedback and updates the local cache */
  submitFeedback(agentId: string, executionId: string, feedback: string): Observable<AgentContextApi> {
    return this._httpClient.post<AgentContextApi>(`/api/agent/v1/feedback`, { agentId, executionId, feedback }
    ).pipe(
      tap(updatedAgent => this.updateAgentInCache(updatedAgent)),
      catchError(error => this.handleError('submitFeedback', error))
    );
  }

  /** Requests a Human-in-the-Loop check for an agent */
  requestHilCheck(agentId: string, executionId: string): Observable<AgentContextApi> {
    return this._httpClient.post<AgentContextApi>(
      `/api/agent/v1/request-hil`,
      { agentId, executionId }
    ).pipe(
      tap(updatedAgent => this.updateAgentInCache(updatedAgent)),
      catchError(error => this.handleError('requestHilCheck', error))
    );
  }

  /** Resumes an agent and updates the local cache */
  resumeAgent(agentId: string, executionId: string, feedback: string): Observable<AgentContextApi> {
    return this._httpClient.post<AgentContextApi>(`/api/agent/v1/resume-hil`, { agentId, executionId, feedback }
    ).pipe(
      tap(updatedAgent => this.updateAgentInCache(updatedAgent)),
      catchError(error => this.handleError('resumeAgent', error))
    );
  }

  /** Cancels an agent and updates the local cache */
  cancelAgent(agentId: string, executionId: string, reason: string): Observable<AgentContextApi> {
    return this._httpClient.post<AgentContextApi>(`/api/agent/v1/cancel`, { agentId, executionId, reason }
    ).pipe(
      tap(updatedAgent => this.updateAgentInCache(updatedAgent)),
      catchError(error => this.handleError('cancelAgent', error))
    );
  }

  /** Updates agent functions and updates the local cache */
  updateAgentFunctions(agentId: string, functions: string[]): Observable<AgentContextApi> {
    return this._httpClient.post<AgentContextApi>(
      `/api/agent/v1/update-functions`,
      { agentId, functions }
    ).pipe(
      tap(updatedAgent => this.updateAgentInCache(updatedAgent)),
      catchError(error => this.handleError('updateAgentFunctions', error))
    );
  }

  /** Deletes agents and updates the local cache */
  deleteAgents(agentIds: string[]): Observable<any> {
    return this._httpClient.post(`/api/agent/v1/delete`, { agentIds }).pipe(
      tap(() => this.removeAgentsFromCache(agentIds)),
      catchError(error => this.handleError('deleteAgents', error))
    );
  }

  /** Resumes an agent from error and updates the local cache */
  resumeError(agentId: string, executionId: string, feedback: string): Observable<AgentContextApi> {
    return this._httpClient.post<AgentContextApi>(
      `/api/agent/v1/resume-error`,
      { agentId, executionId, feedback }
    ).pipe(
      tap(updatedAgent => this.updateAgentInCache(updatedAgent)),
      catchError(error => this.handleError('resumeError', error))
    );
  }

  /** Resumes a completed agent and updates the local cache */
  resumeCompletedAgent(agentId: string, executionId: string, instructions: string): Observable<AgentContextApi> {
    return this._httpClient.post<AgentContextApi>(
      `/api/agent/v1/resume-completed`,
      { agentId, executionId, instructions }
    ).pipe(
      tap(updatedAgent => this.updateAgentInCache(updatedAgent)),
      catchError(error => this.handleError('resumeCompletedAgent', error))
    );
  }

  /** Forcibly stops an agent */
  forceStopAgent(agentId: string): Observable<any> {
    return this._httpClient.post(`/api/agent/v1/force-stop`, { agentId }).pipe(
      // Note: No cache update needed here as the backend route doesn't return updated agent state.
      // The caller should refresh agent details if needed after a successful call.
      catchError(error => this.handleError('forceStopAgent', error))
    );
  }
}
