import { Component, OnInit, OnDestroy, inject } from '@angular/core';
import { Router, RouterLink, RouterOutlet } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { NgClass, NgFor, NgIf } from '@angular/common';
import { Subscription, EMPTY } from 'rxjs';
import { catchError, finalize, tap } from 'rxjs/operators';

import { ChatServiceClient } from '../chat.service';
import { Chat, NEW_CHAT_ID } from '../chat.types';
// Forward-declare selectedChat for template compatibility, actual logic for selection is outside this scope.
// Users of this component would expect these to be present if they were used in the template previously.
// However, the current request focuses on loading, so these are minimal.
// import { ConversationComponent } from './conversation/conversation.component';
// import { EmptyConversationComponent } from './empty-conversation/empty-conversation.component';


@Component({
    selector: 'chats',
    templateUrl: './chats.component.html',
    standalone: true,
    imports: [
        NgIf,
        NgFor,
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
    chats: Chat[] = [];
    isLoading: boolean = false;
    error: any = null;
    private chatSubscription: Subscription | undefined;

    // Properties that might be used by the existing template but not managed by this specific request.
    // Adding them to avoid template errors, but their logic is not part of this update.
    selectedChat: Chat | null = null; // Assuming it might be set by router or other interactions
    hoveredChatId: string | null = null;
    
    // searchField: any; // This would be ElementRef if #searchField is used with ViewChild

    private chatService = inject(ChatServiceClient);
    private router = inject(Router);

    constructor() {}

    ngOnInit(): void {
        this.loadChats();
        // Initialize selectedChat based on current route if necessary (outside scope of this change)
        // This is a common pattern but depends on how :id route is handled.
        // For example, if a resolver was previously used, this logic might need to be different.
        // const currentChatId = this.router.url.split('/').pop();
        // if (currentChatId && currentChatId !== NEW_CHAT_ID) {
        //    this.chatService.loadChatById(currentChatId).subscribe(); // Or similar logic
        // }
        // this.chatService.chat.subscribe(chat => this.selectedChat = chat); // If selectedChat comes from service state
    }

    loadChats(): void {
        this.isLoading = true;
        this.error = null;
        if (this.chatSubscription && !this.chatSubscription.closed) {
            this.chatSubscription.unsubscribe();
        }

        this.chatSubscription = this.chatService.loadChats().pipe(
            tap(() => {
                const currentChatsFromSignal = this.chatService.chats();
                this.chats = currentChatsFromSignal ? [...currentChatsFromSignal] : [];
                // If filtering is to be maintained, re-apply filter here or ensure filteredChats is updated.
                // this.filterChats(this.searchField?.nativeElement?.value || ''); // Example if search was active
            }),
            catchError(err => {
                console.error('Error loading chats:', err);
                this.error = err; // Consider a user-friendly message string
                this.chats = [];
                return EMPTY;
            }),
            finalize(() => {
                this.isLoading = false;
            })
        ).subscribe();
    }

    retryLoadChats(): void {
        this.loadChats();
    }

    ngOnDestroy(): void {
        if (this.chatSubscription && !this.chatSubscription.closed) {
            this.chatSubscription.unsubscribe();
        }
    }

    // --- Methods from existing HTML, not part of the current request's core logic, added for template compatibility ---
    // Their full implementation is beyond the scope of this "self-loading" feature.

    createNewChat(): void {
        // Placeholder: Actual navigation or service call would go here.
        // This typically involves navigating to a route for a new chat, e.g., /chat/new
        this.router.navigate(['/apps/chat', NEW_CHAT_ID]); // Example path
        console.log('createNewChat called');
    }

    filterChats(query: string | null | undefined): void {
        // Placeholder: Actual filtering logic would go here.
        // This would typically filter `this.chats` into `this.filteredChats`
        // For now, to make the template work without error if it uses filteredChats,
        // we can just point filteredChats to chats or implement a simple filter.
        // However, the request implies using `this.chats` directly in the template.
        console.log('filterChats called with:', query);
        if (!query) {
            // this.filteredChats = [...this.chats]; // If filteredChats was a separate property
            return;
        }
        // Example filter (if `this.chats` is used directly, this method might not be needed by the loop)
        // this.chats = this.chats.filter(chat => chat.title?.toLowerCase().includes(query.toLowerCase()));
    }

    trackByFn(index: number, chat: Chat): string {
        return chat.id;
    }

    deleteChat(event: MouseEvent, chatToDelete: Chat): void {
        event.stopPropagation(); // Prevent navigation
        event.preventDefault(); // Prevent default anchor behavior
        // Placeholder: Actual delete logic using chatService would go here.
        console.log('deleteChat called for:', chatToDelete.id);
        if (chatToDelete.id === NEW_CHAT_ID) return; // Cannot delete 'new' chat placeholder

        // Example: this.chatService.deleteChat(chatToDelete.id).subscribe(...);
        // After successful deletion, you might want to remove it from `this.chats`
        // and potentially navigate away if it was the selected chat.
    }

    // --- End of placeholder methods ---
}
