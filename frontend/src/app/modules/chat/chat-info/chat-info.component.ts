import { CommonModule, DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, DestroyRef, Input, ViewEncapsulation, computed, effect, inject, input, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatDrawer } from '@angular/material/sidenav';
import { MatSliderModule } from '@angular/material/slider';
import { MatTooltipModule } from '@angular/material/tooltip';
import { Router } from '@angular/router';
import { UserService } from 'app/core/user/user.service';
import { ChatServiceClient } from 'app/modules/chat/chat.service';
import { Chat } from 'app/modules/chat/chat.types';
import { EMPTY, catchError, finalize, tap } from 'rxjs';
import { UserProfile, UserProfileUpdate } from '#shared/user/user.model';
import { AgentLinks, GoogleCloudLinks } from '../../agents/agent-links';

@Component({
	selector: 'chat-info',
	templateUrl: 'chat-info.component.html',
	encapsulation: ViewEncapsulation.None,
	changeDetection: ChangeDetectionStrategy.OnPush,
	standalone: true,
	imports: [CommonModule, MatButtonModule, MatIconModule, MatSliderModule, MatProgressSpinnerModule, MatTooltipModule, FormsModule],
	providers: [DecimalPipe],
})
export class ChatInfoComponent {
	chat = input<Chat | null | undefined>();
	@Input() drawer: MatDrawer;

	links: AgentLinks = new GoogleCloudLinks();
	settings = signal<UserProfile['chat']>({} as UserProfile['chat']);

	// Signals for UI state
	settingsLoading = signal(false);
	settingsError = signal<string | null>(null);
	isEditingName = signal(false);
	editedName = signal('');
	isSavingName = signal(false);
	isDeletingChat = signal(false);

	readonly panelTitle = computed(() => {
		const currentChat = this.chat();
		// If chat has a valid ID and is not the placeholder 'new-chat' ID
		if (currentChat?.id && currentChat.id !== 'new-chat') {
			return 'Chat Details & Settings';
		}
		return 'Chat Settings';
	});

	private userService = inject(UserService);
	private chatService = inject(ChatServiceClient);
	private router = inject(Router);
	private destroyRef = inject(DestroyRef);
	private decimalPipe = inject(DecimalPipe);

	constructor() {
		effect(() => {
			const user = this.userService.userProfile();
			const chatSettings = user?.chat ? { ...user.chat } : ({} as UserProfile['chat']);
			// Only update the signal if the user profile chat settings are available and not empty
			// This prevents overwriting with an empty object if userProfile is null initially
			if (user && Object.keys(chatSettings).length > 0) {
				this.settings.set(chatSettings);
			}
		});
	}

	/**
	 * Formats the slider label value.
	 * @param value The numeric value from the slider.
	 * @returns The formatted string representation.
	 */
	formatSliderLabel = (value: number | null): string => {
		if (value === null) {
			return '';
		}
		const formatted = this.decimalPipe.transform(value, '1.1-2');
		return formatted === null ? value.toString() : formatted;
	};

	/**
	 * Saves the current chat settings to the user profile
	 * Handles loading state and error display
	 */
	private saveSettings(): void {
		const currentSettings = this.settings();
		if (!currentSettings) {
			return;
		}
		const currentUser = this.userService.userProfile();
		if (!currentUser) {
			this.settingsError.set('User profile not loaded. Cannot save settings.');
			console.error('User profile not loaded. Cannot save settings.');
			return;
		}

		this.settingsLoading.set(true);
		this.settingsError.set(null);

		// Construct the UserProfileUpdate payload
		const payload: UserProfileUpdate = {
			name: currentUser.name,
			hilBudget: currentUser.hilBudget,
			hilCount: currentUser.hilCount,
			llmConfig: { ...(currentUser.llmConfig || {}) }, // Ensure llmConfig is at least an empty object
			chat: { ...currentSettings }, // The updated chat settings
			functionConfig: { ...(currentUser.functionConfig || {}) }, // Ensure functionConfig is at least an empty object
		};

		this.userService
			.update(payload)
			.pipe(
				takeUntilDestroyed(this.destroyRef),
				catchError((error) => {
					this.settingsError.set(error.error?.error || 'Failed to save settings');
					console.error('Failed to save chat settings:', error);
					return EMPTY;
				}),
				finalize(() => {
					this.settingsLoading.set(false);
				}),
			)
			.subscribe();
	}

	/**
	 * Handler for slider value changes
	 * Triggers immediate save of updated settings
	 */
	onSettingChange(key: keyof NonNullable<UserProfile['chat']>, value: number): void {
		this.settings.update((s) => {
			if (!s) return s;
			return { ...s, [key]: value };
		});
		this.saveSettings();
	}

	startEditName(): void {
		const currentChat = this.chat();
		if (currentChat) {
			this.editedName.set(currentChat.title || '');
			this.isEditingName.set(true);
		}
	}

	cancelEditName(): void {
		this.isEditingName.set(false);
	}

	saveName(): void {
		const currentChat = this.chat();
		const newName = this.editedName().trim();
		if (!currentChat || !newName || !currentChat.id) {
			return;
		}

		this.isSavingName.set(true);
		this.chatService
			.updateChatDetails(currentChat.id, { title: newName })
			.pipe(
				takeUntilDestroyed(this.destroyRef),
				tap(() => {
					// The chatService.updateChatDetails should update the signal via its own tap operator
					// or the parent component should refresh.
					// For now, we assume the service handles the update to the shared signal.
				}),
				catchError((error) => {
					console.error('Failed to update chat name:', error);
					// Optionally set an error signal for name saving
					return EMPTY;
				}),
				finalize(() => {
					this.isSavingName.set(false);
					this.isEditingName.set(false);
				}),
			)
			.subscribe();
	}

	deleteChat(): void {
		const currentChat = this.chat();
		if (!currentChat || !currentChat.id) {
			return;
		}

		// Simple confirm, ideally use a dialog service
		if (!confirm('Are you sure you want to delete this chat?')) {
			return;
		}

		this.isDeletingChat.set(true);
		this.chatService
			.deleteChat(currentChat.id)
			.pipe(
				takeUntilDestroyed(this.destroyRef),
				tap(() => {
					this.drawer.close();
					this.router.navigate(['/apps/chat']); // Navigate to a general chat page or list
				}),
				catchError((error) => {
					console.error('Failed to delete chat:', error);
					// Optionally set an error signal for deletion
					return EMPTY;
				}),
				finalize(() => {
					this.isDeletingChat.set(false);
				}),
			)
			.subscribe();
	}

	databaseUrl(): string {
		const currentChat = this.chat();
		return currentChat ? this.links.chatDatabaseUrl(currentChat.id) : '';
	}
}
