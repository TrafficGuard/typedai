import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { BehaviorSubject, map, Observable, of, switchMap, take, tap, throwError } from 'rxjs'; // Added take
import { VibeSession, SelectedFile } from './vibe.types'; // Restored SelectedFile import if needed locally, or adjust if type comes from elsewhere
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

	/**
	 * Fetches the file system tree for a given Vibe session ID as a newline-separated string.
	 * @param sessionId The ID of the Vibe session.
	 */
	getFileSystemTree(sessionId: string): Observable<string> {
		// The backend returns a plain text response with each file path on a new line.
		return this.http.get(`/api/vibe/filesystem-tree/${sessionId}`, { responseType: 'text' });
	}

    /**
     * Updates a specific Vibe session by its ID using a PATCH request.
     * @param id The ID of the Vibe session to update.
     * @param payload The data to update.
     */
    updateSession(id: string, payload: UpdateVibeSessionPayload): Observable<VibeSession> {
        return this.http.patch<VibeSession>(`/api/vibe/sessions/${id}`, payload).pipe(
            tap((updatedSession) => {
                // Update the BehaviorSubject with the updated session data
                this.currentSession.next(updatedSession);
            })
        );
    }

    /**
     * Deletes a specific Vibe session by its ID.
     * @param id The ID of the Vibe session to delete.
     */
    deleteVibeSession(id: string): Observable<void> {
        // Use the correct route from shared/routes.ts
        return this.http.delete<void>(`/api/vibe/sessions/${id}`).pipe(
            tap(() => {
                // If the deleted session is the current session, clear the BehaviorSubject
                if (this.currentSession.value?.id === id) {
                    this.currentSession.next(null);
                }
                // Optionally, trigger a refresh of the session list if one is maintained elsewhere
                // e.g., if you have a sessions BehaviorSubject: this.listVibeSessions().pipe(take(1)).subscribe();
            })
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
