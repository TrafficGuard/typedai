import { Injectable } from '@angular/core';
import { Scheme } from '@fuse/services/config/config.types';

@Injectable({ providedIn: 'root' })
export class LocalStorageService {
    private readonly SCHEME_KEY = 'app.ui.scheme';
    private readonly LAYOUT_KEY = 'app.ui.layout';
    private readonly DRAFT_MESSAGE_KEY_PREFIX = 'app.chat.draft_message_';

    setScheme(scheme: Scheme): void {
        localStorage.setItem(this.SCHEME_KEY, scheme);
    }

    getScheme(): Scheme | null {
        return localStorage.getItem(this.SCHEME_KEY) as Scheme | null;
    }

    setLayout(layout: string): void {
        localStorage.setItem(this.LAYOUT_KEY, layout);
    }

    getLayout(): string | null {
        return localStorage.getItem(this.LAYOUT_KEY);
    }

    saveDraftMessage(chatId: string, message: string): void {
        if (chatId === null || chatId === undefined) {
            console.warn('LocalStorageService: chatId is null or undefined, cannot save draft.');
            return;
        }
        const key = this.DRAFT_MESSAGE_KEY_PREFIX + chatId;
        localStorage.setItem(key, message);
    }

    getDraftMessage(chatId: string): string | null {
        if (chatId === null || chatId === undefined) {
            console.warn('LocalStorageService: chatId is null or undefined, cannot get draft.');
            return null;
        }
        const key = this.DRAFT_MESSAGE_KEY_PREFIX + chatId;
        return localStorage.getItem(key);
    }
}
