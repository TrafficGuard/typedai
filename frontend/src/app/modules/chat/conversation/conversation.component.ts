import { ClipboardModule } from '@angular/cdk/clipboard';
import { CdkTextareaAutosize, TextFieldModule } from '@angular/cdk/text-field';
import { CommonModule, DecimalPipe } from '@angular/common';
import {
	AfterViewInit,
	ChangeDetectionStrategy,
	Component,
	DestroyRef,
	ElementRef,
	HostListener,
	NgZone,
	OnDestroy,
	OnInit,
	Signal,
	ViewChild,
	ViewEncapsulation,
	WritableSignal,
	computed,
	effect,
	inject,
	signal,
} from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { ReactiveFormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatExpansionModule } from '@angular/material/expansion';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatMenuModule } from '@angular/material/menu';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSelect, MatSelectModule } from '@angular/material/select';
import { MatSidenavModule } from '@angular/material/sidenav';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { ActivatedRoute, Router, RouterLink, RouterModule } from '@angular/router';
import { FuseMediaWatcherService } from '@fuse/services/media-watcher';
import { LocalStorageService } from 'app/core/services/local-storage.service';
import { UserService } from 'app/core/user/user.service';
import { ChatInfoComponent } from 'app/modules/chat/chat-info/chat-info.component';
import { MarkdownFormatDialogComponent } from './markdown-format-dialog/markdown-format-dialog.component';
import { Chat, ChatMessage, NEW_CHAT_ID } from 'app/modules/chat/chat.types';
import { Attachment } from 'app/modules/message.types';
import { MarkdownModule, MarkdownService, MarkedRenderer, provideMarkdown } from 'ngx-markdown';
import { EMPTY, Observable, Subject, Subscription, catchError, combineLatest, distinctUntilChanged, from, interval, switchMap, tap } from 'rxjs';
import { debounceTime } from 'rxjs/operators';
import { v4 as uuidv4 } from 'uuid';
import type { ThinkingLevel, GenerateTextOptions } from '#shared/llm/llm.model';
import { LlmInfo, UserContentExt } from '#shared/llm/llm.model';
import { UserProfile } from '#shared/user/user.model';
import { FuseConfirmationService } from '../../../../@fuse/services/confirmation';
import { LlmService } from '../../llm.service';
import { attachmentsAndTextToUserContentExt, fileToAttachment, userContentExtToAttachmentsAndText } from '../../messageUtil';
import { ChatServiceClient } from '../chat.service';
import { ClipboardButtonComponent } from './clipboard-button.component';

/** How long to wait for CdkTextareaAutosize to finish (ms) */
const CARET_SCROLL_DELAY = 50;

@Component({
	selector: 'chat-conversation',
	templateUrl: './conversation.component.html',
	styleUrls: ['./conversation.component.scss'],
	encapsulation: ViewEncapsulation.None,
	changeDetection: ChangeDetectionStrategy.OnPush,
	standalone: true,
	imports: [
		CommonModule,
		MatSidenavModule,
		ChatInfoComponent,
		MatButtonModule,
		MatDialogModule,
		MatExpansionModule,
		MatIconModule,
		MatMenuModule,
		MatTooltipModule,
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
	],
	providers: [provideMarkdown(), DecimalPipe],
})
export class ConversationComponent implements OnInit, OnDestroy, AfterViewInit {
	@ViewChild('messageInput') messageInput: ElementRef;
	@ViewChild('messageInput', { static: false, read: CdkTextareaAutosize }) private _autosize: CdkTextareaAutosize;
	@ViewChild('llmSelect') llmSelect: MatSelect;
	@ViewChild('fileInput') fileInput: ElementRef;

	// Signals for state
	selectedAttachments: WritableSignal<Attachment[]> = signal([]);
	chat: Signal<Chat | null>; // Will be assigned from service signal
	chats: Signal<Chat[] | null>; // Will be assigned from service signal
	drawerMode: WritableSignal<'over' | 'side'> = signal('side');
	drawerOpened: WritableSignal<boolean> = signal(false);

	sendIcon: WritableSignal<string> = signal('heroicons_outline:paper-airplane');
	private streamSub: Subscription | null = null;

	llmsSignal: Signal<LlmInfo[]>;
	llmId: WritableSignal<string | undefined> = signal(undefined);
	defaultChatLlmId = computed(() => (this.userService.userProfile()?.chat?.defaultLLM));

	llmHasThinkingLevels = computed(() => {
		const id = this.llmId();
		return !!id && (
			   id.startsWith('openai:o')          ||
			   id === 'openai:gpt-5'              ||
			   id.includes('claude-3-7')          ||
			   id.includes('sonnet-4')            ||
			   id.includes('opus-4')              ||
			  (id.includes('gemini') && id.includes('2.5'))
		);
	  });

	thinkingIcon = computed(() => {
		switch (this.thinkingLevel()) {
		  case 'low'   : return 'heroicons_outline:bars-2';
		  case 'medium': return 'heroicons_outline:bars-3';
		  case 'high'  : return 'heroicons_outline:bars-4';
		  default      : return 'heroicons_outline:minus-small';
		}
	  });
	thinkingLevel: WritableSignal<'off' | 'low' | 'medium' | 'high'> = signal('off');

	autoReformatEnabled: WritableSignal<boolean> = signal(false);

	serviceTier: WritableSignal<'default' | 'flex' | 'priority'> = signal('default');

	llmSupportsServiceTiers = computed(() => {
		const id = this.llmId();
		// Service tiers are available for gpt-5 and gpt-5-mini, but not gpt-5-chat
		return !!id && (id.startsWith('openai:gpt-5') && !id.endsWith('chat'));
	});

	serviceTierIcon = computed(() => {
		switch (this.serviceTier()) {
			case 'priority': return 'stat_3';
			case 'flex': return 'chevron_right';
			default: return 'keyboard_double_arrow_right';
		}
	});

	private messageInputChanged: Subject<string> = new Subject<string>();
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
			const { attachments, text } = userContentExtToAttachmentsAndText(msg.content, msg.sources);
			const uiImageAttachments = attachments.filter((a) => a.type === 'image');
			const uiFileAttachments = attachments.filter((a) => a.type === 'file');

			return {
				...msg,
				textContentForDisplay: text,
				uiImageAttachments: uiImageAttachments.length > 0 ? uiImageAttachments : undefined,
				uiFileAttachments: uiFileAttachments.length > 0 ? uiFileAttachments : undefined,
				sources: msg.sources,
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
	private _localStorageService = inject(LocalStorageService);
	private dialog = inject(MatDialog);
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
					/* keep current chat as-is (null) so the loading spinner is shown */
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

				// Load draft message for the current chat
				if (currentChat && this.messageInput && this.messageInput.nativeElement) {
					// Only load the draft if we are NOT currently generating a response.
					// If we are generating, the input should remain cleared by sendMessage().
					if (!this.generating()) {
						const chatIdToUse = currentChat.id === NEW_CHAT_ID ? 'new' : currentChat.id;
						const draft = this._localStorageService.getDraftMessage(chatIdToUse);

						if (draft !== null) {
							this.messageInput.nativeElement.value = draft;
							this._triggerResizeAndScroll();
						} else {
							// If we switched from a different chat and there's no draft for the new chat, clear the input field.
							if (this.previousChatId !== undefined && this.previousChatId !== null && this.previousChatId !== currentChat.id) {
								this.messageInput.nativeElement.value = '';
								this._triggerResizeAndScroll();
							}
						}
					} else {
						// If we are generating, ensure the input stays cleared,
						// even if the chat signal updates during the generation phase.
						this.messageInput.nativeElement.value = '';
						this._triggerResizeAndScroll();
					}
				}

				// Update previousChatId for the next run
				this.previousChatId = currentChatId;

				// If there is a pending initial message for this chat, start streaming it now
				const pending = currentChat ? this._chatService.consumePendingInitialMessage(currentChat.id) : null;
				if (pending) {
					if (!currentChat.title || currentChat.title.trim() === '') {
						const { text } = userContentExtToAttachmentsAndText(pending.userContent);
						const previewTitle = this.makeTitleFromText(text || '');
						if (previewTitle) {
							this._chatService.setLocalChatTitle(currentChat.id, previewTitle);
						}
					}
					const sub = this._chatService
						.sendMessageStreaming(
							pending.chatId!,
							pending.userContent,
							pending.llmId,
							pending.options,
							pending.attachmentsForUI,
							pending.autoReformat,
							pending.serviceTier,
						)
						.subscribe({
							error: (error) => {
								console.error('Error sending initial message via streaming API:', error);
								this._snackBar.open('Failed to send message. Please try again.', 'Close', { duration: 5000, panelClass: ['error-snackbar'] });
								const cur = this.chat();
								if (cur) {
									const optimisticMessage = [...(cur.messages || [])].reverse().find((m) => m.isMine && m.status === 'sending');
									if (optimisticMessage) {
										this._chatService.updateMessageStatus(cur.id, optimisticMessage.id, 'failed_to_send');
									}
								}
								this.generating.set(false);
								this.generatingAIMessage.set(null);
								this.sendIcon.set('heroicons_outline:paper-airplane');
								this.streamSub = null;
							},
							complete: () => {
								this.generating.set(false);
								this.generatingAIMessage.set(null);
								this.sendIcon.set('heroicons_outline:paper-airplane');
								this._scrollToBottom();
								this._localStorageService.clearDraftMessage(currentChat.id);
								this.streamSub = null;
							},
						});
					this.streamSub = sub;
				}
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

			/* Any time llmId changes, make sure the level is valid */
			effect(() => {
				const supportsThinking = this.llmHasThinkingLevels();
				const currentLevel     = this.thinkingLevel();

				/* LLM supports thinking ➜ default to HIGH (if user hasn’t already chosen another value). */
				if (supportsThinking && currentLevel === 'off') this.thinkingLevel.set('high');

				/* LLM does *not* support thinking ➜ force OFF */
				if (!supportsThinking && currentLevel !== 'off') this.thinkingLevel.set('off');
			});
	}

	// -----------------------------------------------------------------------------------------------------
	// @ Decorated methods
	// -----------------------------------------------------------------------------------------------------

	/**
	 * Handles user typing, saves a draft, and ensures the caret remains visible.
	 * Relies on cdkTextareaAutosize for visual resizing.
	 * @private
	 */
	@HostListener('input')
	private _onUserInput(): void
	{
		/* save draft – unchanged */
		if (this.messageInput?.nativeElement) {
			this.messageInputChanged.next(this.messageInput.nativeElement.value);
		}
	
		/* keep the cursor in view */
		this._scrollToCaret();
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

		this.messageInputChanged.pipe(debounceTime(500), takeUntilDestroyed(this.destroyRef)).subscribe((draftText) => {
			const currentChat = this.chat();
			if (currentChat) {
				// Use 'new' as a special identifier for drafts of unsaved chats
				const chatIdToUse = currentChat.id === NEW_CHAT_ID ? 'new' : currentChat.id;
				this._localStorageService.saveDraftMessage(chatIdToUse, draftText);
			}
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
		// console.log('updateLlmSelector: Current chat:', currentChat?.id, 'Messages count:', currentChat?.messages?.length || 0);

		// For existing chats with messages, use the last message's LLM if still available
		if (currentChat?.messages?.length > 0) {
			const lastMessageLlmId = currentChat.messages.at(-1).llmId;
			// console.log('updateLlmSelector: Last message LLM ID:', lastMessageLlmId);
			if (lastMessageLlmId && llmIds.includes(lastMessageLlmId)) {
				// console.log('updateLlmSelector: Using LLM from last message:', lastMessageLlmId);
				this.llmId.set(lastMessageLlmId);
				// this.updateThinkingIcon(); // This will be handled by computed llmHasThinkingLevels
				return;
			}
		}

		// Try to use default LLM (derived from currentUserSignal)
		// Access defaultChatLlmId computed signal
		const defaultLlm = this.defaultChatLlmId();
		// console.log('updateLlmSelector: Default LLM from user profile:', defaultLlm);
		if (defaultLlm && llmIds.includes(defaultLlm)) {
			// console.log('updateLlmSelector: Using default LLM:', defaultLlm);
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
	}

	toggleThinking(): void {
		const currentLevel = this.thinkingLevel();
		if (currentLevel === 'off') {
			this.thinkingLevel.set('low');
		} else if (currentLevel === 'low') {
			this.thinkingLevel.set('medium');
		} else if (currentLevel === 'medium') {
			this.thinkingLevel.set('high');
		} else if (currentLevel === 'high') {
			this.thinkingLevel.set('off');
		}
	}

	toggleAutoReformat(): void {
		this.autoReformatEnabled.update((v) => !v);
	}

	toggleServiceTier(): void {
		const currentTier = this.serviceTier();
		if (currentTier === 'default') {
			this.serviceTier.set('flex');
		} else if (currentTier === 'flex') {
			this.serviceTier.set('priority');
		} else {
			this.serviceTier.set('default');
		}
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
		// If streaming is in progress, clicking send acts as "Stop"
		if (this.generating() && this.streamSub) {
			this.stopStreaming();
			return;
		}

		const chatStateBeforeSend = this.chat();

		// Capture raw input values BEFORE any processing or clearing
		const originalMessageText = this.messageInput.nativeElement.value;
		const originalAttachments = [...this.selectedAttachments()];
		const trimmedMessageTextForAPI = originalMessageText.trim();

		if (trimmedMessageTextForAPI === '' && originalAttachments.length === 0) return;

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

		// --- Start "sending" process ---
		this.generating.set(true);
		this.sendIcon.set('heroicons_outline:stop-circle');

		// Clear input and selected attachments IMMEDIATELY
		console.log('clearing input')
		this.messageInput.nativeElement.value = '';
		this.selectedAttachments.set([]);
		this._triggerResizeAndScroll(); // Resize after clearing
		// Focus the textarea to ensure UI updates
		this.messageInput.nativeElement.focus();

		try {
			// Prepare payload
			const userContentPayload: UserContentExt = await attachmentsAndTextToUserContentExt(originalAttachments, trimmedMessageTextForAPI);

			const rawThinking = this.llmHasThinkingLevels() ? this.thinkingLevel() : 'off';
			const thinking = (rawThinking === 'off' ? 'none' : rawThinking) as ThinkingLevel;

			const raw = currentUser.chat && typeof currentUser.chat === 'object' ? currentUser.chat : {};
			const baseChatOptions: Partial<GenerateTextOptions> = {
				temperature: raw.temperature,
				topP: raw.topP,
				presencePenalty: raw.presencePenalty,
				frequencyPenalty: raw.frequencyPenalty,
			};
			const options: Partial<GenerateTextOptions> = { ...baseChatOptions, thinking };
			const serviceTierPayload = this.llmSupportsServiceTiers() ? this.serviceTier() : undefined;
			const enableReformat = this.autoReformatEnabled();

			let apiCall: Observable<any>;
			const chatForAPICall = chatStateBeforeSend;
			// We stream for both new and existing chats
			const isStreaming = true;

			if (!chatForAPICall || chatForAPICall.id === NEW_CHAT_ID) {
				const sub = this._chatService.createEmptyChat().subscribe({
					next: (createdChat) => {
						this._chatService.setPendingInitialMessage({
							chatId: createdChat.id,
							userContent: userContentPayload,
							attachmentsForUI: originalAttachments,
							llmId: currentLlmId,
							options,
							autoReformat: enableReformat,
							serviceTier: serviceTierPayload,
						});
						// Set a local placeholder title from the initial text
						const previewTitle = this.makeTitleFromText(originalMessageText);
						if (previewTitle) {
							this._chatService.setLocalChatTitle(createdChat.id, previewTitle);
						}
						this.router.navigate([`/ui/chat/${createdChat.id}`]).catch(console.error);
					},
					error: (error) => {
						console.error('Error creating empty chat via API:', error);
						this._snackBar.open('Failed to create chat. Please try again.', 'Close', { duration: 5000, panelClass: ['error-snackbar'] });

						// Restore input and attachments
						this.messageInput.nativeElement.value = originalMessageText;
						this.selectedAttachments.set(originalAttachments);
						this._triggerResizeAndScroll(); // Resize after restoring

						// Reset generating states
						this.generating.set(false);
						this.generatingAIMessage.set(null);
						this.sendIcon.set('heroicons_outline:paper-airplane');
						if (isStreaming) {
							this.streamSub = null;
						}
					},
					complete: () => {
						// No-op: streaming will begin after navigation when chat loads
					},
				});
				this.streamSub = sub;
				return;
			} else {
				apiCall = this._chatService.sendMessageStreaming(
					chatForAPICall.id,
					userContentPayload,
					currentLlmId,
					options,
					originalAttachments,
					enableReformat,
					serviceTierPayload,
				);
			}

			const sub = apiCall.subscribe({
				next: (newOrUpdatedChat?: Chat) => {
					if (newOrUpdatedChat && (!chatForAPICall || chatForAPICall.id === NEW_CHAT_ID)) {
						this.router.navigate([`/ui/chat/${newOrUpdatedChat.id}`]).catch(console.error);
					}
					// Generating states and draft clearing are handled in 'complete'
				},
				error: (error) => {
					console.error('Error sending message via API:', error);
					this._snackBar.open('Failed to send message. Please try again.', 'Close', { duration: 5000, panelClass: ['error-snackbar'] });

					// --- New logic to update the failed message's status ---
					const currentChat = this.chat(); // Get the current chat state which includes the optimistic message
					if (currentChat) {
						// Find the last message sent by the user that is still marked as 'sending'.
						// We search from the end of the array for performance and correctness.
						const optimisticMessage = [...(currentChat.messages || [])].reverse().find((m) => m.isMine && m.status === 'sending');

						if (optimisticMessage) {
							// Call the new service method to update the status locally.
							// The currentChat.id will correctly be NEW_CHAT_ID for new chats.
							this._chatService.updateMessageStatus(currentChat.id, optimisticMessage.id, 'failed_to_send');
						}
					}
					// --- End of new logic ---

					// Restore input and attachments
					this.messageInput.nativeElement.value = originalMessageText;
					this.selectedAttachments.set(originalAttachments);
					this._triggerResizeAndScroll(); // Resize after restoring

					// Reset generating states
					this.generating.set(false);
					this.generatingAIMessage.set(null);
					this.sendIcon.set('heroicons_outline:paper-airplane');
					if (isStreaming) {
						this.streamSub = null;
					}
				},
				complete: () => {
					this.generating.set(false);
					this.generatingAIMessage.set(null);
					this.sendIcon.set('heroicons_outline:paper-airplane');
					// Input is already clear on success.
					this._scrollToBottom();

					// Clear draft using chatStateBeforeSend to get correct ID
					const draftChatIdToClear = chatStateBeforeSend && chatStateBeforeSend.id === NEW_CHAT_ID ? 'new' : chatStateBeforeSend?.id;
					if (draftChatIdToClear) {
						this._localStorageService.clearDraftMessage(draftChatIdToClear);
					}
					if (isStreaming) {
						this.streamSub = null;
					}
				},
			});
			if (isStreaming) {
				this.streamSub = sub;
			}
		} catch (prepareError) {
			// Handle errors from pre-API call async operations (e.g., attachmentsAndTextToUserContentExt)
			console.error('Error preparing message for sending:', prepareError);
			this._snackBar.open('Failed to prepare message. Please try again.', 'Close', { duration: 5000, panelClass: ['error-snackbar'] });

			// Restore input and attachments (since they were cleared optimistically)
			this.messageInput.nativeElement.value = originalMessageText;
			this.selectedAttachments.set(originalAttachments);
			this._triggerResizeAndScroll(); // Resize after restoring

			// Reset generating states
			this.generating.set(false);
			this.generatingAIMessage.set(null); // If it was set before the error
			this.sendIcon.set('heroicons_outline:paper-airplane');
		}
	}

	private stopStreaming(): void {
		try {
			this.streamSub?.unsubscribe();
		} finally {
			this.streamSub = null;
			this.generating.set(false);
			this.generatingAIMessage.set(null);
			this.sendIcon.set('heroicons_outline:paper-airplane');
		}
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

	/**
	 * Scrolls the main conversation view to the bottom.
	 */
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

	/**
	 * Manually triggers the CdkTextareaAutosize directive to resize and then
	 * scrolls the caret into view. Used after programmatic value changes.
	 */
	private _triggerResizeAndScroll(): void {
		if (this._autosize) {
		  this._ngZone.runOutsideAngular(() => {
			setTimeout(() => {
			  this._autosize?.resizeToFitContent(true);
			  // Delay scroll slightly to ensure resize completes
			  setTimeout(() => this._scrollToCaret(), 50);
			}, 10);
		  });
		} else {
		  this._scrollToCaret();
		}
	}

	/**
	 * Scroll so that the caret is visible (bottom-align if needed).
	 * This method is designed to be called after the textarea has potentially resized.
	 */
	private makeTitleFromText(text: string): string {
		const t = (text || '').trim();
		if (!t) return '';
		const firstLine = (t.split(/\r?\n/).find((l) => l.trim().length > 0) ?? t).trim();
		const maxLen = 80;
		return firstLine.length > maxLen ? firstLine.slice(0, maxLen).trimEnd() + '…' : firstLine;
	}

	/**
	 * Scroll so that the caret is visible (bottom-align if needed).
	 * This method is designed to be called after the textarea has potentially resized.
	 */
	private _scrollToCaret(): void {
		// Run outside Angular's zone to prevent unnecessary change detection cycles.
		this._ngZone.runOutsideAngular(() => {
			// A minimal delay is used to ensure this logic runs after the browser has
			// processed the resize from CdkTextareaAutosize.
			setTimeout(() => {
				const ta = this.messageInput?.nativeElement as HTMLTextAreaElement;
				if (!ta) {
					return;
				}

				// The 'selectionEnd' property gives us the position of the caret.
				// We create a temporary 'span' element to measure its exact coordinates.
				const span = document.createElement('span');
				// The span is positioned absolutely within the textarea's parent.
				span.style.position = 'absolute';
				// We copy relevant font styles to ensure accurate measurement.
				span.style.font = getComputedStyle(ta).font;
				span.style.whiteSpace = 'pre-wrap'; // Match textarea wrapping
				span.style.visibility = 'hidden';

				// We insert the text content up to the caret position into the span.
				// A non-breaking space ensures the span has height even on a new line.
				span.textContent = ta.value.substring(0, ta.selectionEnd) + '\u00A0';
				document.body.appendChild(span);

				// Now we get the height of the text leading up to the caret.
				const caretTopPosition = span.offsetHeight;
				document.body.removeChild(span); // Clean up the temporary element.

				// The ideal scroll position is where the caret is just visible at the bottom.
				const desiredScrollTop = caretTopPosition - ta.clientHeight;

				// If the current scroll position is less than the ideal (e.g., caret is hidden above),
				// we adjust the scroll position to bring it into view.
				if (ta.scrollTop < desiredScrollTop) {
					ta.scrollTop = desiredScrollTop;
				}
			}, 50); // A 50ms delay is typically sufficient for the DOM to update.
		});
	}

	handleLlmKeydown(event: KeyboardEvent): void {
		if (event.key === 'Enter') {
			event.preventDefault();
			event.stopPropagation();
			this.messageInput.nativeElement.focus();
		}
	}

	@HostListener('keydown', ['$event'])
	handleKeyboardEvent(event: KeyboardEvent): void {
		// Send message on Ctrl+Enter or Cmd+Enter
		if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
			event.preventDefault();
			this.sendMessage();
		}

		// Open dialog to add a markdown code block
		if (event.key === '`' && (event.ctrlKey || event.metaKey || event.altKey)) {
			event.preventDefault();
			this.openMarkdownFormatDialog();
		}

		if (event.key === 'm' && event.ctrlKey) {
			this.llmSelect?.open();
			this.llmSelect?.focus();
		}
		if (event.key === 'a' && event.ctrlKey) {
			this.fileInput?.nativeElement.click();
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

		// Format message on Ctrl+Shift+F
		if (event.key === 'F' && event.ctrlKey && event.shiftKey) {
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
							this._triggerResizeAndScroll();
						},
						error: (err) => {
							console.error('Error formatting message:', err);
							this._snackBar.open('Failed to format message as Markdown.', 'Close', { duration: 3000 });
						},
					});
			}
		}
	}

	/**
	 * Opens a dialog to select a markdown language for a code block.
	 */
	private openMarkdownFormatDialog(): void {
		const dialogRef = this.dialog.open(MarkdownFormatDialogComponent, {
			width: '300px',
			autoFocus: 'input',
		});

		dialogRef.afterClosed().subscribe((language: string | undefined) => {
			if (language) {
				this.insertCodeBlock(language);
			}
		});
	}

	/**
	 * Inserts a markdown code block into the message input at the current caret position.
	 * @param language The selected language identifier for the code block.
	 */
	private insertCodeBlock(language: string): void {
		const textarea = this.messageInput.nativeElement as HTMLTextAreaElement;
		const textToInsert = `\`\`\`${language}\n\n\`\`\``;
		const startPos = textarea.selectionStart;
		const endPos = textarea.selectionEnd;
		const currentValue = textarea.value;

		// Insert the code block template
		textarea.value = currentValue.substring(0, startPos) + textToInsert + currentValue.substring(endPos);

		// Set the caret position to the empty line inside the block
		const newCaretPosition = startPos + language.length + 4; // Position after ```lang\n
		textarea.selectionStart = newCaretPosition;
		textarea.selectionEnd = newCaretPosition;

		// Focus the textarea and trigger a resize to accommodate the new content
		textarea.focus();
		this._triggerResizeAndScroll();

		// Update the draft message
		this.messageInputChanged.next(textarea.value);
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
				lastUserMessageContent = currentChat.messages[i].content as UserContentExt;
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
	let lastIndex = 0; let match: RegExpExecArray | null = null;
	// biome-ignore lint/suspicious/noAssignInExpressions: valid use case for exec loop
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
