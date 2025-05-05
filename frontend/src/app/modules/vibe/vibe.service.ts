import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { BehaviorSubject, type Observable, tap, catchError, throwError } from 'rxjs';
// Import FileSystemNode if not already imported (assuming it's defined in vibe.types.ts)
import type { FileSystemNode, GitProject, VibePreset, VibePresetConfig, VibeSession } from './vibe.types';

// Define the shape of the data needed for creation, matching the backend API body
export interface CreateVibeSessionPayload {
	title: string;
	instructions: string;
	repositorySource: 'local' | 'github' | 'gitlab';
	repositoryId: string;
	repositoryName?: string | null;
	targetBranch: string;
	workingBranch: string;
	createWorkingBranch: boolean;
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

	// HTTP calls must match the backend API endpoints defined in src/routes/vibe/vibeRoutes.ts

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

	/**
	 * Sends a prompt to the backend to refine the design for a specific Vibe session.
	 * @param sessionId The ID of the Vibe session.
	 * @param prompt The user's instructions for refinement.
	 * @returns An Observable that completes when the request is sent (backend returns void/202).
	 */
	updateDesignWithPrompt(sessionId: string, prompt: string): Observable<void> {
		return this.http.post<void>(`/api/vibe/${sessionId}/update-design-prompt`, { prompt });
	}

	/**
	 * Triggers the backend to start implementing the approved design for a specific Vibe session.
	 * @param sessionId The ID of the Vibe session.
	 * @returns An Observable that completes when the request is sent (backend returns void/202).
	 */
	executeDesign(sessionId: string): Observable<void> {
		return this.http.post<void>(`/api/vibe/${sessionId}/execute-design`, {});
	}

	/**
	 * Approves the current file selection and triggers design generation.
	 * @param sessionId The ID of the Vibe session.
	 * @returns An Observable that completes when the request is accepted (backend returns 202).
	 */
	approveFileSelection(sessionId: string): Observable<void> {
		return this.http.post<void>(`/api/vibe/${sessionId}/generate-design`, {}).pipe(
			tap(() => {}), // Placeholder tap if needed, or remove tap entirely if no other side effects
			catchError((error) => {
				// Consider adding console.error or other basic logging if needed
				return throwError(() => error);
			}),
		);
	}

	/**
	 * Sends a prompt to the backend to update the file selection for a specific Vibe session.
	 * @param sessionId The ID of the Vibe session.
	 * @param prompt The user's instructions for updating the selection.
	 * @returns An Observable that completes when the request is accepted (backend returns 202).
	 */
	updateFileSelection(sessionId: string, prompt: string): Observable<void> {
		return this.http.post<void>(`/api/vibe/${sessionId}/update-selection`, { prompt }).pipe(
			tap(() => {}), // Placeholder tap if needed, or remove tap entirely if no other side effects
			catchError((error) => {
				// Consider adding console.error or other basic logging if needed
				return throwError(() => error);
			}),
		);
	}

	// --- Preset Management ---

	/**
	 * Fetches the list of Vibe presets from the backend.
	 */
	listVibePresets(): Observable<VibePreset[]> {
		return this.http.get<VibePreset[]>('/api/vibe/presets');
	}

	/**
	 * Saves a new Vibe preset to the backend.
	 * @param name The name for the new preset.
	 * @param config The configuration object for the preset.
	 * @returns An Observable emitting the newly created VibePreset.
	 */
	saveVibePreset(name: string, config: VibePresetConfig): Observable<VibePreset> {
		return this.http.post<VibePreset>('/api/vibe/presets', { name, config });
	}

	/**
	 * Deletes a specific Vibe preset by its ID.
	 * @param presetId The ID of the preset to delete.
	 */
	deleteVibePreset(presetId: string): Observable<void> {
		return this.http.delete<void>(`/api/vibe/presets/${presetId}`);
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
