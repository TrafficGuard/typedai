import { NgClass, CommonModule } from '@angular/common';
import {
    ChangeDetectionStrategy,
    Component,
    ViewEncapsulation,
    input,
    output,
    signal,
    computed,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatMenuModule } from '@angular/material/menu';
import { MatSidenavModule } from '@angular/material/sidenav';
import { RouterLink, RouterOutlet } from '@angular/router';
import { Chat } from 'app/modules/chat/chat.types';

@Component({
    selector: 'chat-chats',
    templateUrl: './chats.component.html',
    encapsulation: ViewEncapsulation.None,
    changeDetection: ChangeDetectionStrategy.OnPush,
    standalone: true,
    imports: [
        CommonModule,
        FormsModule,
        MatSidenavModule,
        MatButtonModule,
        MatIconModule,
        MatMenuModule,
        MatFormFieldModule,
        MatInputModule,
        NgClass,
        RouterLink,
        RouterOutlet,
    ],
})
export class ChatsComponent {
    sessions = input<Chat[] | null>(null);
    selectedSessionId = input<string | null>(null);

    sessionSelected = output<Chat>();
    newChatClicked = output<void>();
    chatDeleted = output<Chat>();

    filterTerm = signal<string>('');
    hoveredChatId = signal<string | null>(null);

    filteredSessions = computed(() => {
        const term = this.filterTerm().toLowerCase();
        const currentSessions = this.sessions();
        if (!term || !currentSessions) {
            return currentSessions;
        }
        return currentSessions.filter(
            (session) =>
                session.title?.toLowerCase().includes(term)
        );
    });

    displaySessions = computed(() => {
        return this.filteredSessions() ?? this.sessions() ?? [];
    });

    hasDisplayableSessions = computed(() => this.displaySessions().length > 0);

    constructor() {}

    // -----------------------------------------------------------------------------------------------------
    // @ Public methods
    // -----------------------------------------------------------------------------------------------------

    /**
     * Handles the selection of a chat session.
     * @param session The selected chat session.
     */
    onSessionSelect(session: Chat): void {
        this.sessionSelected.emit(session);
    }

    /**
     * Handles the click event for creating a new chat.
     */
    onClickNewChat(): void {
        this.newChatClicked.emit();
    }

    /**
     * Updates the filter term based on user input.
     * @param event The input event from the filter field.
     */
    onFilterSessions(event: Event): void {
        const query = (event.target as HTMLInputElement).value;
        this.filterTerm.set(query);
    }

    /**
     * Handles the click event for deleting a chat session.
     * @param event The mouse event.
     * @param session The chat session to delete.
     */
    onClickDeleteSession(event: MouseEvent, session: Chat): void {
        event.stopPropagation(); // Prevent navigation or other unintended actions
        this.chatDeleted.emit(session);
    }

    /**
     * Track by function for ngFor loops.
     * @param index The index of the item.
     * @param session The chat session item.
     */
    trackBySessionId(index: number, session: Chat): string {
        return session.id;
    }
}
