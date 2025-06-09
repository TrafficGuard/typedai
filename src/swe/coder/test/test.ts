// @ts-nocheck

import { ClipboardModule } from '@angular/cdk/clipboard';
import { TextFieldModule } from '@angular/cdk/text-field';
import { CommonModule, NgClass } from '@angular/common';
import {
	type AfterViewInit,
	ChangeDetectionStrategy,
	type ChangeDetectorRef,
	Component,
	type ElementRef,
	HostListener,
	NgZone,
	type OnDestroy,
	type OnInit,
	ViewChild,
	ViewEncapsulation,
} from '@angular/core';

import { ReactiveFormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatMenuModule } from '@angular/material/menu';
import { type MatSelect, MatSelectModule } from '@angular/material/select';
import { MatSidenavModule } from '@angular/material/sidenav';
import type { MatSnackBar } from '@angular/material/snack-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { type Router, RouterLink, RouterModule } from '@angular/router';
import type { UserService } from 'app/core/user/user.service';
import type { User } from 'app/core/user/user.types';
import type { LLM } from 'app/modules/agents/services/llm.service';
import { ChatInfoComponent } from 'app/modules/chat/chat-info/chat-info.component';
import type { ChatService } from 'app/modules/chat/chat.service';
import { type Attachment, NEW_CHAT_ID } from 'app/modules/chat/chat.types';
import type { Chat, ChatMessage } from 'app/modules/chat/chat.types';
import { MarkdownModule, provideMarkdown } from 'ngx-markdown';
import { EMPTY, type Observable, catchError, switchMap } from 'rxjs';
import { Subject } from 'rxjs';
import { v4 as uuidv4 } from 'uuid';
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
		CommonModule,
	],
	providers: [provideMarkdown()],
})
export class ConversationComponent implements OnInit, OnDestroy, AfterViewInit {
	@ViewChild('messageInput') messageInput: ElementRef;
	@ViewChild('llmSelect') llmSelect: MatSelect;
	@ViewChild('fileInput') fileInput: ElementRef;
	selectedAttachments: Attachment[] = [];
	chat: Chat;
	chats: Chat[];
	drawerOpened = false;
	private _unsubscribeAll: Subject<any> = new Subject<any>();
	llms: LLM[] = null;
	llmId: string;
	currentUser: User;
	defaultChatLlmId: string;

	sendIcon = 'heroicons_outline:paper-airplane';

	sendOnEnter = true;
	enterStateIcon: 'keyboard_return' | 'heroicons_outline:paper-airplane' = 'heroicons_outline:paper-airplane';

	llmHasThinkingLevels = false;
	thinkingIcon = 'heroicons_outline:minus-small';
	thinkingLevel: 'off' | 'low' | 'medium' | 'high' = 'off';

	recording = false;
	/** If we're waiting for a response from the LLM after sending a message */
	generating = false;
	generatingTimer = null;

	/**
	 * For the Markdown component, the syntax highlighting support has the plugins defined
	 * in the angular.json file. Currently just a select few languages are included.
	 */
	constructor(
		private _changeDetectorRef: ChangeDetectorRef,
		private _chatService: ChatService,
		private _elementRef: ElementRef,
		private router: Router,
		private userService: UserService,
		private _snackBar: MatSnackBar,
	) {}

	/**
	 * Sets the appropriate LLM ID based on context and available LLMs:
	 * - For new chats: Uses user's default LLM if available
	 * - For existing chats: Uses the LLM from the last message
	 * - Fallback to first available LLM if no other selection is valid
	 */
	updateLlmSelector() {
		if (!this.llms) return;
		const llmIds = this.llms.map((llm) => llm.id);

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
		this.llmHasThinkingLevels = this.llmId.startsWith('openai:o3') || this.llmId.includes('claude-3-7') || this.llmId.includes('flash-2.5');
	}

	toggleThinking() {
		if (this.thinkingLevel === 'off') {
			this.thinkingLevel = 'low';
			this.thinkingIcon = 'heroicons_outline:bars-2';
		} else if (this.thinkingLevel === 'low') {
			this.thinkingLevel = 'medium';
			this.thinkingIcon = 'heroicons_outline:bars-3';
		} else if (this.thinkingLevel === 'medium') {
			this.thinkingLevel = 'high';
			this.thinkingIcon = 'heroicons_outline:bars-4';
		} else if (this.thinkingLevel === 'high') {
			this.thinkingLevel = 'off';
			this.thinkingIcon = 'heroicons_outline:minus-small';
		}
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
	sendMessage(): void {
		const message: string = this.messageInput.nativeElement.value.trim();
		// Use selectedAttachments directly
		const attachments: Attachment[] = [...this.selectedAttachments]; // Create a shallow copy

		// Get latest user preferences before sending the message
		this._getUserPreferences()
			.pipe(
				switchMap((user) => {
					if (message === '' && attachments.length === 0) {
						// Check attachments length
						return EMPTY;
					}

					this.generating = true;
					// this.sendIcon = 'heroicons_outline:stop-circle' // Existing comment

					// Push the local message with attachments (including potential previewUrls)
					this.chat.messages.push({
						id: uuidv4(),
						textContent: message,
						isMine: true,
						fileAttachments: attachments.filter((att) => att.type === 'file'),
						imageAttachments: attachments.filter((att) => att.type === 'image'),
						createdAt: new Date().toISOString(), // Add timestamp for local display consistency
					});

					// Keep the generating message logic
					const generatingMessage: ChatMessage = {
						id: uuidv4(),
						textContent: '',
						isMine: false,
						generating: true,
						createdAt: new Date().toISOString(),
					};
					this.chat.messages.push(generatingMessage);

					// Animate the typing/generating indicator (existing logic)
					this.generatingTimer = setInterval(() => {
						generatingMessage.textContent = generatingMessage.textContent.length === 3 ? '.' : `${generatingMessage.textContent}.`;
						this._changeDetectorRef.markForCheck();
					}, 800);

					// Clear the input and selected attachments
					this.messageInput.nativeElement.value = '';
					this.selectedAttachments = []; // Clear the selected attachments array

					const options = { ...user.chat, thinking: this.llmHasThinkingLevels ? this.thinkingLevel : null };

					// Prepare attachments for sending (only send necessary data, not previewUrl)
					const attachmentsToSend = attachments.map((att) => ({
						type: att.type,
						filename: att.filename,
						size: att.size,
						data: att.data, // The actual File object
						mimeType: att.mimeType,
					}));

					// If this is a new chat, create it with latest user preferences
					if (!this.chat.id || this.chat.id === NEW_CHAT_ID) {
						this._changeDetectorRef.markForCheck();
						// Pass attachmentsToSend to the service
						return this._chatService.createChat(message, this.llmId, options, attachmentsToSend);
					}

					this._scrollToBottom();
					// Pass attachmentsToSend to the service
					return this._chatService.sendMessage(this.chat.id, message, this.llmId, options, attachmentsToSend);
				}),
			)
			.subscribe({
				next: (chat: Chat) => {
					// Ensure the received chat replaces the local one correctly
					this.generating = false;

					if (!this.chat.id || this.chat.id === NEW_CHAT_ID) {
						clearInterval(this.generatingTimer);
						this.router.navigate([`/ui/chat/${chat.id}`]).catch(console.error);
						return;
					}
					// Replace local chat state with server state
					this.chat = clone(chat);
					this.assignUniqueIdsToMessages(this.chat.messages); // Re-assign IDs if needed
					clearInterval(this.generatingTimer);
					this.sendIcon = 'heroicons_outline:paper-airplane';
					this._scrollToBottom();
					this._changeDetectorRef.markForCheck();
				},
				error: (error) => {
					console.error('Error sending message:', error);
					this.generating = false;

					// Remove the two pending messages (generating and user message)
					this.chat.messages.pop();
					this.chat.messages.pop();

					// Restore the message input and selected attachments
					this.messageInput.nativeElement.value = message;
					this.selectedAttachments = attachments; // Restore the original attachments array

					// Reset UI state
					clearInterval(this.generatingTimer);

					this.sendIcon = 'heroicons_outline:paper-airplane';

					// Show error message
					this._snackBar.open('Failed to send message. Please try again.', 'Close', {
						duration: 5000,
						horizontalPosition: 'center',
						verticalPosition: 'bottom',
						panelClass: ['error-snackbar'],
					});

					this._changeDetectorRef.markForCheck();
				},
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
			catchError((error) => {
				console.error('Error fetching user preferences:', error);
				this._snackBar.open('Unable to load user preferences. Using default settings.', 'Close', {
					duration: 5000,
					horizontalPosition: 'center',
					verticalPosition: 'bottom',
					panelClass: ['warning-snackbar'],
				});
				// Return current user as fallback
				return this.currentUser ? [this.currentUser] : EMPTY;
			}),
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
			this.drawerOpened = !this.drawerOpened;
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

	sendAudioMessage(audioBlob: Blob): void {
		this._chatService.sendAudioMessage(this.chat.id, this.llmId, audioBlob).subscribe(
			() => {
				// Handle successful send, update the UI if necessary
				this._changeDetectorRef.markForCheck();
			},
			(error) => {
				// Handle error
				console.error('Error sending audio message', error);
			},
		);
	}

	onFileSelected(event: Event): void {
		const input = event.target as HTMLInputElement;
		if (input.files) {
			//this.addFiles(Array.from(input.files));
		}
	}

	removeAttachment(attachmentToRemove: Attachment): void {
		this.selectedAttachments = this.selectedAttachments.filter((att) => att !== attachmentToRemove);
		this._changeDetectorRef.markForCheck();
	}

	onDragOver(event: DragEvent): void {
		event.preventDefault();
		event.stopPropagation();
	}

	onDrop(event: DragEvent): void {
		event.preventDefault();
		event.stopPropagation();

		const files = Array.from(event.dataTransfer?.files || []);
		// this.addFiles(files);
	}
}

function clone<T>(obj: T): T {
	return structuredClone(obj);
}
