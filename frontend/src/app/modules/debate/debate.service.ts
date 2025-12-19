/**
 * Debate Service - handles communication with the debate backend API
 *
 * This is a scaffolding stub. Full implementation TBD based on UI design.
 *
 * @module debate/service
 */

import { HttpClient } from '@angular/common/http';
import { Injectable, signal } from '@angular/core';
import { Observable, Subject } from 'rxjs';
import type {
	DebateResult,
	DebateState,
	DebateStreamEvent,
	HitlDecision,
	StartDebateRequest,
} from './models/debate.model';

@Injectable({
	providedIn: 'root',
})
export class DebateService {
	// Current debate state
	readonly currentDebate = signal<DebateState | null>(null);

	// Stream of debate events
	private eventSubject = new Subject<DebateStreamEvent>();
	readonly events$ = this.eventSubject.asObservable();

	constructor(private http: HttpClient) {}

	/**
	 * Start a new debate
	 * Returns an Observable that emits SSE events
	 */
	startDebate(request: StartDebateRequest): Observable<DebateStreamEvent> {
		// TODO: Implement SSE streaming similar to chat.service.ts
		// For now, return a placeholder
		throw new Error('Not implemented - TBD based on UI design');
	}

	/**
	 * Get the current state of a debate
	 */
	getDebateState(debateId: string): Observable<DebateState> {
		// TODO: Implement API call
		throw new Error('Not implemented - TBD based on UI design');
	}

	/**
	 * Get the result of a completed debate
	 */
	getDebateResult(debateId: string): Observable<DebateResult> {
		// TODO: Implement API call
		throw new Error('Not implemented - TBD based on UI design');
	}

	/**
	 * Submit a HITL decision when consensus cannot be reached
	 */
	submitHitlDecision(debateId: string, decision: HitlDecision): Observable<void> {
		// TODO: Implement API call
		throw new Error('Not implemented - TBD based on UI design');
	}

	/**
	 * Pause an ongoing debate
	 */
	pauseDebate(debateId: string): Observable<void> {
		// TODO: Implement API call
		throw new Error('Not implemented - TBD based on UI design');
	}

	/**
	 * Resume a paused debate
	 */
	resumeDebate(debateId: string): Observable<void> {
		// TODO: Implement API call
		throw new Error('Not implemented - TBD based on UI design');
	}

	/**
	 * Cancel an ongoing debate
	 */
	cancelDebate(debateId: string): Observable<void> {
		// TODO: Implement API call
		throw new Error('Not implemented - TBD based on UI design');
	}

	/**
	 * List recent debates
	 */
	listDebates(): Observable<DebateState[]> {
		// TODO: Implement API call
		throw new Error('Not implemented - TBD based on UI design');
	}
}
