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
import { catchError, finalize, tap, distinctUntilChanged } from 'rxjs/operators';
import { takeUntilDestroyed, toSignal, toObservable } from '@angular/core/rxjs-interop';

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
    sessions = computed(() => this.chatService.chats() ?? []);
    selectedSessionId = signal<string | null>(null);
    filterTerm = signal<string>('');
    hoveredChatId = signal<string | null>(null);

    // State Signals for async operations
    isLoading = signal(false);
    error = signal<any | null>(null);
    // isCreatingChat signal is removed as chat creation is deferred

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

        // Subscribe to route parameter changes
        toObservable(routeParamsSignal).pipe(
            distinctUntilChanged(),
            takeUntilDestroyed(this.destroyRef)
        ).subscribe(params => {
            const chatId = params?.get('id');
            if (chatId && chatId !== NEW_CHAT_ID) {
                this.selectedSessionId.set(chatId);
            } else {
                // If no ID, or it's the "new chat" placeholder, clear selection
                this.selectedSessionId.set(null);
            }
        });
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
                catchError(err => {
                    console.error('Error loading chats:', err);
                    this.error.set(err);
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
     * Navigates to the new chat route.
     */
    startNewChat(): void {
        // Navigate directly to the new chat route
        this.router.navigate(['./', NEW_CHAT_ID], { relativeTo: this.route });
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
                    // The computed sessions signal will automatically update from the service
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

    protected readonly NEW_CHAT_ID = NEW_CHAT_ID;
}
