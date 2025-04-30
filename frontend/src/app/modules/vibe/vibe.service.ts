import { HttpClient, HttpParams } from '@angular/common/http'; // Import HttpParams
import { Injectable, inject } from '@angular/core';
import { BehaviorSubject, type Observable, tap } from 'rxjs';
// Import FileSystemNode if not already imported (assuming it's defined in vibe.types.ts)
import type { FileSystemNode, GitProject, VibeSession } from './vibe.types';

// Define the shape of the data needed for creation, matching the backend API body
export interface CreateVibeSessionPayload {
	title: string;
	instructions: string;
	repositorySource: 'local' | 'github' | 'gitlab';
	repositoryId: string;
	repositoryName?: string | null;
	targetBranch: string; // Renamed from branch
	workingBranch: string; // Added
	createWorkingBranch: boolean; // Added
	useSharedRepos: boolean;
}

// Define the shape of the data needed for updating, matching the backend API body
export interface UpdateVibeSessionPayload {
	filesToAdd?: string[];
	filesToRemove?: string[];
	// Add other updatable fields as needed, e.g.:
	// instructions?: string;
	// designDecision?: 'accepted' | 'rejected';
	// variations?: number;
}

@Injectable({
	providedIn: 'root',
})
export class VibeService {
	// BehaviorSubject to hold the currently viewed/active session
	private currentSession = new BehaviorSubject<VibeSession | null>(null);
	private sessions = new BehaviorSubject<VibeSession[] | null>(null);

	private http = inject(HttpClient);

	/**
	 * Observable for the currently active VibeSession.
	 */
	get currentSession$(): Observable<VibeSession | null> {
		return this.currentSession.asObservable();
	}

	/**
	 * Getter for sessions (if using BehaviorSubject) - Keep commented out unless needed
	 */
	get sessions$(): Observable<VibeSession[]> {
		return this.sessions.asObservable();
	}

	/**
	 * Fetches the list of Vibe sessions from the backend.
	 */
	listVibeSessions(): Observable<VibeSession[]> {
		return this.http.get<VibeSession[]>('/api/vibe').pipe(
			tap((response: VibeSession[]) => {
				this.sessions.next(response);
			}),
		);
	}

	/**
	 * Creates a new Vibe session via the backend API.
	 * @param data The data required to create the session.
	 * @returns An Observable emitting the newly created VibeSession.
	 */
	createVibeSession(data: CreateVibeSessionPayload): Observable<VibeSession> {
		return this.http.post<VibeSession>('/api/vibe', data);
		// No need for tap/BehaviorSubject update here unless caching is specifically required for creation results
	}

	/**
	 * Fetches the list of available SCM projects (GitHub, GitLab) from the backend.
	 */
	getScmProjects(): Observable<GitProject[]> {
		return this.http.get<GitProject[]>('/api/scm/projects');
	}

	/**
	 * Fetches the list of branches for a given SCM project.
	 * @param providerType The type of the SCM provider (e.g., 'github', 'gitlab').
	 * @param projectId The ID or path of the SCM project.
	 */
	getScmBranches(providerType: string, projectId: string | number): Observable<string[]> {
		// Use HttpParams to correctly encode query parameters
		const params = new HttpParams()
			.set('providerType', providerType)
			// Ensure projectId is sent as a string, as expected by the backend schema
			.set('projectId', String(projectId));

		return this.http.get<string[]>('/api/scm/branches', { params });
	}

	/**
	 * Fetches a specific Vibe session by its ID from the backend.
	 * @param id The ID of the Vibe session.
	 */
	getVibeSession(id: string): Observable<VibeSession> {
		return this.http.get<VibeSession>(`/api/vibe/${id}`).pipe(
			tap((session) => {
				this.currentSession.next(session);
				// Update the entry in $sessions
			}),
		);
	}

	/**
	 * Fetches the file system tree for a given Vibe session ID.
	 * @param sessionId The ID of the Vibe session.
	 * @returns An Observable emitting an array of FileSystemNode objects.
	 */
	getFileSystemTree(sessionId: string): Observable<FileSystemNode[]> {
		// The backend returns a JSON array representing the tree structure.
		return this.http.get<FileSystemNode[]>(`/api/vibe/${sessionId}/tree`);
	}

	/**
	 * Updates a specific Vibe session by its ID using a PATCH request.
	 * @param id The ID of the Vibe session to update.
	 * @param payload The data to update.
	 */
	updateSession(id: string, payload: UpdateVibeSessionPayload): Observable<VibeSession> {
		// Keep VibeSession return type for now, assuming tap might work or backend might change
		return this.http.patch<VibeSession>(`/api/vibe/${id}`, payload).pipe(
			tap((updatedSession) => {
				// This tap might not receive data if backend returns 204
				// Consider refetching or adjusting based on actual backend behavior
				if (updatedSession) {
					// Add check if updatedSession is returned
					this.currentSession.next(updatedSession);
				} else {
					// Optionally refetch the session here if backend returns 204
					// this.getVibeSession(id).subscribe();
				}
			}),
		);
	}

	/**
	 * Deletes a specific Vibe session by its ID.
	 * @param id The ID of the Vibe session to delete.
	 */
	deleteVibeSession(id: string): Observable<void> {
		// Use the correct route from shared/routes.ts
		return this.http.delete<void>(`/api/vibe/${id}`).pipe(
			tap(() => {
				// If the deleted session is the current session, clear the BehaviorSubject
				if (this.currentSession.value?.id === id) {
					this.currentSession.next(null);
				}
				// TODO remove from sessions
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
