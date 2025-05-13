import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { catchError, Observable, BehaviorSubject, tap, throwError, mergeMap } from 'rxjs';
import { USER_API } from "#shared/api/user.api";
import { callApiRoute } from "../api-route";
import { UserProfile } from "#shared/schemas/user.schema";

@Injectable({ providedIn: 'root' })
export class UserService {
    private _httpClient = inject(HttpClient);
    private _user: BehaviorSubject<UserProfile> = new BehaviorSubject<UserProfile>(null);

    set user(value: UserProfile) {
        this._user.next(value);
    }

    get user$(): Observable<UserProfile> {
        return this._user.asObservable();
    }

    // -- Public methods -- --

    /**
     * Get the current signed-in user data
     */
    get(): Observable<UserProfile> {
        // Return the current value if it exists
        const currentUser = this._user.getValue();
        if (currentUser) {
            return this.user$;
        }

        // Fetch from server if no current value
        return callApiRoute(this._httpClient, USER_API.view).pipe(
            tap((user: UserProfile) => {
                this._user.next(user);
            }),
            catchError(error => {
                console.error('Error loading profile', error);
                return throwError(() => new Error('Error loading profile'));
            }),
            mergeMap(value => this.user$)
        );
    }

    /**
     * Update the user
     * @param userProfileUpdate
     */
    update(userProfileUpdate: Partial<UserProfile>): Observable<void> {
        const userProfile = {...this._user.value, ...userProfileUpdate}
        return callApiRoute(this._httpClient,USER_API.update, { body: userProfile }).pipe(
            tap(() => {
                this._user.next(userProfile);
            })
        );
    }
}
