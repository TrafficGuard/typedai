import { HttpClient } from '@angular/common/http';
import { inject, Injectable, computed } from '@angular/core';
import { catchError, Observable, tap, throwError, map, EMPTY } from 'rxjs';
import { toObservable } from '@angular/core/rxjs-interop';
import { USER_API } from "#shared/api/user.api";
import { callApiRoute } from "../api-route";
import { createApiEntityState, ApiEntityState } from '../api-state.types';
// Assuming UserProfile is the primary type used from schemas, if User model is different, adjust as needed.
// For now, sticking to UserProfile as it's used in existing code and API schemas.
import { UserProfile, UserProfileUpdate } from "#shared/schemas/user.schema";
import { User } from "#shared/model/user.model"; // User model for internal state if different

@Injectable({ providedIn: 'root' })
export class UserService {
    private http = inject(HttpClient);
    
    // Private writable state
    private readonly _userState = createApiEntityState<UserProfile>();
    
    // Public readonly state
    readonly userState = this._userState.asReadonly();

    set user(value: UserProfile | null) {
        if (value === null) {
            this._userState.set({ status: 'idle' });
        } else {
            this._userState.set({ status: 'success', data: value });
        }
    }

    get user$(): Observable<UserProfile | null> {
        const userSignal = computed(() => {
            const state = this._userState();
            return state.status === 'success' ? state.data : null;
        });
        return toObservable(userSignal);
    }

    // -- Public methods -- --

    /**
     * Load the current signed-in user data
     */
    loadUser(): void {
        if (this._userState().status === 'loading') return;
        
        this._userState.set({ status: 'loading' });
        
        callApiRoute(this.http, USER_API.view).pipe(
            tap((user: UserProfile) => {
                this._userState.set({ status: 'success', data: user });
            }),
            catchError(error => {
                console.error('Error loading profile [error]', error);
                this._userState.set({ 
                    status: 'error', 
                    error: error instanceof Error ? error : new Error('Error loading profile'),
                    code: error?.status
                });
                return EMPTY;
            })
        ).subscribe();
    }

    /**
     * Get the current signed-in user data
     */
    getUser(): void {
        this.loadUser();
    }

    /**
     * Get user data as Observable (backward compatibility)
     */
    get(): Observable<UserProfile | null> {
        this.loadUser();
        return this.user$;
    }

    /**
     * Update the user (broader profile updates)
     * @param userProfileUpdate
     */
    update(userProfileUpdate: UserProfileUpdate): Observable<void> {
        const currentState = this._userState();
        const currentUser = currentState.status === 'success' ? currentState.data : null;
        const updatedUser = { ...currentUser, ...userProfileUpdate } as UserProfile; // Assume UserProfileUpdate is subset of UserProfile

        return callApiRoute(this.http, USER_API.update, { body: userProfileUpdate }).pipe(
            tap(() => {
                // After successful API call, update the local state
                // with the merged data.
                this._userState.set({ status: 'success', data: updatedUser });
            })
        );
    }

    /**
     * Update the user's display name.
     * @param profileData Object containing the new name.
     */
    updateProfile(profileData: { name: string }): Observable<UserProfile> {
        return callApiRoute(this.http, USER_API.updateProfile, { body: profileData }).pipe(
            tap((updatedUser: UserProfile) => {
                // Update the local user state with the response from the server
                this._userState.set({ status: 'success', data: updatedUser });
            })
        );
    }

    /**
     * Change the user's password.
     * @param passwordData Object containing current and new passwords.
     */
    changePassword(passwordData: { currentPassword: string; newPassword: string }): Observable<void> {
        return callApiRoute(this.http, USER_API.changePassword, { body: passwordData });
        // No tap needed here to update _user unless API returns updated user object with, e.g., new tokens/session info
    }
}
