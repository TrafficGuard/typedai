import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { catchError, Observable, BehaviorSubject, tap, throwError, mergeMap, map } from 'rxjs';
import { USER_API } from "#shared/api/user.api";
import { callApiRoute } from "../api-route";
// Assuming UserProfile is the primary type used from schemas, if User model is different, adjust as needed.
// For now, sticking to UserProfile as it's used in existing code and API schemas.
import { UserProfile, UserProfileUpdate } from "#shared/schemas/user.schema";
import { User } from "#shared/model/user.model"; // User model for internal state if different

@Injectable({ providedIn: 'root' })
export class UserService {
    private http = inject(HttpClient);
    // The user$ observable should emit a consistent type. UserProfile is from schema.
    // If User from model.ts is preferred for app state, a mapping might be needed or use User type here.
    // For now, let's assume UserProfile is the type for _user subject based on existing code.
    private _user: BehaviorSubject<UserProfile | null> = new BehaviorSubject<UserProfile | null>(null);

    set user(value: UserProfile | null) {
        this._user.next(value);
    }

    get user$(): Observable<UserProfile | null> {
        return this._user.asObservable();
    }

    // -- Public methods -- --

    /**
     * Get the current signed-in user data
     */
    get(): Observable<UserProfile | null> {
        const currentUser = this._user.getValue();
        if (currentUser) {
            // Wrap in an observable to ensure consistent return type with the HTTP call path
            return new BehaviorSubject(currentUser).asObservable();
        }

        return callApiRoute(this.http, USER_API.view).pipe(
            tap((user: UserProfile) => {
                this._user.next(user);
            }),
            catchError(error => {
                console.error('Error loading profile [error]', error);
                this._user.next(null); // Ensure user is null on error
                return throwError(() => new Error('Error loading profile'));
            })
            // No mergeMap needed here, tap handles the side effect.
        );
    }

    /**
     * Update the user (broader profile updates)
     * @param userProfileUpdate
     */
    update(userProfileUpdate: UserProfileUpdate): Observable<void> {
        // Ensure ID is not part of the payload if UserProfileUpdateSchema excludes it or it's path param
        const currentVal = this._user.value;
        const updatedUser = { ...currentVal, ...userProfileUpdate } as UserProfile; // Assume UserProfileUpdate is subset of UserProfile

        return callApiRoute(this.http, USER_API.update, { body: userProfileUpdate }).pipe(
            tap(() => {
                // After successful API call, update the local BehaviorSubject
                // with the merged data.
                this._user.next(updatedUser);
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
                this._user.next(updatedUser);
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
