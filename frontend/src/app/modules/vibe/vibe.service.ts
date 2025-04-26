import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { BehaviorSubject, map, Observable, of, switchMap, tap, throwError } from 'rxjs';
import { VibeSession } from './vibe.types'; // Import VibeSession

@Injectable({
	providedIn: 'root',
})
export class VibeService {
	// Keep BehaviorSubjects if needed for caching or sharing state, otherwise remove
	// private sessions: BehaviorSubject<VibeSession[]> = new BehaviorSubject<VibeSession[]>(null);

	constructor(private http: HttpClient) {}

	/**
	 * Getter for sessions (if using BehaviorSubject)
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
