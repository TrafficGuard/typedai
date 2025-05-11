import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { User } from 'app/core/user/user.types';
import { catchError, Observable, BehaviorSubject, tap, throwError, mergeMap } from 'rxjs';
import { API } from '#shared/api-definitions'; // Added import

@Injectable({ providedIn: 'root' })
export class UserService {
    private _httpClient = inject(HttpClient);
    private _user: BehaviorSubject<User> = new BehaviorSubject<User>(null);

    // -----------------------------------------------------------------------------------------------------
    // @ Accessors
    // -----------------------------------------------------------------------------------------------------

    /**
     * Setter & getter for user
     *
     * @param value
     */
    set user(value: User) {
        // Store the value
        this._user.next(value);
    }

    get user$(): Observable<User> {
        return this._user.asObservable();
    }

    // -----------------------------------------------------------------------------------------------------
    // @ Public methods
    // -----------------------------------------------------------------------------------------------------

    /**
     * Get the current signed-in user data
     */
    get(): Observable<User> {
        // Return the current value if it exists
        const currentUser = this._user.getValue();
        if (currentUser) {
            return this.user$;
        }

        // Fetch from server if no current value
        return this._httpClient.get<User>(`/api/profile/view`).pipe(
            tap((user) => {
                user = (user as any).data
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
     *
     * @param user
     */
    update(user: Partial<User>): Observable<User> {
        return this._httpClient.post<User>(API.profile.update.buildPath({}), { user }).pipe( // Changed to use API.profile.update
            tap((response) => {
                response = (response as any).data;
                this._user.next({...response});
            })
        );
    }
}
