import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Chat } from 'app/layout/common/quick-list/quick-list.types';
import {
    BehaviorSubject,
    map,
    Observable,
    of,
    switchMap,
    tap,
    throwError,
} from 'rxjs';

@Injectable({ providedIn: 'root' })
export class QuickListService {
    private _chat: BehaviorSubject<Chat> = new BehaviorSubject(null);
    private _chats: BehaviorSubject<Chat[]> = new BehaviorSubject<Chat[]>(null);

    /**
     * Constructor
     */
    constructor(private _httpClient: HttpClient) {}

    // -----------------------------------------------------------------------------------------------------
    // @ Accessors
    // -----------------------------------------------------------------------------------------------------

    /**
     * Getter for chat
     */
    get chat$(): Observable<Chat> {
        return this._chat.asObservable();
    }

    /**
     * Getter for chat
     */
    get chats$(): Observable<Chat[]> {
        return this._chats.asObservable();
    }

    // -----------------------------------------------------------------------------------------------------
    // @ Public methods
    // -----------------------------------------------------------------------------------------------------

    /**
     * Get chats
     */
    getChats(): Observable<any> {
        return this._httpClient.get<Chat[]>('api/apps/chat/chats').pipe(
            tap((response: Chat[]) => {
                this._chats.next(response);
            })
        );
    }

    /**
     * Get chat
     *
     * @param id
     */
    getChatById(id: string): Observable<any> {
        return this._httpClient
            .get<Chat>('api/apps/chat/chat', { params: { id } })
            .pipe(
                map((chat) => {
                    // Update the chat
                    this._chat.next(chat);

                    // Return the chat
                    return chat;
                }),
                switchMap((chat) => {
                    if (!chat) {
                        return throwError(
                            'Could not found chat with id of ' + id + '!'
                        );
                    }

                    return of(chat);
                })
            );
    }
}
