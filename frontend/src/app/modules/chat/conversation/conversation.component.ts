import { TextFieldModule } from '@angular/cdk/text-field';
import { DatePipe, NgClass } from '@angular/common';
import { UserService } from 'app/core/user/user.service';
import { User } from 'app/core/user/user.types';
import { EMPTY, Observable, catchError, switchMap } from 'rxjs';
import { v4 as uuidv4 } from 'uuid';
import {
    AfterViewInit,
    ChangeDetectionStrategy,
    ChangeDetectorRef,
    Component,
    ElementRef,
    HostListener,
    NgZone,
    OnDestroy,
    OnInit,
    ViewChild,
    ViewEncapsulation,
} from '@angular/core';
import {Attachment, NEW_CHAT_ID} from 'app/modules/chat/chat.types';
import {MatButtonModule} from '@angular/material/button';
import {MatFormFieldModule} from '@angular/material/form-field';
import {MatIconModule} from '@angular/material/icon';
import {MatSnackBar} from '@angular/material/snack-bar';
import {MatInputModule} from '@angular/material/input';
import {MatMenuModule} from '@angular/material/menu';
import {MatSidenavModule} from '@angular/material/sidenav';
import {ActivatedRoute, Router, RouterLink, RouterModule} from '@angular/router';
import {FuseMediaWatcherService} from '@fuse/services/media-watcher';
import {ChatService} from 'app/modules/chat/chat.service';
import {Chat, ChatMessage} from 'app/modules/chat/chat.types';
import {ChatInfoComponent} from 'app/modules/chat/chat-info/chat-info.component';
import {LLM, LlmService} from "app/modules/agents/services/llm.service";
import {combineLatest, Subject, takeUntil} from 'rxjs';
import {
    MarkdownModule,
    MarkdownService,
    provideMarkdown,
    MarkedRenderer
} from "ngx-markdown";
import {MatSelect, MatSelectModule} from "@angular/material/select";
import {ReactiveFormsModule} from "@angular/forms";
import {MatTooltipModule} from "@angular/material/tooltip";
import {ClipboardButtonComponent} from "./clipboard-button.component";
import {FuseConfirmationService} from "../../../../@fuse/services/confirmation";
import {ClipboardModule} from "@angular/cdk/clipboard";

@Component({
    selector: 'chat-conversation',
    templateUrl: './conversation.component.html',
    styleUrls: ['./conversation.component.scss'],
    encapsulation: ViewEncapsulation.None,
    changeDetection: ChangeDetectionStrategy.OnPush,
    standalone: true,
    imports: [
        MatSidenavModule,
        ChatInfoComponent,
        MatButtonModule,
        RouterLink,
        MatIconModule,
        MatMenuModule,
        MatButtonModule,
        MatMenuModule,
        MatTooltipModule,
        NgClass,
        MatFormFieldModule,
        MatInputModule,
        TextFieldModule,
        MarkdownModule,
        RouterModule,
        MatSelectModule,
        ReactiveFormsModule,
        ClipboardButtonComponent,
        ClipboardModule,
    ],
    providers: [
        provideMarkdown(),
    ]
})
export class ConversationComponent implements OnInit, OnDestroy, AfterViewInit {

    @ViewChild('messageInput') messageInput: ElementRef;
    @ViewChild('llmSelect') llmSelect: MatSelect;
    @ViewChild('fileInput') fileInput: ElementRef;
    selectedFiles: File[] = [];
    chat: Chat;
    chats: Chat[];
    drawerMode: 'over' | 'side' = 'side';
    drawerOpened = false;
    private _unsubscribeAll: Subject<any> = new Subject<any>();
    llms: LLM[] = null;
    llmId: string;
    currentUser: User;
    defaultChatLlmId: string;

    sendIcon: string = 'heroicons_outline:paper-airplane'

    sendOnEnter = true;
    enterStateIcon: 'keyboard_return' | 'heroicons_outline:paper-airplane' = 'heroicons_outline:paper-airplane'

    llmHasThinkingLevels: boolean = false;
    thinkingIcon: string = 'heroicons_outline:minus-small';
    thinkingLevel: 'off' | 'low' | 'medium' | 'high' = 'off';

    private mediaRecorder: MediaRecorder;
    private audioChunks: Blob[] = [];
    recording = false;
    /** If we're waiting for a response from the LLM after sending a message */
    generating = false;
    generatingTimer = null;
    readonly clipboardButton = ClipboardButtonComponent;



    /**
     * For the Markdown component, the syntax highlighting support has the plugins defined
     * in the angular.json file. Currently just a select few languages are included.
     */
    constructor(
        private _changeDetectorRef: ChangeDetectorRef,
        private _chatService: ChatService,
        private _fuseMediaWatcherService: FuseMediaWatcherService,
        private _fuseConfirmationService: FuseConfirmationService,
        private _ngZone: NgZone,
        private _elementRef: ElementRef,
        private _markdown: MarkdownService,
        private llmService: LlmService,
        private router: Router,
        private route: ActivatedRoute,
        private userService: UserService,
        private _snackBar: MatSnackBar
    ) {}

    // -----------------------------------------------------------------------------------------------------
    // @ Decorated methods
    // -----------------------------------------------------------------------------------------------------

    /**
     * Resize on 'input' and 'ngModelChange' events
     *
     * @private
     */
    @HostListener('input')
    @HostListener('ngModelChange')
    private _resizeMessageInput(): void {
        // This doesn't need to trigger Angular's change detection by itself
        this._ngZone.runOutsideAngular(() => {
            setTimeout(() => {
                // Set the height to 'auto' so we can correctly read the scrollHeight
                this.messageInput.nativeElement.style.height = 'auto';

                // Detect the changes so the height is applied
                this._changeDetectorRef.detectChanges();

                // Get the scrollHeight and subtract the vertical padding
                this.messageInput.nativeElement.style.height = `${this.messageInput.nativeElement.scrollHeight}px`;

                // Detect the changes one more time to apply the final height
                this._changeDetectorRef.detectChanges();
            });
        });
    }

    // -----------------------------------------------------------------------------------------------------
    // @ Lifecycle hooks
    // -----------------------------------------------------------------------------------------------------

    ngOnInit(): void {
        // Configure the Markdown parser options
        this._markdown.options = {
            renderer: new MarkedRenderer(),
            gfm: true,
            breaks: true,
        };

        // Handle route parameters
        this.route.params.pipe(
            takeUntil(this._unsubscribeAll)
        ).subscribe(params => {
            const chatId = params['id'];
            // Do we even need this?
            if (!chatId) {
                this.resetChat();
            }
        });

        // Combine user preferences and available LLMs streams
        combineLatest([
            this.userService.user$,
            this.llmService.getLlms(),
            this._chatService.chat$
        ]).pipe(
            takeUntil(this._unsubscribeAll)
        ).subscribe(([user, llms, chat]) => {
            this.generating = false; // if we switch back to a chat which is generating...
            this.currentUser = user;
            this.defaultChatLlmId = user.chat?.defaultLLM;
            this.llms = llms;
            this.chat = clone(chat) || { id: NEW_CHAT_ID, messages: [], title: '', updatedAt: Date.now() };
            this.assignUniqueIdsToMessages(this.chat.messages);
            this.updateLlmSelector();
            this._changeDetectorRef.markForCheck();
        });

        // Chats observable
        this._chatService.chats$
            .pipe(takeUntil(this._unsubscribeAll))
            .subscribe((chats: Chat[]) => {
                this.chats = chats;
            });

        // Media watcher (unchanged)
        this._fuseMediaWatcherService.onMediaChange$
            .pipe(takeUntil(this._unsubscribeAll))
            .subscribe(({ matchingAliases }) => {
                this.drawerMode = matchingAliases.includes('lg') ? 'side' : 'over';
                this._changeDetectorRef.markForCheck();
            });


    }

    ngOnDestroy(): void {
        this._unsubscribeAll.next(null);
        this._unsubscribeAll.complete();
    }

    ngAfterViewInit() {
        const startTime = Date.now();
        const maxDuration = 5000; // 5 seconds

        const focusInterval = setInterval(() => {
            if (this.messageInput) {
                this.messageInput.nativeElement.focus();
                clearInterval(focusInterval);
            } else {
                if (Date.now() - startTime >= maxDuration) {
                    clearInterval(focusInterval);
                    console.warn('Failed to focus messageInput after 5 seconds');
                }
            }
        }, 500);
    }

    // -----------------------------------------------------------------------------------------------------
    // @ Public methods
    // -----------------------------------------------------------------------------------------------------

    /**
     * Sets the appropriate LLM ID based on context and available LLMs:
     * - For new chats: Uses user's default LLM if available
     * - For existing chats: Uses the LLM from the last message
     * - Fallback to first available LLM if no other selection is valid
     */
    updateLlmSelector() {
        if (!this.llms) return;
        const llmIds = this.llms.map(llm => llm.id);

        // For existing chats with messages, use the last message's LLM if still available
        if (this.chat?.messages?.length > 0) {
            const lastMessageLlmId = this.chat.messages.at(-1).llmId;
            if (lastMessageLlmId && llmIds.includes(lastMessageLlmId)) {
                this.llmId = lastMessageLlmId;
                this._changeDetectorRef.markForCheck();
                this.updateThinkingIcon();
                return;
            }
        }

        // Try to use default LLM for new chats or when last message LLM unavailable
        if (this.defaultChatLlmId && llmIds.includes(this.defaultChatLlmId)) {
            this.llmId = this.defaultChatLlmId;
            this._changeDetectorRef.markForCheck();
            this.updateThinkingIcon();
            return;
        }

        // If default LLM is set but not available, log warning
        if (this.defaultChatLlmId && !llmIds.includes(this.defaultChatLlmId)) {
            console.warn(`Default LLM ${this.defaultChatLlmId} not found in available LLMs:`, llmIds);
        }

        // Fallback to first available LLM if no valid selection
        if ((!this.llmId || !llmIds.includes(this.llmId)) && this.llms.length > 0) {
            this.llmId = this.llms[0].id;
            this._changeDetectorRef.markForCheck();
        }
        this.updateThinkingIcon();
    }

    updateThinkingIcon(): void {
        this.llmHasThinkingLevels = this.llmId.startsWith('openai:o3') || this.llmId.includes('claude-3-7')
    }

    toggleThinking() {
        if (this.thinkingLevel === 'off') {
            this.thinkingLevel = 'low'
            this.thinkingIcon = 'heroicons_outline:bars-2'
        } else if (this.thinkingLevel === 'low') {
            this.thinkingLevel = 'medium'
            this.thinkingIcon = 'heroicons_outline:bars-3'
        }else if (this.thinkingLevel === 'medium') {
            this.thinkingLevel = 'high'
            this.thinkingIcon = 'heroicons_outline:bars-4'
        }else if (this.thinkingLevel === 'high') {
            this.thinkingLevel = 'off'
            this.thinkingIcon = 'heroicons_outline:minus-small'
        }
    }

    /**
     * Open the chat info drawer
     */
    openChatInfo(): void {
        this.drawerOpened = true;
        this._changeDetectorRef.markForCheck();
    }

    /**
     * Reset the chat
     */
    resetChat(): void {
        this._chatService.resetChat();
        // Ensure LLM selector is set when resetting
        this.updateLlmSelector();
    }

    /**
     * Delete the current chat
     */
    deleteChat(): void {
        if (this.chat && this.chat.id) {
            const confirmation = this._fuseConfirmationService.open({
                title: 'Delete chat',
                message:
                    'Are you sure you want to delete this chat?',
                actions: {
                    confirm: {
                        label: 'Delete',
                    },
                },
            });

            confirmation.afterClosed().subscribe((result) => {
                if (result === 'confirmed') {
                    this._chatService.deleteChat(this.chat.id).subscribe(() => {
                        this.router.navigate(['/ui/chat']).catch(console.error)
                    });
                    // TODO handle error - show toast
                }
            });
        }
    }

    /**
     * Track by function for ngFor loops
     *
     * @param index
     * @param item
     */
    trackByFn(index: number, item: any): any {
        return item.id;
    }

    /**
     * Sends a message in the chat after getting the latest user preferences
     * Handles both new chat creation and message sending in existing chats
     */
    /**
     * Sends a message in the chat after getting the latest user preferences
     * Handles both new chat creation and message sending in existing chats
     */
    sendMessage(): void {
        // Store message and attachments in component scope so error handler can access them
        let message: string = this.messageInput.nativeElement.value.trim();
        const attachments: Attachment[] = this.selectedFiles.map(file => ({
            type: file.type.startsWith('image/') ? 'image' : 'file',
            filename: file.name,
            size: file.size,
            data: file,
            mimeType: file.type,
        }));

        // Get latest user preferences before sending the message
        this._getUserPreferences().pipe(
            switchMap(user => {
                if (message === '' && this.selectedFiles.length === 0) {
                    return EMPTY;
                }

                this.generating = true;
                // this.sendIcon = 'heroicons_outline:stop-circle'

                this.chat.messages.push({
                    id: uuidv4(),
                    textContent: message,
                    isMine: true,
                    attachments: attachments,
                });

                const generatingMessage: ChatMessage = {
                    id: uuidv4(),
                    textContent: '',
                    isMine: false,
                    generating: true
                };
                this.chat.messages.push(generatingMessage);

                // Animate the typing/generating indicator
                this.generatingTimer = setInterval(() => {
                    generatingMessage.textContent = generatingMessage.textContent.length === 3 ? '.' : generatingMessage.textContent + '.';
                    this._changeDetectorRef.markForCheck();
                }, 800);

                // Clear the input
                this.messageInput.nativeElement.value = '';
                this.selectedFiles = [];

                const options = {...user.chat, thinking: this.llmHasThinkingLevels ? this.thinkingLevel : null }

                // If this is a new chat, create it with latest user preferences
                if (!this.chat.id || this.chat.id === NEW_CHAT_ID) {
                    this._changeDetectorRef.markForCheck();
                    return this._chatService.createChat(message, this.llmId, options, attachments);
                }

                this._scrollToBottom();
                return this._chatService.sendMessage(this.chat.id, message, this.llmId, options, attachments);
            })
        ).subscribe({
            next: (chat: Chat) => {
                this.generating = false;

                if (!this.chat.id || this.chat.id === NEW_CHAT_ID) {
                    clearInterval(this.generatingTimer);
                    this.router.navigate([`/ui/chat/${chat.id}`]).catch(console.error);
                    return;
                }
                console.log(this.chat.messages.at(-1))
                this.chat = clone(chat);
                this.assignUniqueIdsToMessages(this.chat.messages);
                clearInterval(this.generatingTimer);
                this.sendIcon = 'heroicons_outline:paper-airplane';
                this._resizeMessageInput();
                this._scrollToBottom();
                this._changeDetectorRef.markForCheck();
            },
            error: (error) => {
                console.error('Error sending message:', error);
                this.generating = false;

                // Remove the two pending messages
                this.chat.messages.pop(); // Remove generating message
                this.chat.messages.pop(); // Remove user message
                
                // Restore the message input and files
                this.messageInput.nativeElement.value = message;
                this.selectedFiles = attachments.map(a => a.data);
                
                // Reset UI state
                clearInterval(this.generatingTimer);

                this.sendIcon = 'heroicons_outline:paper-airplane';
                
                // Show error message
                this._snackBar.open(
                    'Failed to send message. Please try again.',
                    'Close',
                    {
                        duration: 5000,
                        horizontalPosition: 'center',
                        verticalPosition: 'bottom',
                        panelClass: ['error-snackbar']
                    }
                );
                
                this._changeDetectorRef.markForCheck();
            }
        });
    }

    private assignUniqueIdsToMessages(messages: ChatMessage[]): void {
        const existingIds = new Set<string>();
        messages.forEach((message) => {
            if (message.id && !existingIds.has(message.id)) {
                existingIds.add(message.id);
            } else {
                message.id = uuidv4();
                existingIds.add(message.id);
            }
        });
    }

    private _scrollToBottom(): void {
        setTimeout(() => {
            const chatElement = this._elementRef.nativeElement.querySelector('.conversation-container');
            chatElement.scrollTop = chatElement.scrollHeight;
        });
    }

    /**
     * Gets the latest user preferences from the server
     * @returns Observable of the user data or error
     */
    private _getUserPreferences(): Observable<User> {
        // Show loading state while fetching preferences
        this.generating = true;
        
        return this.userService.get().pipe(
            catchError(error => {
                console.error('Error fetching user preferences:', error);
                this._snackBar.open(
                    'Unable to load user preferences. Using default settings.',
                    'Close',
                    {
                        duration: 5000,
                        horizontalPosition: 'center',
                        verticalPosition: 'bottom',
                        panelClass: ['warning-snackbar']
                    }
                );
                // Return current user as fallback
                return this.currentUser ? [this.currentUser] : EMPTY;
            })
        );
    }

    handleLlmKeydown(event: KeyboardEvent) {
        if (event.key === 'Enter') {
            event.preventDefault();
            event.stopPropagation();
            this.messageInput.nativeElement.focus();
        }
    }

    @HostListener('keydown', ['$event'])
    handleKeyboardEvent(event: KeyboardEvent): void {
        if (this.sendOnEnter && event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            this.sendMessage();
        }

        if (event.key === 'm' && event.ctrlKey) {
            this.llmSelect.open();
            this.llmSelect.focus();
        }
        if (event.key === 'a' && event.ctrlKey) {
            this.fileInput.nativeElement.click();
        }
        if (event.key === 'e' && event.ctrlKey) {
            this.toggleSendOnEnter();
        }
        if (event.key === 'i' && event.ctrlKey) {
            this.drawerOpened = !this.drawerOpened
        }
        if (event.key === 't' && event.ctrlKey && this.llmHasThinkingLevels) {
            this.toggleThinking();
        }
    }

    toggleSendOnEnter(): void {
        this.sendOnEnter = !this.sendOnEnter;
        this._changeDetectorRef.markForCheck();
        this.enterStateIcon = this.sendOnEnter ? 'heroicons_outline:paper-airplane' : 'keyboard_return';
    }

    startRecording(): void {
        if (this.recording) return;

        navigator.mediaDevices.getUserMedia({ audio: true })
            .then(stream => {
                this.recording = true;
                this.mediaRecorder = new MediaRecorder(stream);
                this.mediaRecorder.start();
                this.audioChunks = [];

                this.mediaRecorder.addEventListener('dataavailable', event => {
                    this.audioChunks.push(event.data);
                });

                this.mediaRecorder.addEventListener('stop', () => {
                    const audioBlob = new Blob(this.audioChunks, { type: 'audio/webm' });
                    this.audioChunks = [];

                    // Send the audio message
                    this.sendAudioMessage(audioBlob);
                });
            })
            .catch(error => {
                console.error('Error accessing microphone', error);
                // TODO Handle permission errors or show a message to the user
            });
    }

    stopRecording(): void {
        if (!this.recording) return;

        this.recording = false;
        this.mediaRecorder.stop();

        // Stop all tracks to release the microphone
        this.mediaRecorder.stream.getTracks().forEach(track => track.stop());
    }

    /**
     * Regenerates an AI message and removes all subsequent messages.
     * Uses the last user message before the selected AI message as the prompt.
     * 
     * @param messageIndex - The index of the AI message to regenerate
     * @throws Error if no user message is found before the AI message
     */
    regenerateMessage(messageIndex: number): void {
        if (!this.chat?.messages) {
            console.warn('No chat or messages found');
            return;
        }

        // Find the last user message before the AI message we want to regenerate
        let lastUserMessage: string;
        for (let i = messageIndex; i >= 0; i--) {
            if (this.chat.messages[i].isMine) {
                lastUserMessage = this.chat.messages[i].textContent;
                break;
            }
        }

        if (!lastUserMessage) {
            return;
        }

        // Remove all messages from the regeneration point onwards
        this.chat.messages = this.chat.messages.slice(0, messageIndex);
        
        // Call sendMessage with the last user message
        this.sendIcon = 'heroicons_outline:stop-circle';
        this.generating = true;
        this._chatService.regenerateMessage(this.chat.id, lastUserMessage, this.llmId)
            .subscribe(() => {
                this.generating = false;
                this.sendIcon = 'heroicons_outline:paper-airplane';
                this._scrollToBottom();
                this._changeDetectorRef.markForCheck();
            });
        // TODO catch errors and set this.generating=false
    }

    sendAudioMessage(audioBlob: Blob): void {
        this._chatService.sendAudioMessage(this.chat.id, this.llmId, audioBlob).subscribe(
            () => {
                // Handle successful send, update the UI if necessary
                this._changeDetectorRef.markForCheck();
            },
            error => {
                // Handle error
                console.error('Error sending audio message', error);
            }
        );
    }

    onFileSelected(event: Event): void {
        const input = event.target as HTMLInputElement;
        if (input.files) {
            this.addFiles(Array.from(input.files));
        }
    }

    removeFile(file: File): void {
        const index = this.selectedFiles.indexOf(file);
        if (index > -1) {
            this.selectedFiles.splice(index, 1);
            this._changeDetectorRef.markForCheck();
        }
    }

    onDragOver(event: DragEvent): void {
        event.preventDefault();
        event.stopPropagation();
    }

    onDrop(event: DragEvent): void {
        event.preventDefault();
        event.stopPropagation();
        
        const files = Array.from(event.dataTransfer?.files || []);
        this.addFiles(files);
    }

    private addFiles(files: File[]): void {
        // 10MB limit per file
        const MAX_FILE_SIZE = 10 * 1024 * 1024;
        
        files.forEach(file => {
            if (file.size > MAX_FILE_SIZE) {
                // TODO: Show error toast
                console.error(`File ${file.name} exceeds 10MB limit`);
                return;
            }
            if (!this.selectedFiles.find(f => f.name === file.name)) {
                console.log(`Adding file ${file.name}`)
                this.selectedFiles.push(file);
            }
        });
        
        this._changeDetectorRef.markForCheck();
    }
}

function clone<T>(obj: T): T {
    return structuredClone(obj);
}
