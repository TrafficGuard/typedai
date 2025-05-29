import { HttpClientTestingModule } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { type ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { Router } from '@angular/router';
import { of, throwError } from 'rxjs';

import { MatDrawer } from '@angular/material/sidenav';
import { UserService } from 'app/core/user/user.service';
import { ChatServiceClient } from 'app/modules/chat/chat.service';
import type { Chat } from 'app/modules/chat/chat.types';
import type { UserProfile } from '#shared/user/user.model';
import { ChatInfoComponent } from './chat-info.component';

// Mock User type for UserService
const mockUser = {
	id: 'test-user-id',
	name: 'Test User',
	email: 'test@example.com',
	chat: {
		// Default chat settings
		temperature: 0.7,
		topP: 0.9,
		topK: 20,
		presencePenalty: 0.5,
		frequencyPenalty: 0.5,
	} as UserProfile['chat'],
	// Add other required User properties if any
};

describe('ChatInfoComponent', () => {
	let component: ChatInfoComponent;
	let fixture: ComponentFixture<ChatInfoComponent>;
	let mockUserService: jasmine.SpyObj<UserService>;
	let mockChatService: jasmine.SpyObj<ChatServiceClient>;
	let mockRouter: jasmine.SpyObj<Router>;
	let mockMatDrawer: jasmine.SpyObj<MatDrawer>;

	const initialChatSettings = {
		temperature: 0.7,
		topP: 0.9,
		topK: 20,
		presencePenalty: 0.5,
		frequencyPenalty: 0.5,
	};

	beforeEach(async () => {
		mockUserService = jasmine.createSpyObj('UserService', ['update'], {
			// Mock user$ as an observable that emits the mockUser
			user$: of({ ...mockUser, chat: { ...initialChatSettings } } as any),
		});
		mockChatService = jasmine.createSpyObj('ChatServiceClient', ['updateChatDetails', 'deleteChat']);
		mockRouter = jasmine.createSpyObj('Router', ['navigate']);
		mockMatDrawer = jasmine.createSpyObj('MatDrawer', ['close']);

		await TestBed.configureTestingModule({
			imports: [
				ChatInfoComponent, // Standalone component
				NoopAnimationsModule,
				HttpClientTestingModule, // For services if they make http calls not mocked
			],
			providers: [
				{ provide: UserService, useValue: mockUserService },
				{ provide: ChatServiceClient, useValue: mockChatService },
				{ provide: Router, useValue: mockRouter },
				{ provide: MatDrawer, useValue: mockMatDrawer }, // Provide mock for MatDrawer
			],
		}).compileComponents();

		fixture = TestBed.createComponent(ChatInfoComponent);
		component = fixture.componentInstance;
		component.drawer = mockMatDrawer; // Assign the mock drawer to the component instance
		// fixture.detectChanges(); // Initial detection after component creation and input setup
	});

	it('should create', () => {
		expect(component).toBeTruthy();
	});

	it('should initialize settings from UserService user$', fakeAsync(() => {
		fixture.detectChanges(); // Trigger ngOnInit / constructor logic
		tick(); // Allow observables to emit
		expect(component.settings).toEqual(initialChatSettings);
	}));

	describe('Chat Details Display', () => {
		it('should display chat title and ID when chat input is provided', () => {
			const testChat: Chat = { id: 'chat123', title: 'Test Chat Title', updatedAt: Date.now(), userId: 'user1', messages: [] };
			component.chat = signal(testChat) as any; // Use 'as any' if type issues with WritableSignal vs InputSignal
			fixture.detectChanges();

			const compiled = fixture.nativeElement as HTMLElement;
			expect(compiled.textContent).toContain('Test Chat Title');
			expect(compiled.textContent).toContain('chat123');
		});

		it('should display "Untitled Chat" if chat title is empty', () => {
			const testChat: Chat = { id: 'chat123', title: '', updatedAt: Date.now(), userId: 'user1', messages: [] };
			component.chat = signal(testChat) as any;
			fixture.detectChanges();
			const compiled = fixture.nativeElement as HTMLElement;
			expect(compiled.textContent).toContain('Untitled Chat');
		});
	});

	describe('Settings Management', () => {
		beforeEach(() => {
			// Ensure settings are initialized
			fixture.detectChanges(); // This will run constructor and ngOnInit logic
			tick(); // For user$ emission
		});

		it('should call saveSettings when onSettingChange is triggered', () => {
			spyOn(component as any, 'saveSettings').and.callThrough();
			mockUserService.update.and.returnValue(of({})); // Mock successful update

			component.settings.temperature = 0.9; // Simulate slider change
			component.onSettingChange();
			fixture.detectChanges();

			expect((component as any).saveSettings).toHaveBeenCalled();
			expect(mockUserService.update).toHaveBeenCalledWith({ chat: component.settings });
			expect(component.settingsLoading()).toBeFalse(); // Assuming it resets
		});

		it('should set settingsLoading and settingsError on saveSettings failure', () => {
			mockUserService.update.and.returnValue(throwError(() => ({ error: { error: 'Update failed' } })));
			component.settings.temperature = 0.9;
			component.onSettingChange();
			fixture.detectChanges();

			expect(component.settingsLoading()).toBeFalse(); // Finalize should set it to false
			expect(component.settingsError()).toBe('Update failed');
		});
	});

	describe('Edit Chat Name', () => {
		const testChat: Chat = { id: 'chat-edit-id', title: 'Original Title', updatedAt: Date.now(), userId: 'user1', messages: [] };

		beforeEach(() => {
			component.chat = signal(testChat) as any;
			fixture.detectChanges();
		});

		it('should set isEditingName to true and populate editedName on startEditName', () => {
			component.startEditName();
			expect(component.isEditingName()).toBeTrue();
			expect(component.editedName()).toBe('Original Title');
		});

		it('should set isEditingName to false on cancelEditName', () => {
			component.startEditName(); // Go into edit mode
			component.cancelEditName();
			expect(component.isEditingName()).toBeFalse();
		});

		it('should call chatService.updateChatDetails on saveName and reset editing state', () => {
			mockChatService.updateChatDetails.and.returnValue(of(null)); // Mock successful update
			component.startEditName();
			component.editedName.set('New Chat Title');
			component.saveName();
			fixture.detectChanges();

			expect(mockChatService.updateChatDetails).toHaveBeenCalledWith('chat-edit-id', { title: 'New Chat Title' });
			expect(component.isSavingName()).toBeFalse(); // Assuming it resets
			expect(component.isEditingName()).toBeFalse();
		});

		it('should handle error when saveName fails', () => {
			mockChatService.updateChatDetails.and.returnValue(throwError(() => new Error('Update failed')));
			component.startEditName();
			component.editedName.set('New Chat Title');
			component.saveName();
			fixture.detectChanges();

			expect(mockChatService.updateChatDetails).toHaveBeenCalled();
			expect(component.isSavingName()).toBeFalse();
			expect(component.isEditingName()).toBeFalse(); // Should still reset editing mode on finalize
			// Add error handling checks if UI shows errors for name saving
		});
	});

	describe('Delete Chat', () => {
		const testChat: Chat = { id: 'chat-delete-id', title: 'To Be Deleted', updatedAt: Date.now(), userId: 'user1', messages: [] };

		beforeEach(() => {
			component.chat = signal(testChat) as any;
			spyOn(window, 'confirm').and.returnValue(true); // Auto-confirm deletion
			fixture.detectChanges();
		});

		it('should call chatService.deleteChat, close drawer, and navigate on deleteChat', () => {
			mockChatService.deleteChat.and.returnValue(of(undefined)); // Mock successful deletion
			component.deleteChat();
			fixture.detectChanges();

			expect(mockChatService.deleteChat).toHaveBeenCalledWith('chat-delete-id');
			expect(component.isDeletingChat()).toBeFalse(); // Assuming it resets
			expect(mockMatDrawer.close).toHaveBeenCalled();
			expect(mockRouter.navigate).toHaveBeenCalledWith(['/apps/chat']);
		});

		it('should not call deleteChat if confirmation is cancelled', () => {
			(window.confirm as jasmine.Spy).and.returnValue(false);
			component.deleteChat();
			expect(mockChatService.deleteChat).not.toHaveBeenCalled();
		});

		it('should handle error when deleteChat fails', () => {
			mockChatService.deleteChat.and.returnValue(throwError(() => new Error('Deletion failed')));
			component.deleteChat();
			fixture.detectChanges();

			expect(mockChatService.deleteChat).toHaveBeenCalled();
			expect(component.isDeletingChat()).toBeFalse(); // Finalize should set it to false
			// Add error handling checks if UI shows errors for deletion
		});
	});

	it('databaseUrl should return correct URL', () => {
		const testChat: Chat = { id: 'chat-db-url-id', title: 'DB URL Test', updatedAt: Date.now(), userId: 'user1', messages: [] };
		component.chat = signal(testChat) as any;
		fixture.detectChanges();
		// This test depends on the implementation of GoogleCloudLinks or whatever AgentLinks is used.
		// For simplicity, we'll just check it doesn't throw and returns a string.
		expect(component.databaseUrl()).toContain('chat-db-url-id');
	});
});
