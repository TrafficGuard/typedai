import { Component, OnInit, OnDestroy, inject, signal, computed, effect, DestroyRef, WritableSignal, Signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink, RouterOutlet } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { NgClass } from '@angular/common'; // NgIf removed
import { EMPTY } from 'rxjs'; // Subscription removed
import { catchError, finalize, tap } from 'rxjs/operators';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';

import { ChatServiceClient } from './chat.service'; // Corrected path
import { Chat, NEW_CHAT_ID } from './chat.types'; // Corrected path
// Forward-declare selectedChat for template compatibility, actual logic for selection is outside this scope.
// Users of this component would expect these to be present if they were used in the template previously.
// However, the current request focuses on loading, so these are minimal.
// import { ConversationComponent } from './conversation/conversation.component';
// import { EmptyConversationComponent } from './empty-conversation/empty-conversation.component';


@Component({
    selector: 'chats',
    templateUrl: './chats/chats.component.html',
    standalone: true,
    imports: [
        // NgIf removed as @if is used in template
        // NgFor, // Removed as @for is used in the template
        NgClass,
        MatButtonModule,
        MatIconModule,
        MatFormFieldModule,
        MatInputModule,
        RouterLink,
        RouterOutlet,
        // ConversationComponent, // Not directly used by chats.component.ts logic here
        // EmptyConversationComponent, // Not directly used by chats.component.ts logic here
    ],
})
export class ChatsComponent implements OnInit, OnDestroy {
    private chatService = inject(ChatServiceClient);
    private router = inject(Router);
    private route = inject(ActivatedRoute);
    private destroyRef = inject(DestroyRef);

    isLoading = signal(false);
    error = signal<any | null>(null);
    
    sessions = signal<Chat[]>([]);
    selectedSessionId = signal<string | null>(null);
    hoveredChatId = signal<string | null>(null);
    filterTerm = signal<string>('');

    filteredSessions = computed(() => {
        const term = this.filterTerm().toLowerCase();
        const currentSessions = this.sessions();
        if (!term) {
            return currentSessions;
        }
        return currentSessions.filter(
            (session) =>
                session.title?.toLowerCase().includes(term)
        );
    });

    displaySessions = computed(() => {
        return this.filteredSessions() ?? [];
    });

    hasDisplayableSessions = computed(() => this.displaySessions().length > 0);

    constructor() {
        const routeParamsSignal = toSignal(this.route.paramMap, { initialValue: null });

        effect(() => {
            const params = routeParamsSignal();
            const chatId = params?.get('id'); // 'id' is the typical param name for chat routes
            if (chatId && chatId !== NEW_CHAT_ID) {
                this.selectedSessionId.set(chatId);
            } else {
                this.selectedSessionId.set(null);
            }
        }, { allowSignalWrites: true }); // Allow signal writes as it's reacting to route changes
    }

    ngOnInit(): void {
        this.loadChats();
    }

    loadChats(): void {
        this.isLoading.set(true);
        this.error.set(null);

        this.chatService.loadChats()
            .pipe(
                takeUntilDestroyed(this.destroyRef),
                tap(() => {
                    // The service updates its own signals; we read from them.
                    this.sessions.set(this.chatService.chats() ?? []);
                }),
                catchError(err => {
                    console.error('Error loading chats:', err);
                    this.error.set(err);
                    this.sessions.set([]);
                    return EMPTY;
                }),
                finalize(() => {
                    this.isLoading.set(false);
                })
            ).subscribe();
    }

    retryLoadChats(): void {
        this.loadChats();
    }

    ngOnDestroy(): void {
        // Subscriptions using takeUntilDestroyed are automatically cleaned up.
    }

    // --- Methods for the template ---

    onClickNewChat(): void {
        this.router.navigate(['/apps/chat', NEW_CHAT_ID]); // Adjust path if needed
    }

    onFilterSessions(event: Event): void {
        const query = (event.target as HTMLInputElement).value;
        this.filterTerm.set(query);
    }

    onSessionSelect(session: Chat): void {
        // Navigation is handled by [routerLink] in the template.
        // This method can be used for additional logic if needed,
        // or to optimistically set the selectedId if route param effect is slow.
        this.selectedSessionId.set(session.id);
    }

    onClickDeleteSession(event: MouseEvent, session: Chat): void {
        event.stopPropagation();
        event.preventDefault();

        if (session.id === NEW_CHAT_ID) return;

        // Consider adding a confirmation dialog here using FuseConfirmationService
        // For now, directly deleting as per the original simpler deleteChat.
        this.chatService.deleteChat(session.id)
            .pipe(takeUntilDestroyed(this.destroyRef))
            .subscribe({
                next: () => {
                    // The chatService's loadChats or internal signal updates should refresh the list.
                    // If not, explicitly call this.loadChats() or update this.sessions signal.
                    // For now, assume service handles its signal update, which loadChats reads.
                    this.loadChats(); // Re-fetch to update the list.
                    if (this.selectedSessionId() === session.id) {
                        this.router.navigate(['/apps/chat']); // Navigate to a neutral route
                    }
                },
                error: (err) => {
                    console.error('Failed to delete chat:', err);
                    // Optionally show a snackbar message
                }
            });
    }

    // trackByFn for @for loop in template (template uses track session.id directly)
    // trackBySessionId(index: number, session: Chat): string {
    //     return session.id;
    // }
}
