import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import {BehaviorSubject, map, Observable, of, switchMap, tap, throwError} from 'rxjs';
import {environment} from "../../../environments/environment";
import {Vibe} from "./vibe.types";


@Injectable({
    providedIn: 'root',
})
export class VibeService {
    private vibe: BehaviorSubject<Vibe> = new BehaviorSubject(null);
    private vibes: BehaviorSubject<Vibe[]> = new BehaviorSubject<Vibe[]>(null);

    constructor(private http: HttpClient) {}

    /**
     * Getter for vibe
     */
    get vibe$(): Observable<Vibe> {
        return this.vibe.asObservable();
    }

    /**
     * Getter for vibes
     */
    get vibes$(): Observable<Vibe[]> {
        return this.vibes.asObservable();
    }

    listVibes(): Observable<any> {
        return this.http.get('/api/vibe/list').pipe(
            tap((response: Vibe[]) => {
                this.vibes.next(response);
            })
        );
    }

    deleteVibe(id: string): Observable<any> {
        return this.http.get('/api/vibe/delete/', { params: { id }});
    }

    /**
     * Get vibe
     *
     * @param id
     */
    getVibe(id: string): Observable<any> {
        return this.http
            .get<Vibe>('api/vibe/vibe', { params: { id } })
            .pipe(
                map((vibe) => {
                    this.vibe.next(vibe);
                    return vibe;
                }),
                switchMap((vibe) => {
                    if (!vibe) {
                        return throwError(
                            'Could not found vibe with id of ' + id + '!'
                        );
                    }
                    return of(vibe);
                })
            );
    }
}
