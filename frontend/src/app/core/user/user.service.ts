import { HttpClient } from '@angular/common/http';
import { inject, Injectable, computed } from '@angular/core';
import { catchError, Observable, tap, throwError, map, EMPTY } from 'rxjs';
import { Router } from '@angular/router';
import { USER_API } from "#shared/api/user.api";
import { callApiRoute } from "../api-route";
import { createApiEntityState } from '../api-state.types';
import { UserProfile, UserProfileUpdate } from "#shared/schemas/user.schema";


@Injectable({ providedIn: 'root' })
export class UserService {
    private http = inject(HttpClient);
    private router = inject(Router);

    private readonly _userState = createApiEntityState<UserProfile>();

    /** User Api result for authentication guard/service/components. */
    readonly userEntityState = this._userState.asReadonly();

    /** Public UserProfile state. Application components should use this state and assume the user is non-null  */
    readonly userProfile = computed(() => {
        const state = this._userState();
        return state.status === 'success' ? state.data : null;
    });

    set user(value: UserProfile | null) {
        if (value === null) {
            this._userState.set({ status: 'idle' });
        } else {
            this._userState.set({ status: 'success', data: value });
        }
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

                if (error?.status === 401 || error?.status === 403) {
                    this.router.navigate(['/ui/sign-in']);
                }

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
     * Update the user (broader profile updates)
     * @param userProfileUpdate
     */
    update(userProfileUpdate: UserProfileUpdate): Observable<void> {
        const currentState = this._userState();
        const currentUser = currentState.status === 'success' ? currentState.data : null;
        const updatedUser = { ...currentUser, ...userProfileUpdate } as UserProfile; // Assume UserProfileUpdate is subset of UserProfile

        return callApiRoute(this.http, USER_API.update, { body: userProfileUpdate }).pipe(
            tap(() => {
                // After successful API call, update the local state with the merged data.
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
