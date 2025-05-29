import { ClipboardModule } from '@angular/cdk/clipboard';
import { TextFieldModule } from '@angular/cdk/text-field';
import { CommonModule, NgClass } from '@angular/common';
import {
	type AfterViewInit,
	ChangeDetectionStrategy,
	Component,
	DestroyRef,
	ElementRef,
	HostListener,
	NgZone,
	type OnDestroy,
	type OnInit,
	type Signal,
	ViewChild,
	ViewEncapsulation,
	type WritableSignal,
	computed,
	inject,
	signal,
} from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { ReactiveFormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatMenuModule } from '@angular/material/menu';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { type MatSelect, MatSelectModule } from '@angular/material/select';
import { MatSidenavModule } from '@angular/material/sidenav';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { ActivatedRoute, Router, RouterLink, RouterModule } from '@angular/router';
import { FuseMediaWatcherService } from '@fuse/services/media-watcher';
import { SafeHtmlPipe } from 'app/core/pipes/safe-html.pipe';
import { UserService } from 'app/core/user/user.service';
import { ChatInfoComponent } from 'app/modules/chat/chat-info/chat-info.component';
import { type Chat, type ChatMessage, NEW_CHAT_ID } from 'app/modules/chat/chat.types';
import type { Attachment } from 'app/modules/message.types';
import { MarkdownModule, MarkdownService, MarkedRenderer, provideMarkdown } from 'ngx-markdown';
import { EMPTY, type Observable, catchError, combineLatest, distinctUntilChanged, from, interval, switchMap, tap } from 'rxjs';
import { v4 as uuidv4 } from 'uuid';
import type { UserContentExt } from '#shared/llm/llm.model';
import { UserProfile } from '#shared/user/user.model';
import { FuseConfirmationService } from '../../../../@fuse/services/confirmation';
import { type LLM, LlmService } from '../../llm.service';
import { attachmentsAndTextToUserContentExt, fileToAttachment, userContentExtToAttachmentsAndText } from '../../messageUtil';
import { ChatServiceClient } from '../chat.service';
import { ClipboardButtonComponent } from './clipboard-button.component';

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
		MatIconModule,
		MatMenuModule,
		MatButtonModule,
		MatMenuModule,
		MatTooltipModule,
		CommonModule,
		MatFormFieldModule,
		MatProgressSpinnerModule,
		MatInputModule,
		TextFieldModule,
		MarkdownModule,
		RouterModule,
		MatSelectModule,
		ReactiveFormsModule,
		ClipboardButtonComponent,
		ClipboardModule,
		// SafeHtmlPipe, // Removed as it's not used
		NgClass,
	],
	providers: [provideMarkdown()],
})
export class ConversationComponent implements OnInit, OnDestroy, AfterViewInit {
	@ViewChild('messageInput') messageInput: ElementRef;
	@ViewChild('llmSelect') llmSelect: MatSelect;
	@ViewChild('fileInput') fileInput: ElementRef;

	// Signals for state
	selectedAttachments: WritableSignal<Attachment[]> = signal([]);
	chat: Signal<Chat | null>; // Will be assigned from service signal
	chats: Signal<Chat[] | null>; // Will be assigned from service signal
	drawerMode: WritableSignal<'over' | 'side'> = signal('side');
	drawerOpened: WritableSignal<boolean> = signal(false);

	llmsSignal: Signal<LLM[]>;
	llmId: WritableSignal<string | undefined> = signal(undefined);
	defaultChatLlmId = computed(() => (this.userService.userProfile() as any)?.chat?.defaultLLM);

	sendIcon: WritableSignal<string> = signal('heroicons_outline:paper-airplane');

	sendOnEnter: WritableSignal<boolean> = signal(true);
	enterStateIcon = computed(() => (this.sendOnEnter() ? 'heroicons_outline:paper-airplane' : 'keyboard_return'));

	llmHasThinkingLevels = computed(() => {
		const currentLlmId = this.llmId();
		if (!currentLlmId) return false;
		return (
			currentLlmId.startsWith('openai:o') || currentLlmId.includes('claude-3-7') || currentLlmId.includes('claude-4') || currentLlmId.includes('flash-2.5')
		);
	});
	thinkingIcon: WritableSignal<string> = signal('heroicons_outline:minus-small');
	thinkingLevel: WritableSignal<'off' | 'low' | 'medium' | 'high'> = signal('off');

	autoReformatEnabled: WritableSignal<boolean> = signal(false);

	private mediaRecorder: MediaRecorder;
	private audioChunks: Blob[] = [];
	recording: WritableSignal<boolean> = signal(false);
	/** If we're waiting for a response from the LLM after sending a message */
	generating: WritableSignal<boolean> = signal(false);

	private generatingAIMessage: WritableSignal<ChatMessage | null> = signal(null); // For "..." AI message

	readonly clipboardButton = ClipboardButtonComponent;

	// Add this property to track the previous chat ID
	private previousChatId: string | null | undefined = undefined;

	// Computed signal for displaying messages (service messages + pending messages)
	displayedMessages = computed(() => {
		const currentChat = this.chat();
		const messagesToShow = currentChat?.messages ? [...currentChat.messages] : [];

		// Parse messages to populate textChunks
		const messagesToProcess: ChatMessage[] = currentChat?.messages
			? currentChat.messages.map((m) => ({ ...m }))
			: // Creates shallow copies
				[];

		// Add generating AI message placeholder if it exists
		const generatingAiMsg = this.generatingAIMessage();
		if (generatingAiMsg) {
			messagesToProcess.push(generatingAiMsg);
		}

		return messagesToProcess.map((msg) => {
			const { attachments, text } = userContentExtToAttachmentsAndText(msg.content);
			const uiImageAttachments = attachments.filter((a) => a.type === 'image');
			const uiFileAttachments = attachments.filter((a) => a.type === 'file');

			return {
				...msg,
				textContentForDisplay: text,
				uiImageAttachments: uiImageAttachments.length > 0 ? uiImageAttachments : undefined,
				uiFileAttachments: uiFileAttachments.length > 0 ? uiFileAttachments : undefined,
				textChunks: parseMessageContent(text),
			};
		});
	});

	/**
	 * For the Markdown component, the syntax highlighting support has the plugins defined
	 * in the angular.json file. Currently just a select few languages are included.
	 */
	private _chatService = inject(ChatServiceClient);
	private _fuseMediaWatcherService = inject(FuseMediaWatcherService);
	private _fuseConfirmationService = inject(FuseConfirmationService);
	private _ngZone = inject(NgZone);
	private _elementRef = inject(ElementRef);
	private _markdown = inject(MarkdownService);
	private llmService = inject(LlmService);
	private router = inject(Router);
	private route = inject(ActivatedRoute);
	protected userService = inject(UserService);
	private _snackBar = inject(MatSnackBar);
	private destroyRef = inject(DestroyRef);
	private routeParamsSignal: Signal<any>;

	constructor() {
		this.chat = this._chatService.chat;
		this.chats = this._chatService.chats;
		this.llmsSignal = computed(() => {
			const state = this.llmService.llmsState();
			return state.status === 'success' ? state.data : [];
		});
		this.routeParamsSignal = toSignal(this.route.params, { initialValue: {} });

		// Load LLMs
		this.llmService.loadLlms();

		// Ensure user profile is loaded for default LLM selection
		const currentUserProfile = this.userService.userProfile();
		if (!currentUserProfile) {
			this.userService.loadUser();
		}

		// Handle route changes and load chat data
		toObservable(this.routeParamsSignal)
			.pipe(distinctUntilChanged(), takeUntilDestroyed(this.destroyRef))
			.subscribe((params) => {
				const chatId = params.id;
				if (chatId) {
					this._chatService
						.loadChatById(chatId)
						.pipe(
							takeUntilDestroyed(this.destroyRef),
							catchError((err) => {
								console.error('Failed to load chat by ID', err);
								this.router.navigate(['/ui/chat']).catch(console.error);
								return EMPTY;
							}),
						)
						.subscribe();
				} else {
					this._chatService.setChat({ id: NEW_CHAT_ID, messages: [], title: '', updatedAt: Date.now() });
				}
			});

		// Handle chat changes and update component state
		toObservable(this.chat)
			.pipe(takeUntilDestroyed(this.destroyRef))
			.subscribe((currentChat) => {
				const currentChatId = currentChat?.id;

				// Only reset generating states if the chat ID has actually changed,
				// or if the chat becomes null (e.e., after a reset).
				if (currentChatId !== this.previousChatId) {
					this.generating.set(false);
					this.generatingAIMessage.set(null);
				}

				if (currentChat?.messages) {
					this.assignUniqueIdsToMessages(currentChat.messages); // Ensure messages have IDs for trackBy
				}
				this.updateLlmSelector();

				// Update previousChatId for the next run
				this.previousChatId = currentChatId;
			});

		// Watch for user profile changes and update LLM selector
		toObservable(this.userService.userProfile)
			.pipe(takeUntilDestroyed(this.destroyRef), distinctUntilChanged())
			.subscribe((userProfile) => {
				if (userProfile) {
					console.log('User profile loaded, updating LLM selector with default:', (userProfile as any).chat?.defaultLLM);
					this.updateLlmSelector();
				}
			});

		// Handle animation for generating messages
		combineLatest([toObservable(this.generating), toObservable(this.generatingAIMessage)])
			.pipe(
				takeUntilDestroyed(this.destroyRef),
				switchMap(([isGenerating, aiMsg]) => {
					if (isGenerating && aiMsg && aiMsg.generating) {
						return interval(800).pipe(
							tap(() => {
								this.generatingAIMessage.update((gm) => {
									if (!gm) return null;
									const newTextContent = gm.content === '.' ? '..' : gm.content === '..' ? '...' : '.';
									return {
										...gm,
										content: newTextContent, // Update UserContentExt string
										textContent: newTextContent, // Also update textContent
										// textChunks will be derived by displayedMessages
									};
								});
							}),
						);
					}
					return EMPTY;
				}),
			)
			.subscribe();

		// Load initial list of chats
		this._chatService
			.loadChats()
			.pipe(
				takeUntilDestroyed(this.destroyRef), // Add takeUntilDestroyed
				catchError((err) => {
					console.error('Failed to load chats list', err);
					return EMPTY;
				}),
			)
			.subscribe();
	}

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
				// Get the scrollHeight and subtract the vertical padding
				this.messageInput.nativeElement.style.height = `${this.messageInput.nativeElement.scrollHeight}px`;
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

		// Most initialization is now handled in constructor effects.
		// Media watcher subscription now uses takeUntilDestroyed
		this._fuseMediaWatcherService.onMediaChange$
			.pipe(takeUntilDestroyed(this.destroyRef)) // Using takeUntilDestroyed
			.subscribe(({ matchingAliases }) => {
				this.drawerMode.set(matchingAliases.includes('lg') ? 'side' : 'over');
			});
	}

	ngOnDestroy(): void {}

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
	updateLlmSelector(): void {
		const llms = this.llmsSignal();
		if (!llms || llms.length === 0) {
			console.log('updateLlmSelector: No LLMs available');
			return;
		}

		const llmIds = llms.map((llm) => llm.id);
		const currentChat = this.chat();
		console.log('updateLlmSelector: Current chat:', currentChat?.id, 'Messages count:', currentChat?.messages?.length || 0);

		// For existing chats with messages, use the last message's LLM if still available
		if (currentChat?.messages?.length > 0) {
			const lastMessageLlmId = currentChat.messages.at(-1).llmId;
			console.log('updateLlmSelector: Last message LLM ID:', lastMessageLlmId);
			if (lastMessageLlmId && llmIds.includes(lastMessageLlmId)) {
				console.log('updateLlmSelector: Using LLM from last message:', lastMessageLlmId);
				this.llmId.set(lastMessageLlmId);
				// this.updateThinkingIcon(); // This will be handled by computed llmHasThinkingLevels
				return;
			}
		}

		// Try to use default LLM (derived from currentUserSignal)
		// Access defaultChatLlmId computed signal
		const defaultLlm = this.defaultChatLlmId();
		console.log('updateLlmSelector: Default LLM from user profile:', defaultLlm);
		if (defaultLlm && llmIds.includes(defaultLlm)) {
			console.log('updateLlmSelector: Using default LLM:', defaultLlm);
			this.llmId.set(defaultLlm);
			// this.updateThinkingIcon();
			return;
		}

		// If default LLM is set but not available, log warning
		if (defaultLlm && !llmIds.includes(defaultLlm)) {
			console.warn(`updateLlmSelector: Default LLM ${defaultLlm} not found in available LLMs:`, llmIds);
		}

		// Fallback to first available LLM if no valid selection
		const currentLlmId = this.llmId();
		console.log('updateLlmSelector: Current LLM ID:', currentLlmId);
		if ((!currentLlmId || !llmIds.includes(currentLlmId)) && llms.length > 0) {
			console.log('updateLlmSelector: Falling back to first available LLM:', llms[0].id);
			this.llmId.set(llms[0].id);
		} else {
			console.log('updateLlmSelector: Keeping current LLM ID:', currentLlmId);
		}
		// this.updateThinkingIcon();
	}

	// updateThinkingIcon is replaced by computed llmHasThinkingLevels

	toggleThinking(): void {
		const currentLevel = this.thinkingLevel();
		if (currentLevel === 'off') {
			this.thinkingLevel.set('low');
			this.thinkingIcon.set('heroicons_outline:bars-2');
		} else if (currentLevel === 'low') {
			this.thinkingLevel.set('medium');
			this.thinkingIcon.set('heroicons_outline:bars-3');
		} else if (currentLevel === 'medium') {
			this.thinkingLevel.set('high');
			this.thinkingIcon.set('heroicons_outline:bars-4');
		} else if (currentLevel === 'high') {
			this.thinkingLevel.set('off');
			this.thinkingIcon.set('heroicons_outline:minus-small');
		}
	}

	toggleAutoReformat(): void {
		this.autoReformatEnabled.update((v) => !v);
	}

	/**
	 * Open the chat info drawer
	 */
	openChatInfo(): void {
		this.drawerOpened.set(true);
	}

	/**
	 * Reset the chat
	 */
	resetChat(): void {
		this._chatService.resetChat(); // Service sets its _chat signal to null
		// The effect in constructor will handle updating llmId etc. when chat signal changes
		// Or, if immediate update is needed:
		// this.updateLlmSelector();
	}

	/**
	 * Delete the current chat
	 */
	deleteChat(): void {
		const currentChat = this.chat();
		if (currentChat?.id && currentChat.id !== NEW_CHAT_ID) {
			const confirmation = this._fuseConfirmationService.open({
				title: 'Delete chat',
				message: 'Are you sure you want to delete this chat?',
				actions: {
					confirm: {
						label: 'Delete',
					},
				},
			});

			confirmation.afterClosed().subscribe((result: string) => {
				if (result === 'confirmed') {
					this._chatService.deleteChat(currentChat.id).subscribe({
						next: () => {
							this.router.navigate(['/ui/chat']).catch(console.error);
							// Optionally show success toast
						},
						error: (err) => {
							console.error('Failed to delete chat', err);
							this._snackBar.open('Failed to delete chat.', 'Close', { duration: 3000 });
						},
					});
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
	async sendMessage(): Promise<void> {
		// Make method async
		const messageText: string = this.messageInput.nativeElement.value.trim();
		const attachments: Attachment[] = [...this.selectedAttachments()];

		if (messageText === '' && attachments.length === 0) return;

		const currentUser = this.userService.userProfile();
		if (!currentUser) {
			this._snackBar.open('User data not loaded. Cannot send message.', 'Close', { duration: 3000 });
			return;
		}
		const currentLlmId = this.llmId();
		if (!currentLlmId) {
			this._snackBar.open('LLM not selected. Cannot send message.', 'Close', { duration: 3000 });
			return;
		}

		this.generating.set(true);
		this.sendIcon.set('heroicons_outline:stop-circle'); // Or use a different icon for "sending"

		const userContentPayload: UserContentExt = await attachmentsAndTextToUserContentExt(attachments, messageText); // await the async function
		const enableReformat = this.autoReformatEnabled();

		// Optimistic UI update: add a "generating" placeholder for AI
		const aiGeneratingMessageEntry: ChatMessage = {
			id: uuidv4(),
			content: '.', // UserContentExt can be a string for simple text
			textContent: '.', // Required by UIMessage
			isMine: false,
			generating: true,
			createdAt: new Date().toISOString(),
			// textChunks will be derived in displayedMessages
		};
		this.generatingAIMessage.set(aiGeneratingMessageEntry);

		this._scrollToBottom(); // Scroll after adding optimistic messages

		// Clear input and selected attachments
		this.messageInput.nativeElement.value = '';
		this.selectedAttachments.set([]);

		const options = { ...currentUser.chat, thinking: this.llmHasThinkingLevels() ? this.thinkingLevel() : null };
		// userContentPayload is already created above for the optimistic update

		let apiCall: Observable<any>;
		const currentChat = this.chat();

		if (!currentChat || currentChat.id === NEW_CHAT_ID) {
			// Pass empty array for attachmentsToSend as it's now part of userContentPayload
			apiCall = this._chatService.createChat(userContentPayload, currentLlmId, options, enableReformat);
		} else {
			// Pass empty array for attachmentsToSend as it's now part of userContentPayload
			// The service's sendMessage still accepts attachmentsForUI, which is fine. We pass undefined if not needed or the component's attachments.
			// For now, let's assume attachments are handled by userContentPayload for the API, and UI attachments are for local display if needed by service.
			// The service's sendMessage signature is: (chatId: string, userContent: UserContentExt, llmId: string, options?: CallSettings, attachmentsForUI?: Attachment[], autoReformat?: boolean)
			// We can pass the original `attachments` array for `attachmentsForUI` if the service uses it for optimistic updates.
			apiCall = this._chatService.sendMessage(currentChat.id, userContentPayload, currentLlmId, options, attachments, enableReformat);
		}

		apiCall.subscribe({
			next: (newOrUpdatedChat?: Chat) => {
				// createChat returns Chat, sendMessage returns void (updates signal)
				if (newOrUpdatedChat && (!currentChat || currentChat.id === NEW_CHAT_ID)) {
					// Navigating to new chat ID, service would have updated the main chat signal
					this.router.navigate([`/ui/chat/${newOrUpdatedChat.id}`]).catch(console.error);
				}
				// For sendMessage, the service updates its chat signal, which the component's effect will pick up.
				// For createChat, the service also updates its chat signal.
			},
			error: (error) => {
				console.error('Error sending message:', error);
				this._snackBar.open('Failed to send message. Please try again.', 'Close', { duration: 5000, panelClass: ['error-snackbar'] });
				// Restore input if needed, though optimistic updates are cleared by effect
				this.messageInput.nativeElement.value = messageText;
				this.selectedAttachments.set(attachments);
				// Reset generating states here as well, as the main effect might not run if chat doesn't change
				this.generating.set(false);
				this.generatingAIMessage.set(null);
				this.sendIcon.set('heroicons_outline:paper-airplane');
			},
			complete: () => {
				this.generating.set(false);
				this.generatingAIMessage.set(null);
				this.sendIcon.set('heroicons_outline:paper-airplane');
				this._resizeMessageInput();
				this._scrollToBottom();
			},
		});
	}

	// Ensure messages have unique IDs for ngFor trackBy
	private assignUniqueIdsToMessages(messages: ChatMessage[] | undefined): void {
		if (!messages) return;
		const existingIds = new Set<string>();
		messages.forEach((message) => {
			if (message.id && !existingIds.has(message.id)) {
				existingIds.add(message.id);
			} else {
				const newId = uuidv4();
				message.id = newId; // Note: This mutates the message object.
				existingIds.add(newId);
			}
		});
	}

	private _scrollToBottom(): void {
		this._ngZone.runOutsideAngular(() => {
			setTimeout(() => {
				const chatElement = this._elementRef.nativeElement.querySelector('.conversation-container');
				if (chatElement) {
					chatElement.scrollTop = chatElement.scrollHeight;
				}
			}, 0);
		});
	}

	// _getUserPreferences is implicitly handled by currentUserSignal reacting to userService.user$

	handleLlmKeydown(event: KeyboardEvent): void {
		if (event.key === 'Enter') {
			event.preventDefault();
			event.stopPropagation();
			this.messageInput.nativeElement.focus();
		}
	}

	@HostListener('keydown', ['$event'])
	handleKeyboardEvent(event: KeyboardEvent): void {
		if (this.sendOnEnter() && event.key === 'Enter' && !event.shiftKey) {
			event.preventDefault();
			this.sendMessage();
		}

		if (event.key === 'm' && event.ctrlKey) {
			this.llmSelect?.open();
			this.llmSelect?.focus();
		}
		if (event.key === 'a' && event.ctrlKey) {
			this.fileInput?.nativeElement.click();
		}
		if (event.key === 'e' && event.ctrlKey) {
			this.toggleSendOnEnter();
		}
		if (event.key === 'i' && event.ctrlKey) {
			this.drawerOpened.update((v) => !v);
		}
		if (event.key === 't' && event.ctrlKey && this.llmHasThinkingLevels()) {
			this.toggleThinking();
		}
		if (event.key === 'f' && event.ctrlKey) {
			event.preventDefault();
			this.toggleAutoReformat();
		}

		if (event.key === 'f' && event.ctrlKey && !event.shiftKey) {
			// Ensure Shift is not pressed for this one
			event.preventDefault();
			event.stopPropagation();

			const currentText = this.messageInput.nativeElement.value;
			if (currentText && currentText.trim() !== '') {
				this._chatService
					.formatMessageAsMarkdown(currentText)
					.pipe(takeUntilDestroyed(this.destroyRef))
					.subscribe({
						next: (formattedText: string) => {
							this.messageInput.nativeElement.value = formattedText;
							this._resizeMessageInput();
						},
						error: (err) => {
							console.error('Error formatting message:', err);
							this._snackBar.open('Failed to format message as Markdown.', 'Close', { duration: 3000 });
						},
					});
			}
		}
	}

	toggleSendOnEnter(): void {
		this.sendOnEnter.update((v) => !v);
		// enterStateIcon is a computed signal, no need to set it manually
	}

	startRecording(): void {
		if (this.recording()) return;

		navigator.mediaDevices
			.getUserMedia({ audio: true })
			.then((stream) => {
				this.recording.set(true);
				this.mediaRecorder = new MediaRecorder(stream);
				this.mediaRecorder.start();
				this.audioChunks = [];

				this.mediaRecorder.addEventListener('dataavailable', (event) => {
					this.audioChunks.push(event.data);
				});

				this.mediaRecorder.addEventListener('stop', () => {
					const audioBlob = new Blob(this.audioChunks, { type: 'audio/webm' });
					this.audioChunks = [];
					this.sendAudioMessage(audioBlob);
				});
			})
			.catch((error) => {
				console.error('Error accessing microphone', error);
				this._snackBar.open('Error accessing microphone.', 'Close', { duration: 3000 });
			});
	}

	stopRecording(): void {
		if (!this.recording()) return;

		if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
			this.mediaRecorder.stop();
		}
		this.recording.set(false);

		// Stop all tracks to release the microphone
		if (this.mediaRecorder?.stream) {
			this.mediaRecorder.stream.getTracks().forEach((track) => track.stop());
		}
	}

	/**
	 * Regenerates an AI message and removes all subsequent messages.
	 * Uses the last user message before the selected AI message as the prompt.
	 *
	 * @param messageIndex - The index of the AI message to regenerate
	 * @throws Error if no user message is found before the AI message
	 */
	regenerateMessage(messageIndex: number): void {
		const currentChat = this.chat();
		if (!currentChat?.messages || !currentChat.id || currentChat.id === NEW_CHAT_ID) {
			console.warn('No chat or messages found, or chat is new.');
			return;
		}
		const currentLlmId = this.llmId();
		if (!currentLlmId) {
			this._snackBar.open('LLM not selected. Cannot regenerate.', 'Close', { duration: 3000 });
			return;
		}

		let lastUserMessageContent: UserContentExt | undefined;
		// Find the user message that led to the AI response at messageIndex
		// This logic might need to be more robust depending on how regeneration is defined.
		// Assuming we regenerate based on the user message immediately preceding the AI message at messageIndex,
		// or the last user message if messageIndex points to a user message.
		let userMessagePromptIndex = -1;
		for (let i = messageIndex - 1; i >= 0; i--) {
			if (currentChat.messages[i].isMine) {
				lastUserMessageContent = currentChat.messages[i].content;
				userMessagePromptIndex = i;
				break;
			}
		}

		if (!lastUserMessageContent) {
			this._snackBar.open('Could not find a user message to regenerate from.', 'Close', { duration: 3000 });
			return;
		}

		// KEEP Optimistic update for generatingAIMessage
		const aiGeneratingMessageEntry: ChatMessage = {
			id: uuidv4(),
			content: '.', // UserContentExt can be a string for simple text
			textContent: '.', // Required by UIMessage
			isMine: false,
			generating: true,
			createdAt: new Date().toISOString(),
			// textChunks will be derived in displayedMessages
		};
		this.generatingAIMessage.set(aiGeneratingMessageEntry);
		this.generating.set(true);
		this.sendIcon.set('heroicons_outline:stop-circle');

		// The service's regenerateMessage should handle updating the chat signal correctly,
		// potentially by removing subsequent messages and adding the new AI response.
		this._chatService.regenerateMessage(currentChat.id, lastUserMessageContent, currentLlmId, userMessagePromptIndex + 1).subscribe({
			error: (err) => {
				console.error('Error regenerating message:', err);
				this._snackBar.open('Failed to regenerate message.', 'Close', { duration: 3000 });
				// Reset generating states here as well
				this.generating.set(false);
				this.generatingAIMessage.set(null);
				this.sendIcon.set('heroicons_outline:paper-airplane');
			},
			complete: () => {
				this.generating.set(false);
				this.generatingAIMessage.set(null);
				this.sendIcon.set('heroicons_outline:paper-airplane');
				this._scrollToBottom();
			},
		});
	}

	sendAudioMessage(audioBlob: Blob): void {
		const currentChat = this.chat();
		const currentLlmId = this.llmId();
		if (!currentChat || currentChat.id === NEW_CHAT_ID || !currentLlmId) {
			this._snackBar.open('Cannot send audio: No active chat or LLM selected.', 'Close', { duration: 3000 });
			return;
		}

		this.generating.set(true); // Indicate processing
		// Add optimistic UI updates if desired (e.g., "Sending audio...")

		this._chatService.sendAudioMessage(currentChat.id, currentLlmId, audioBlob).subscribe({
			error: (error) => {
				console.error('Error sending audio message', error);
				this._snackBar.open('Failed to send audio message.', 'Close', { duration: 3000 });
			},
			complete: () => {
				this.generating.set(false);
				this._scrollToBottom();
				// Optimistic UI updates would be cleared here or by the chat signal update
			},
		});
	}

	onFileSelected(event: Event): void {
		const input = event.target as HTMLInputElement;
		if (input.files) {
			this.addFiles(Array.from(input.files));
		}
	}

	removeAttachment(attachmentToRemove: Attachment): void {
		this.selectedAttachments.update((atts) => atts.filter((att) => att !== attachmentToRemove));
		// Revoke object URL if it was created for preview and is a blob URL
		if (attachmentToRemove.previewUrl?.startsWith('blob:')) {
			URL.revokeObjectURL(attachmentToRemove.previewUrl);
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
		const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB limit per file

		files.forEach(async (file) => {
			// Make callback async
			if (file.size > MAX_FILE_SIZE) {
				this._snackBar.open(`File ${file.name} exceeds 10MB limit.`, 'Close', { duration: 3000 });
				return;
			}

			// Prevent duplicates based on name AND size (more robust)
			if (this.selectedAttachments().find((att) => att.filename === file.name && att.size === file.size)) {
				return;
			}

			// Convert File to Attachment using the utility
			const newAttachment = await fileToAttachment(file); // This handles previewUrl internally
			this.selectedAttachments.update((atts) => [...atts, newAttachment]);
		});
		// No explicit markForCheck needed after batch if selectedAttachments is a signal
	}

	protected readonly NEW_CHAT_ID = NEW_CHAT_ID;
}

export function parseMessageContent(textContent: string | undefined | null): Array<{ type: 'text' | 'markdown'; value: string }> {
	if (!textContent) {
		return [];
	}

	const chunks: Array<{ type: 'text' | 'markdown'; value: string }> = [];
	// Regex to find fenced code blocks (e.g., ```lang\ncode\n``` or ```\ncode\n```)
	// Note: In this string, backslashes for the regex are already escaped (e.g., \n becomes \\n for the TS regex engine).
	const codeBlockRegex = /```(?:[a-zA-Z0-9\-+_]*)\n([\s\S]*?)\n?```/g;

	let lastIndex = 0;
	let match: RegExpExecArray | null = null;

	// biome-ignore lint: noAssignInExpressions
	while ((match = codeBlockRegex.exec(textContent)) !== null) {
		// Add text before the code block
		if (match.index > lastIndex) {
			chunks.push({ type: 'text', value: textContent.substring(lastIndex, match.index) });
		}
		// Add the code block itself (including the fences for the markdown component)
		chunks.push({ type: 'markdown', value: match[0] });
		lastIndex = codeBlockRegex.lastIndex;
	}

	// Add any remaining text after the last code block
	if (lastIndex < textContent.length) {
		chunks.push({ type: 'text', value: textContent.substring(lastIndex) });
	}

	// If no code blocks were found, and textContent is not empty, the entire content is text
	if (chunks.length === 0 && textContent.length > 0) {
		chunks.push({ type: 'text', value: textContent });
	}

	return chunks;
}
