import { NgClass } from '@angular/common';
import {
    ChangeDetectionStrategy,
    ChangeDetectorRef,
    Component,
    OnDestroy,
    OnInit,
    ViewEncapsulation,
    inject,
    DestroyRef,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatMenuModule } from '@angular/material/menu';
import { MatSidenavModule } from '@angular/material/sidenav';
import { ActivatedRoute, Router, RouterLink, RouterOutlet } from '@angular/router';
import { ChatServiceClient } from '../chat.service';
import {Chat, NEW_CHAT_ID} from 'app/modules/chat/chat.types';
import { FuseConfirmationService } from '@fuse/services/confirmation';
import { toObservable, takeUntilDestroyed } from '@angular/core/rxjs-interop'; // Import toObservable and takeUntilDestroyed
import {MatSnackBar} from "@angular/material/snack-bar";

@Component({
    selector: 'chat-chats',
    templateUrl: './chats.component.html',
    encapsulation: ViewEncapsulation.None,
    changeDetection: ChangeDetectionStrategy.OnPush,
    standalone: true,
    imports: [
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
export class ChatsComponent implements OnInit, OnDestroy {
    chats: Chat[];
    filteredChats: Chat[];
    selectedChat: Chat | null; // Allow null as signal can be null
    hoveredChatId: string | null = null;
    // Removed _unsubscribeAll: Subject<any> = new Subject<any>();

    // Add DestroyRef for takeUntilDestroyed
    private destroyRef = inject(DestroyRef);

    // Convert signals to observables as field initializers
    private chats$ = toObservable(this._chatService.chats);
    private selectedChat$ = toObservable(this._chatService.chat);

    constructor(
        private _chatService: ChatServiceClient,
        private snackBar: MatSnackBar,
        private _changeDetectorRef: ChangeDetectorRef,
        private confirmationService: FuseConfirmationService,
        private router: Router,
        private route: ActivatedRoute
    ) {}

    // -----------------------------------------------------------------------------------------------------
    // @ Lifecycle hooks
    // -----------------------------------------------------------------------------------------------------

    /**
     * On init
     */
    ngOnInit(): void {
        // Load chats if not already loaded
        this._chatService.loadChats() // This ensures chats are loaded or loading
            .pipe(takeUntilDestroyed(this.destroyRef)) // Use takeUntilDestroyed
            .subscribe({
                error: (error) => {
                    this.snackBar.open('Error loading chats', 'Close', { duration: 3000 }); // Added Close button and duration
                    console.error('Failed to load chats:', error);
                }
            });

        // Subscribe to chats updates using the pre-converted observable
        this.chats$
            .pipe(takeUntilDestroyed(this.destroyRef)) // Use takeUntilDestroyed
            .subscribe((chats: Chat[] | null) => { // Handle null case from signal
                this.chats = chats || []; // Default to empty array if null
                this.filteredChats = this.chats;

                // Mark for check
                this._changeDetectorRef.markForCheck();
            });

        // Selected chat using the pre-converted observable
        this.selectedChat$
            .pipe(takeUntilDestroyed(this.destroyRef)) // Use takeUntilDestroyed
            .subscribe((chat: Chat | null) => { // Handle null case from signal
                this.selectedChat = chat;

                // Mark for check
                this._changeDetectorRef.markForCheck();
            });
    }

    /**
     * On destroy
     */
    ngOnDestroy(): void {
        // Reset the chat
        // Consider if this is truly needed here, or if it should be handled
        // by the component that owns the chat view (e.g., when navigating away from a specific chat)
        // For now, keeping it as per original logic.
        this._chatService.resetChat();
    }

    // -----------------------------------------------------------------------------------------------------
    // @ Public methods
    // -----------------------------------------------------------------------------------------------------

    /**
     * Create a new chat
     */
    createNewChat(): void {
        // Create a temporary chat object to ensure the conversation component is displayed
        const tempChat = { id: NEW_CHAT_ID, messages: [], title: '', updatedAt: Date.now() };
        this._chatService.setChat(tempChat);

        // Navigate to the new chat route
        this.router.navigate([NEW_CHAT_ID], { relativeTo: this.route }).catch(console.error);

        // Mark for check to ensure UI updates
        this._changeDetectorRef.markForCheck();
    }

    /**
     * Filter the chats
     *
     * @param query
     */
    filterChats(query: string): void {
        // Reset the filter
        if (!query) {
            this.filteredChats = this.chats;
            return;
        }

        this.filteredChats = this.chats.filter((chat) =>
            chat.title.toLowerCase().includes(query.toLowerCase())
        );
    }

    /**
     * Delete the current chat
     */
    deleteChat(event: MouseEvent, chat: Chat): void {
        // event.stopPropagation(); // Keep this if you want to prevent navigation when clicking delete icon
        this.confirmationService.open({
            message: 'Are you sure you want to delete this chat?',
        }).afterClosed().subscribe((result) => {
            console.log(result);
            if(result === 'confirmed') {
                this._chatService.deleteChat(chat.id).subscribe(() => {
                    // The service updates the chats signal, which the subscription handles.
                    // If the deleted chat was the selected one, the service also sets _chat to null,
                    // which the selectedChat$ subscription handles.
                });
            }
        });
    }

    /**
     * Track by function for ngFor loops
     *
     * @param index
     * @param item
     */
    trackByFn(index: number, item: any): any {
        return item.id || index;
    }
}
