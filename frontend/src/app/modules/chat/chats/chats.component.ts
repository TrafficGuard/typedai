import { NgClass } from '@angular/common';
import {
    ChangeDetectionStrategy,
    ChangeDetectorRef,
    Component,
    OnDestroy,
    OnInit,
    ViewEncapsulation,
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
import { Subject, takeUntil } from 'rxjs';
import { FuseConfirmationService } from '@fuse/services/confirmation';
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
    selectedChat: Chat;
    hoveredChatId: string | null = null;
    private _unsubscribeAll: Subject<any> = new Subject<any>();

    /**
     * Constructor
     */
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
        this._chatService.getChats()
            .pipe(takeUntil(this._unsubscribeAll))
            .subscribe({
                error: (error) => {
                    this.snackBar.open('Error loading chats')
                    console.error('Failed to load chats:', error);
                }
            });

        // Subscribe to chats updates
        this._chatService.chats$
            .pipe(takeUntil(this._unsubscribeAll))
            .subscribe((chats: Chat[]) => {
                this.chats = this.filteredChats = chats;

                // Mark for check
                this._changeDetectorRef.markForCheck();
            });

        // Selected chat
        this._chatService.chat$
            .pipe(takeUntil(this._unsubscribeAll))
            .subscribe((chat: Chat) => {
                this.selectedChat = chat;

                // Mark for check
                this._changeDetectorRef.markForCheck();
            });
    }

    /**
     * On destroy
     */
    ngOnDestroy(): void {
        // Unsubscribe from all subscriptions
        this._unsubscribeAll.next(null);
        this._unsubscribeAll.complete();

        // Reset the chat
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
        // event.stopPropagation();
        this.confirmationService.open({
            message: 'Are you sure you want to delete this chat?',
        }).afterClosed().subscribe((result) => {
            console.log(result);
            if(result === 'confirmed') {
                this._chatService.deleteChat(chat.id).subscribe(() => {
                    // Do we need to handle if it's the currently selected chat?
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
