import { CommonModule, NgClass } from '@angular/common';
import {
    ChangeDetectionStrategy,
    Component,
    ViewEncapsulation,
    signal,
    computed,
    inject,
    OnInit,
    OnDestroy,
    DestroyRef,
    effect,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { ActivatedRoute, Router, RouterLink, RouterOutlet } from '@angular/router';
import { Chat, NEW_CHAT_ID } from 'app/modules/chat/chat.types';

import { ChatServiceClient } from '../chat.service';
import { EMPTY } from 'rxjs';
import { catchError, finalize, tap } from 'rxjs/operators';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';

@Component({
    selector: 'chat-chats',
    templateUrl: './chats.component.html',
    encapsulation: ViewEncapsulation.None,
    changeDetection: ChangeDetectionStrategy.OnPush,
    standalone: true,
    imports: [
        CommonModule,
        FormsModule,
        MatButtonModule,
        MatIconModule,
        MatFormFieldModule,
        MatInputModule,
        MatProgressSpinnerModule,
        NgClass,
        RouterLink,
        RouterOutlet,
    ],
})
export class ChatsComponent implements OnInit, OnDestroy {
    // Service Injections
    private chatService = inject(ChatServiceClient);
    private router = inject(Router);
    private route = inject(ActivatedRoute);
    private destroyRef = inject(DestroyRef);

    // State Signals
    sessions = signal<Chat[]>([]);
    selectedSessionId = signal<string | null>(null);
    filterTerm = signal<string>('');
    hoveredChatId = signal<string | null>(null);

    // State Signals for async operations
    isLoading = signal(false);
    error = signal<any | null>(null);
    isCreatingChat = signal(false);

    // Computed properties
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

        // Effect to synchronize selectedSessionId with route parameters
        effect(() => {
            const params = routeParamsSignal();
            const chatId = params?.get('id');
            if (chatId && chatId !== NEW_CHAT_ID) {
                this.selectedSessionId.set(chatId);
            } else {
                // If no ID, or it's the "new chat" placeholder, clear selection
                this.selectedSessionId.set(null);
            }
        }, { allowSignalWrites: true });
    }

    ngOnInit(): void {
        this.loadChats();
    }

    ngOnDestroy(): void {
        // takeUntilDestroyed handles subscription cleanup
    }

    // -----------------------------------------------------------------------------------------------------
    // @ Public methods
    // -----------------------------------------------------------------------------------------------------

    /**
     * Loads chat sessions from the service.
     */
    loadChats(): void {
        this.isLoading.set(true);
        this.error.set(null);

        this.chatService.loadChats()
            .pipe(
                takeUntilDestroyed(this.destroyRef),
                tap((loadedChats) => {
                    // Assuming loadChats returns Observable<Chat[]>
                    this.sessions.set(loadedChats ?? []);
                }),
                catchError(err => {
                    console.error('Error loading chats:', err);
                    this.error.set(err);
                    this.sessions.set([]); // Clear sessions on error
                    return EMPTY;
                }),
                finalize(() => {
                    this.isLoading.set(false);
                })
            ).subscribe();
    }

    /**
     * Retries loading chat sessions after an error.
     */
    retryLoadChats(): void {
        this.loadChats();
    }

    /**
     * Handles the selection of a chat session.
     * @param session The selected chat session.
     */
    onSessionSelect(session: Chat): void {
        // Optimistically set selectedId, route effect will confirm
        this.selectedSessionId.set(session.id);
        // Navigation is handled by [routerLink]="[session.id]" in the template
    }

    /**
     * Handles the click event for creating a new chat.
     */
    startNewChat(): void {
        if (this.isCreatingChat()) {
            return;
        }
        this.isCreatingChat.set(true);

        // Assuming default LLM or a way to get it. For now, 'default-llm' placeholder.
        // Assuming CreateChatRequest is optional and an empty object {} is acceptable for default creation
        this.chatService.createChat('', 'default-llm')
            .pipe(takeUntilDestroyed(this.destroyRef))
            .subscribe({
                next: (newChat: Chat) => {
                    if (newChat && newChat.id) {
                        this.router.navigate(['./', newChat.id], { relativeTo: this.route });
                        // Optionally, refresh the chat list if not automatically updated by service
                        // this.loadChats();
                    } else {
                        console.error('New chat created but ID is missing or invalid:', newChat);
                    }
                    this.isCreatingChat.set(false);
                },
                error: (err) => {
                    console.error('Error creating new chat:', err);
                    this.isCreatingChat.set(false);
                    // Optional: Display a user-friendly error message to the user
                },
                complete: () => {
                    // Ensure flag is reset if observable completes without next/error
                    if (this.isCreatingChat()) {
                        this.isCreatingChat.set(false);
                    }
                }
            });
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
        event.preventDefault(); // Prevent default link behavior

        if (session.id === NEW_CHAT_ID) return; // Should not happen if delete button isn't shown for new

        // Consider adding a confirmation dialog here (e.g., using FuseConfirmationService)
        this.chatService.deleteChat(session.id)
            .pipe(takeUntilDestroyed(this.destroyRef))
            .subscribe({
                next: () => {
                    this.loadChats(); // Re-fetch to update the list.
                    if (this.selectedSessionId() === session.id) {
                        // Navigate to the base chat route if the active chat was deleted
                        this.router.navigate(['../'], { relativeTo: this.route });
                    }
                },
                error: (err) => {
                    console.error('Failed to delete chat:', err);
                    // Optionally show a snackbar message
                }
            });
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
