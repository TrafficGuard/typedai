import { HttpClient } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import {
  Observable,
  throwError,
  map,
  tap,
  catchError,
  EMPTY,
} from 'rxjs';
import { callApiRoute } from '../../core/api-route';
import { createApiListState, createApiEntityState } from '../../core/api-state.types';
import { AGENT_API } from '#shared/api/agent.api';
import type { AgentContextPreview, AutonomousIteration, AutonomousIterationSummary } from '#shared/model/agent.model';
import { LlmCall, LlmCallSummary } from '#shared/model/llmCall.model';
import { Pagination } from "../../core/types";
import { AgentContextApi, AgentStartRequestSchema } from '#shared/schemas/agent.schema';
import { Static } from '@sinclair/typebox';

export type AgentStartRequestData = Static<typeof AgentStartRequestSchema>;

@Injectable({ providedIn: 'root' })
export class AgentService {
  /** Holds the list of agents */
  private readonly _agentsState = createApiListState<AgentContextPreview>();

  /** Exposes the agents as an observable */
  readonly agentsState = this._agentsState.asReadonly();

  private readonly _paginationState = signal<Pagination | null>({
        length: 0,
        size: 0,
        endIndex: 0,
        page: 0,
        lastPage: 0,
        startIndex: 0
  });
  readonly paginationState = this._paginationState.asReadonly();

  // New state properties for selected agent details, LLM calls, agent iterations, and available functions
  private readonly _selectedAgentDetailsState = createApiEntityState<AgentContextApi>();
  readonly selectedAgentDetailsState = this._selectedAgentDetailsState.asReadonly();

  private readonly _llmCallsState = createApiListState<LlmCallSummary>();
  readonly llmCallsState = this._llmCallsState.asReadonly();
  private readonly _selectedLlmCallDetailState = createApiEntityState<LlmCall>();
  readonly selectedLlmCallDetailState = this._selectedLlmCallDetailState.asReadonly();

  private readonly _agentIterationsState = createApiListState<AutonomousIterationSummary>();
  readonly agentIterationsState = this._agentIterationsState.asReadonly();
  private readonly _selectedAgentIterationDetailState = createApiEntityState<AutonomousIteration>();
  readonly selectedAgentIterationDetailState = this._selectedAgentIterationDetailState.asReadonly();

  private readonly _availableFunctionsState = createApiListState<string>();
  readonly availableFunctionsState = this._availableFunctionsState.asReadonly();

  private http = inject(HttpClient);

  constructor() {
    this.loadAgents();
  }

  /** Loads agents from the server and updates the BehaviorSubject */
  private loadAgents(): void {
    if (this._agentsState().status === 'loading') return;
    this._agentsState.set({ status: 'loading' });

    callApiRoute(this.http, AGENT_API.list).pipe(
      tap(agents => this._agentsState.set({ status: 'success', data: agents })),
      catchError(error => {
        console.error('Error fetching agents', error);
        this._agentsState.set({ status: 'error', error: error instanceof Error ? error : new Error('Failed to load agents'), code: error?.status });
        return EMPTY; // Return EMPTY to complete the observable chain gracefully
      })
    ).subscribe();
  }

  /**
   * Refreshes the agents data from the server
   */
  refreshAgents(): void {
    this.loadAgents();
  }

  /** Loads agent details */
  public loadAgentDetails(agentId: string): void {
    if (this._selectedAgentDetailsState().status === 'loading') return;
    this._selectedAgentDetailsState.set({ status: 'loading' });

    callApiRoute(this.http, AGENT_API.details, { pathParams: { agentId } }).pipe(
      tap(agentDetails => {
        this._selectedAgentDetailsState.set({ status: 'success', data: agentDetails as AgentContextApi });
      }),
      catchError(error => {
        if (error?.status === 404) {
          this._selectedAgentDetailsState.set({ status: 'not_found' });
        } else if (error?.status === 403) {
          this._selectedAgentDetailsState.set({ status: 'forbidden' });
        } else {
          this._selectedAgentDetailsState.set({ status: 'error', error: error instanceof Error ? error : new Error('Failed to load agent details'), code: error?.status });
        }
        return EMPTY;
      })
    ).subscribe();
  }

  public clearSelectedAgentDetails(): void {
    this._selectedAgentDetailsState.set({ status: 'idle' });
  }

  /** Loads LLM calls */
  public loadLlmCalls(agentId: string): void {
    if (this._llmCallsState().status === 'loading') return;
    this._llmCallsState.set({ status: 'loading' });

    // Assuming AGENT_API.getLlmCallSummaries exists and returns LlmCallSummary[]
    callApiRoute(this.http, AGENT_API.getLlmCallSummaries, { pathParams: { agentId } }).pipe(
      tap(summaries => {
        this._llmCallsState.set({ status: 'success', data: summaries as LlmCallSummary[] });
      }),
      catchError(error => {
        this._llmCallsState.set({ status: 'error', error: error instanceof Error ? error : new Error('Failed to load LLM call summaries'), code: error?.status });
        return EMPTY;
      })
    ).subscribe();
  }

  public clearLlmCalls(): void {
    this._llmCallsState.set({ status: 'idle' });
  }

  public loadLlmCallDetail(agentId: string, llmCallId: string): void {
    if (this._selectedLlmCallDetailState().status === 'loading') return;
    this._selectedLlmCallDetailState.set({ status: 'loading' });

    // Assuming AGENT_API.getLlmCallDetail exists
    callApiRoute(this.http, AGENT_API.getLlmCallDetail, { pathParams: { agentId, llmCallId } }).pipe(
      tap(llmCallDetail => {
        this._selectedLlmCallDetailState.set({ status: 'success', data: llmCallDetail as LlmCall });
      }),
      catchError(error => {
        if (error?.status === 404) {
          this._selectedLlmCallDetailState.set({ status: 'not_found' });
        } else if (error?.status === 403) {
          this._selectedLlmCallDetailState.set({ status: 'forbidden' });
        } else {
          this._selectedLlmCallDetailState.set({ status: 'error', error: error instanceof Error ? error : new Error('Failed to load LLM call detail'), code: error?.status });
        }
        return EMPTY;
      })
    ).subscribe();
  }

  public clearSelectedLlmCallDetail(): void {
    this._selectedLlmCallDetailState.set({ status: 'idle' });
  }

  /** Loads iteration summaries for an autonomous agent */
  public loadAgentIterations(agentId: string): void {
    if (this._agentIterationsState().status === 'loading') return;
    this._agentIterationsState.set({ status: 'loading' });

    // Assuming AGENT_API.getIterationSummaries exists and returns AutonomousIterationSummary[]
    callApiRoute(this.http, AGENT_API.getIterationSummaries, { pathParams: { agentId } }).pipe(
      tap(summaries => {
        this._agentIterationsState.set({ status: 'success', data: summaries as AutonomousIterationSummary[] });
      }),
      catchError(error => {
        this._agentIterationsState.set({ status: 'error', error: error instanceof Error ? error : new Error('Failed to load agent iteration summaries'), code: error?.status });
        return EMPTY;
      })
    ).subscribe();
  }

  public clearAgentIterations(): void {
    this._agentIterationsState.set({ status: 'idle' });
  }

  public loadAgentIterationDetail(agentId: string, iterationNumber: number): void {
    if (this._selectedAgentIterationDetailState().status === 'loading') return;
    this._selectedAgentIterationDetailState.set({ status: 'loading' });

    // Assuming AGENT_API.getIterationDetail exists
    callApiRoute(this.http, AGENT_API.getIterationDetail, { pathParams: { agentId, iterationNumber } }).pipe(
      tap(iterationDetail => {
        this._selectedAgentIterationDetailState.set({ status: 'success', data: iterationDetail as AutonomousIteration });
      }),
      catchError(error => {
        if (error?.status === 404) {
          this._selectedAgentIterationDetailState.set({ status: 'not_found' });
        } else if (error?.status === 403) {
          this._selectedAgentIterationDetailState.set({ status: 'forbidden' });
        } else {
          this._selectedAgentIterationDetailState.set({ status: 'error', error: error instanceof Error ? error : new Error('Failed to load agent iteration detail'), code: error?.status });
        }
        return EMPTY;
      })
    ).subscribe();
  }

  public clearSelectedAgentIterationDetail(): void {
    this._selectedAgentIterationDetailState.set({ status: 'idle' });
  }

  public startAgent(payload: AgentStartRequestData): Observable<AgentContextApi> {
    return callApiRoute(this.http, AGENT_API.start, { body: payload }).pipe(
      tap(newAgentContext => this.updateAgentInCache(newAgentContext)),
      catchError(error => this.handleError('startAgent', error))
    );
  }

  /** Updates the local cache when an agent is modified */
  private updateAgentInCache(updatedAgent: AgentContextApi): void {
    const currentState = this._agentsState();
    if (currentState.status !== 'success') return; // Only update if current state is success

    const agents = currentState.data ?? []; // Existing agents are AgentContextPreview[]
    const index = agents.findIndex(agent => agent.agentId === updatedAgent.agentId);

    // Convert AgentContextApi to AgentContextPreview
    const agentPreview: AgentContextPreview = {
        agentId: updatedAgent.agentId,
        name: updatedAgent.name,
        state: updatedAgent.state,
        cost: updatedAgent.cost,
        error: updatedAgent.error, // This is correct as error is optional in both schemas
        lastUpdate: updatedAgent.lastUpdate,
        userPrompt: updatedAgent.userPrompt,
        inputPrompt: updatedAgent.inputPrompt,
        user: updatedAgent.user, // AgentContextApi.user is a string ID, matching AgentContextPreview.user
        type: updatedAgent.type,
        subtype: updatedAgent.subtype,
    };

    let newAgentList: AgentContextPreview[];
    if (index !== -1) {
        newAgentList = [...agents];
        newAgentList[index] = agentPreview; // Store the converted preview
    } else {
        // Agent not found in cache, typically means it's a new agent. Add its preview.
        newAgentList = [...agents, agentPreview]; // Store the converted preview
    }
    this._agentsState.set({ status: 'success', data: newAgentList });
  }

  /** Removes agents from the local cache */
  private removeAgentsFromCache(agentIds: string[]): void {
    const currentState = this._agentsState();
    if (currentState.status !== 'success') return; // Only update if current state is success

    const currentAgents = currentState.data ?? [];
    const updatedAgents = currentAgents.filter(agent => !agentIds.includes(agent.agentId));
    this._agentsState.set({ status: 'success', data: updatedAgents });
  }

  /** Handles errors and logs them */
  private handleError(operation: string, error: any): Observable<never> {
    console.error(`Error during ${operation}`, error);
    return throwError(error);
  }

  /** Submits feedback and updates the local cache */
  submitFeedback(agentId: string, executionId: string, feedback: string): Observable<AgentContextApi> {
    return callApiRoute(this.http, AGENT_API.feedback, { body: { agentId, executionId, feedback } }).pipe(
      tap(updatedAgent => this.updateAgentInCache(updatedAgent)),
      catchError(error => this.handleError('submitFeedback', error))
    );
  }

  /** Requests a Human-in-the-Loop check for an agent */
  requestHilCheck(agentId: string, executionId: string): Observable<AgentContextApi> {
    return callApiRoute(this.http, AGENT_API.requestHil, { body: { agentId, executionId } }).pipe(
      tap(updatedAgent => this.updateAgentInCache(updatedAgent)),
      catchError(error => this.handleError('requestHilCheck', error))
    );
  }

  /** Resumes an agent and updates the local cache */
  resumeAgent(agentId: string, executionId: string, feedback: string): Observable<AgentContextApi> {
    return callApiRoute(this.http, AGENT_API.resumeHil, { body: { agentId, executionId, feedback } }).pipe(
      tap(updatedAgent => this.updateAgentInCache(updatedAgent)),
      catchError(error => this.handleError('resumeAgent', error))
    );
  }

  /** Cancels an agent and updates the local cache */
  cancelAgent(agentId: string, executionId: string, reason: string): Observable<AgentContextApi> {
    return callApiRoute(this.http, AGENT_API.cancel, { body: { agentId, executionId, reason } }).pipe(
      tap(updatedAgent => this.updateAgentInCache(updatedAgent)),
      catchError(error => this.handleError('cancelAgent', error))
    );
  }

  /** Updates agent functions and updates the local cache */
  updateAgentFunctions(agentId: string, functions: string[]): Observable<AgentContextApi> {
    return callApiRoute(this.http, AGENT_API.updateFunctions, { body: { agentId, functions } }).pipe(
      tap(updatedAgent => this.updateAgentInCache(updatedAgent)),
      catchError(error => this.handleError('updateAgentFunctions', error))
    );
  }

  /** Deletes agents and updates the local cache */
  deleteAgents(agentIds: string[]): Observable<void> {
    return callApiRoute(this.http, AGENT_API.delete, { body: { agentIds } }).pipe(
      tap(() => this.removeAgentsFromCache(agentIds)),
      catchError(error => this.handleError('deleteAgents', error))
    );
  }

  /** Resumes an agent from error and updates the local cache */
  resumeError(agentId: string, executionId: string, feedback: string): Observable<AgentContextApi> {
    return callApiRoute(this.http, AGENT_API.resumeError, { body: { agentId, executionId, feedback } }).pipe(
      tap(updatedAgent => this.updateAgentInCache(updatedAgent)),
      catchError(error => this.handleError('resumeError', error))
    );
  }

  /** Resumes a completed agent and updates the local cache */
  resumeCompletedAgent(agentId: string, executionId: string, instructions: string): Observable<AgentContextApi> {
    return callApiRoute(this.http, AGENT_API.resumeCompleted, { body: { agentId, executionId, instructions } }).pipe(
      tap(updatedAgent => this.updateAgentInCache(updatedAgent)),
      catchError(error => this.handleError('resumeCompletedAgent', error))
    );
  }

  /** Forcibly stops an agent */
  forceStopAgent(agentId: string): Observable<void> {
    return callApiRoute(this.http, AGENT_API.forceStop, { body: { agentId } }).pipe(
      // Note: No cache update needed here as the backend route doesn't return updated agent state.
      // The caller should refresh agent details if needed after a successful call.
      catchError(error => this.handleError('forceStopAgent', error))
    );
  }

  /** Retrieves the list of available agent functions, filtered and sorted */
  public loadAvailableFunctions(): void {
    if (this._availableFunctionsState().status === 'loading' || this._availableFunctionsState().status === 'success') return;
    this._availableFunctionsState.set({ status: 'loading' });

    callApiRoute(this.http, AGENT_API.getAvailableFunctions).pipe(
      map((response: string[]) => {
        // console.log('AgentService: fetched functions raw', response); // Retain existing comments if any, this one seems like a debug log
        const filteredAndSortedFunctions = response
          .filter((name) => name !== 'Agent')
          .sort();
        // console.log('AgentService: filtered and sorted functions', filteredAndSortedFunctions); // Retain existing comments if any
        return filteredAndSortedFunctions;
      }),
      tap(functions => {
        this._availableFunctionsState.set({ status: 'success', data: functions });
      }),
      catchError(error => {
        this._availableFunctionsState.set({ status: 'error', error: error instanceof Error ? error : new Error('Failed to load available functions'), code: error?.status });
        return EMPTY;
      })
    ).subscribe();
  }

  public clearAvailableFunctions(): void {
    this._availableFunctionsState.set({ status: 'idle' });
  }
}
