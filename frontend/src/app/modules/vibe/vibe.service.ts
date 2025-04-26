import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { BehaviorSubject, map, Observable, of, switchMap, tap, throwError } from 'rxjs';
import { VibeSession } from './vibe.types';
import type { SelectedFile } from '#swe/discovery/selectFilesAgent'; // Import SelectedFile type if needed elsewhere, or remove if only used in vibe.types
import { GitProject } from '../../../../../src/functions/scm/gitProject'; // Adjust path as needed - Assuming this path is correct relative to the frontend structure

// Define the shape of the data needed for creation, matching the backend API body
export interface CreateVibeSessionPayload {
	title: string;
	instructions: string;
	repositorySource: 'local' | 'github' | 'gitlab';
	repositoryId: string;
	repositoryName?: string | null;
	branch: string;
	newBranchName?: string | null;
	useSharedRepos: boolean;
}

@Injectable({
	providedIn: 'root',
})
export class VibeService {
	// BehaviorSubject to hold the currently viewed/active session
	private currentSession = new BehaviorSubject<VibeSession | null>(null);

	private http = inject(HttpClient); // Use inject

	/**
	 * Observable for the currently active VibeSession.
	 */
	get currentSession$(): Observable<VibeSession | null> {
		return this.currentSession.asObservable();
	}

	/**
	 * Getter for sessions (if using BehaviorSubject) - Keep commented out unless needed
	 */
	// get sessions$(): Observable<VibeSession[]> {
	//     return this.sessions.asObservable();
	// }

	/**
	 * Fetches the list of Vibe sessions from the backend.
	 */
	listVibeSessions(): Observable<VibeSession[]> {
		return this.http.get<VibeSession[]>('/api/vibe/sessions').pipe(
			// Optional: tap to update BehaviorSubject if used
			// tap((response: VibeSession[]) => {
			//     this.sessions.next(response);
			// })
		);
	}

	/**
	 * Creates a new Vibe session via the backend API.
	 * @param data The data required to create the session.
	 * @returns An Observable emitting the newly created VibeSession.
	 */
	createVibeSession(data: CreateVibeSessionPayload): Observable<VibeSession> {
		return this.http.post<VibeSession>('/api/vibe/create', data);
		// No need for tap/BehaviorSubject update here unless caching is specifically required for creation results
	}

	/**
	 * Fetches the list of available SCM projects (GitHub, GitLab) from the backend.
	 */
	getScmProjects(): Observable<GitProject[]> {
		return this.http.get<GitProject[]>('/api/scm/projects');
	}

	/**
	 * Fetches the list of branches for a given SCM project ID.
	 * @param projectId The ID of the SCM project.
	 */
	getScmBranches(projectId: string | number): Observable<string[]> {
		return this.http.get<string[]>(`/api/scm/branches?projectId=${projectId}`);
	}

	/**
	 * Fetches a specific Vibe session by its ID from the backend.
	 * @param id The ID of the Vibe session.
	 */
	getVibeSession(id: string): Observable<VibeSession> {
		return this.http.get<VibeSession>(`/api/vibe/sessions/${id}`).pipe(
			tap((session) => {
				// Update the BehaviorSubject with the fetched session
				this.currentSession.next(session);
			}),
		);
	}

	// Remove or adapt old methods (getVibe, listVibes, deleteVibe) if they are no longer relevant
	// to the VibeListComponent's new purpose or if they target different endpoints/data.
	// For example, if getVibe was for the chat view, it might be removed from here
	// or kept if another component uses it.

	// --- Example of removing old methods/properties ---
	// private vibe: BehaviorSubject<any> = new BehaviorSubject(null); // Remove if not needed
	// private vibes: BehaviorSubject<any[]> = new BehaviorSubject<any[]>(null); // Remove if not needed
	// get vibe$(): Observable<any> { return this.vibe.asObservable(); } // Remove
	// get vibes$(): Observable<any[]> { return this.vibes.asObservable(); } // Remove
	// listVibes(): Observable<any> { ... } // Remove or rename if it serves a different purpose
	// deleteVibe(id: string): Observable<any> { ... } // Remove or adapt
	// getVibe(id: string): Observable<any> { ... } // Remove or adapt
	// --- End Example ---
}
