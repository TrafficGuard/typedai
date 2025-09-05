import { ClipboardModule } from '@angular/cdk/clipboard';
import { WritableSignal, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatExpansionModule } from '@angular/material/expansion';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconTestingModule } from '@angular/material/icon/testing';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatDrawer } from '@angular/material/sidenav';
import { MatSliderModule } from '@angular/material/slider';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatTooltipModule } from '@angular/material/tooltip';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { Router } from '@angular/router';
import { Subject, of, throwError } from 'rxjs';
import { UserService } from 'app/core/user/user.service';
import { ChatServiceClient } from 'app/modules/chat/chat.service';
import { Chat } from 'app/modules/chat/chat.types';
import { UserProfile, UserProfileUpdate } from '#shared/user/user.model';
import { ChatInfoComponent } from './chat-info.component';
import { ChatInfoPo } from './chat-info.component.po';

// Mock User type for UserService
const mockUser: UserProfile = {
	id: 'test-user-id',
	name: 'Test User',
	email: 'test@example.com',
	hilBudget: 0,
	hilCount: 0,
	llmConfig: {},
	functionConfig: {},
	chat: {
		temperature: 0.7,
		topP: 0.9,
		topK: 20,
		presencePenalty: 0.5,
		frequencyPenalty: 0.5,
		defaultLLM: 'default-llm',
	},
	enabled: false
};

describe('ChatInfoComponent', () => {
	const originalConsoleError = console.error;
	const originalConsoleWarn = console.warn;

	beforeAll(() => {
		spyOn(console, 'error').and.stub();
		spyOn(console, 'warn').and.stub();
	});

	afterAll(() => {
		// Restore originals so other suites behave normally
		console.error = originalConsoleError;
		console.warn = originalConsoleWarn;
	});

	let fixture: ComponentFixture<ChatInfoComponent>;
	let po: ChatInfoPo;
	let mockUserService: jasmine.SpyObj<UserService>;
	let mockChatService: jasmine.SpyObj<ChatServiceClient>;
	let mockRouter: jasmine.SpyObj<Router>;
	let mockMatDrawer: jasmine.SpyObj<MatDrawer>;
	let mockUserSignal: WritableSignal<UserProfile | null>;
	let capturedPayload: UserProfileUpdate | undefined;

	const initialChatSettings = {
		temperature: 0.7,
		topP: 0.9,
		topK: 20,
		presencePenalty: 0.5,
		frequencyPenalty: 0.5,
	};

	beforeEach(async () => {
		capturedPayload = undefined;
		mockUserSignal = signal<UserProfile | null>(null);
		mockUserService = jasmine.createSpyObj('UserService', ['update']);
		Object.defineProperty(mockUserService, 'userProfile', {
			get: () => mockUserSignal,
			configurable: true,
		});

		mockChatService = jasmine.createSpyObj('ChatServiceClient', ['updateChatDetails', 'deleteChat']);
		mockRouter = jasmine.createSpyObj('Router', ['navigate']);
		mockMatDrawer = jasmine.createSpyObj('MatDrawer', ['close']);

		await TestBed.configureTestingModule({
			imports: [
				ChatInfoComponent,
				NoopAnimationsModule,
				MatSliderModule,
				MatIconTestingModule,
				FormsModule,
				MatButtonModule,
				MatProgressSpinnerModule,
				ClipboardModule,
				MatExpansionModule,
				MatFormFieldModule,
				MatInputModule,
				MatSlideToggleModule,
				MatTooltipModule,
			],
			providers: [
				{ provide: UserService, useValue: mockUserService },
				{ provide: ChatServiceClient, useValue: mockChatService },
				{ provide: Router, useValue: mockRouter },
				{ provide: MatDrawer, useValue: mockMatDrawer },
			],
		}).compileComponents();

		fixture = TestBed.createComponent(ChatInfoComponent);
		// Set @Input() drawer
		fixture.componentRef.setInput('drawer', mockMatDrawer);
		po = await ChatInfoPo.create(fixture);
	});

	it('should create', () => {
		expect(fixture.componentInstance).toBeTruthy(); // Check component instance via fixture
		expect(po).toBeTruthy();
	});

	it('should initialize settings from UserService userProfile signal', async () => {
		// Arrange
		mockUserSignal.set({ ...mockUser, chat: { ...initialChatSettings, defaultLLM: 'test' } });
		await po.detectAndWait(); // Ensure computed signal updates and UI reflects it

		// Assert
		expect(await po.getSliderValue('temperatureSlider')).toEqual(initialChatSettings.temperature);
		expect(await po.getSliderValue('topPSlider')).toEqual(initialChatSettings.topP);
		expect(await po.getSliderValue('topKSlider')).toEqual(initialChatSettings.topK);
		expect(await po.getSliderValue('presencePenaltySlider')).toEqual(initialChatSettings.presencePenalty);
		expect(await po.getSliderValue('frequencyPenaltySlider')).toEqual(initialChatSettings.frequencyPenalty);
	});

	describe('Chat Details Display', () => {
		it('should display chat title and ID when chat input is provided', async () => {
			// Arrange
			const testChat: Chat = { id: 'chat123', title: 'Test Chat Title', updatedAt: Date.now(), userId: 'user1', messages: [] };
			fixture.componentRef.setInput('chat', testChat);
			await po.detectAndWait();

			// Assert
			expect(await po.getChatTitle()).toBe('Test Chat Title');
			expect(await po.getChatId()).toBe('chat123');
			expect(await po.getPanelTitle()).toBe('Chat Details & Settings');
		});

		it('should display "Untitled Chat" if chat title is empty', async () => {
			// Arrange
			const testChat: Chat = { id: 'chat123', title: '', updatedAt: Date.now(), userId: 'user1', messages: [] };
			fixture.componentRef.setInput('chat', testChat);
			await po.detectAndWait();

			// Assert
			expect(await po.getChatTitle()).toBe('Untitled Chat');
		});

		it('should display "Chat Settings" as panel title if chat is new or not present', async () => {
			// Arrange: No chat input or new-chat
			fixture.componentRef.setInput('chat', { id: 'new-chat', title: '', updatedAt: Date.now(), userId: 'user1', messages: [] });
			await po.detectAndWait();
			// Assert
			expect(await po.getPanelTitle()).toBe('Chat Settings');

			// Arrange: Null chat input
			fixture.componentRef.setInput('chat', null);
			await po.detectAndWait();
			// Assert
			expect(await po.getPanelTitle()).toBe('Chat Settings');
		});
	});

	describe('Settings Management', () => {
		beforeEach(async () => {
			// Ensure settings are initialized from a mock user
			mockUserSignal.set({ ...mockUser, chat: { ...initialChatSettings, defaultLLM: 'test' } });
			await po.detectAndWait();
		});

		it('should call UserService.update with new settings when a slider changes', async () => {
			// Arrange
			mockUserService.update.and.callFake((payload) => {
				capturedPayload = payload;
				return of(undefined);
			});
			const newTemperature = 0.9;

			// Act
			await po.setSliderValue('temperatureSlider', newTemperature);
			// detectAndWait is called within setSliderValue
			const actualSliderValue = await po.getSliderValue('temperatureSlider');

			// Assert
			expect(mockUserService.update).toHaveBeenCalled();
			expect(capturedPayload).withContext('Payload should have been captured').toBeDefined();
			if (capturedPayload) {
				expect(capturedPayload.chat.temperature).withContext('Temperature should be updated').toBe(actualSliderValue);
				expect(capturedPayload.chat.topP).withContext('TopP should be unchanged').toBe(initialChatSettings.topP);
			}
			expect(await po.isSettingsLoadingVisible()).toBeFalse(); // Should reset after call
			expect(await po.getSettingsErrorText()).toBeNull();
		});

		it('should display error and hide loader on UserService.update failure', async () => {
			// Arrange
			mockUserService.update.and.returnValue(throwError(() => ({ error: { error: 'Update failed' } })));
			const newTemperature = 0.9;

			// Act
			await po.setSliderValue('temperatureSlider', newTemperature);

			// Assert
			expect(mockUserService.update).toHaveBeenCalled();
			expect(await po.isSettingsLoadingVisible()).toBeFalse();
			expect(await po.isSettingsErrorVisible()).withContext('Error display should be visible on API failure').toBeTrue();
		});
	});

	describe('Edit Chat Name', () => {
		const testChat: Chat = { id: 'chat-edit-id', title: 'Original Title', updatedAt: Date.now(), userId: 'user1', messages: [] };

		beforeEach(async () => {
			fixture.componentRef.setInput('chat', testChat);
			await po.detectAndWait();
		});

		it('should enter edit mode, show input with current title, and hide edit button', async () => {
			// Act
			await po.clickEditNameButton();

			// Assert
			expect(await po.isNameInputVisible()).toBeTrue();
			expect(await po.getNameInputValue()).toBe('Original Title');
			expect(await po.isSaveNameButtonVisible()).toBeTrue();
			expect(await po.isCancelEditNameButtonVisible()).toBeTrue();
			expect(await po.isEditNameButtonVisible()).toBeFalse();
		});

		it('should exit edit mode on cancel, hide input, and show edit button', async () => {
			// Arrange
			await po.clickEditNameButton(); // Enter edit mode

			// Act
			await po.clickCancelEditNameButton();

			// Assert
			expect(await po.isNameInputVisible()).toBeFalse();
			expect(await po.isEditNameButtonVisible()).toBeTrue();
		});

		it('should call ChatService.updateChatDetails on save, then exit edit mode', async () => {
			// Arrange
			mockChatService.updateChatDetails.and.returnValue(of(null)); // Mock successful update
			const newTitle = 'New Chat Title';
			await po.clickEditNameButton(); // Enter edit mode

			// Act
			await po.typeNameInInput(newTitle);
			await po.clickSaveNameButton();

			// Assert
			expect(mockChatService.updateChatDetails).toHaveBeenCalledWith('chat-edit-id', { title: newTitle });
			expect(await po.isNameSavingVisible()).toBeFalse(); // Spinner should be gone
			expect(await po.isNameInputVisible()).toBeFalse(); // Back to display mode
			expect(await po.isEditNameButtonVisible()).toBeTrue();
			// The title itself should update if the service call leads to the input signal changing.
			// This test focuses on the interaction; a separate test could verify the title update if needed.
		});

		it('should handle error from ChatService.updateChatDetails and exit edit mode', async () => {
			// Arrange
			mockChatService.updateChatDetails.and.returnValue(throwError(() => new Error('Update failed')));
			const newTitle = 'New Chat Title';
			await po.clickEditNameButton();

			// Act
			await po.typeNameInInput(newTitle);
			await po.clickSaveNameButton();

			// Assert
			expect(mockChatService.updateChatDetails).toHaveBeenCalledWith('chat-edit-id', { title: newTitle });
			expect(await po.isNameSavingVisible()).toBeFalse();
			expect(await po.isNameInputVisible()).toBeFalse(); // Should still exit edit mode
			expect(await po.isEditNameButtonVisible()).toBeTrue();
			// Optionally check for an error message if the UI displays one for this specific error
		});
	});

	describe('Delete Chat', () => {
		const testChat: Chat = { id: 'chat-delete-id', title: 'To Be Deleted', updatedAt: Date.now(), userId: 'user1', messages: [] };
		let confirmSpy: jasmine.Spy;

		beforeEach(async () => {
			fixture.componentRef.setInput('chat', testChat);
			confirmSpy = spyOn(window, 'confirm');
			await po.detectAndWait();
		});

		it('should call ChatService.deleteChat, close drawer, and navigate on confirmed delete', async () => {
			// Arrange
			confirmSpy.and.returnValue(true);
			mockChatService.deleteChat.and.returnValue(of(undefined)); // Mock successful deletion

			// Act
			await po.clickDeleteChatButton();

			// Assert
			expect(confirmSpy).toHaveBeenCalled();
			expect(mockChatService.deleteChat).toHaveBeenCalledWith('chat-delete-id');
			expect(await po.isChatDeletingVisible()).toBeFalse(); // Spinner gone
			expect(mockMatDrawer.close).toHaveBeenCalled();
			expect(mockRouter.navigate).toHaveBeenCalledWith(['/apps/chat']);
		});

		it('should not call ChatService.deleteChat if confirmation is cancelled', async () => {
			// Arrange
			confirmSpy.and.returnValue(false);

			// Act
			await po.clickDeleteChatButton();

			// Assert
			expect(confirmSpy).toHaveBeenCalled();
			expect(mockChatService.deleteChat).not.toHaveBeenCalled();
			expect(await po.isChatDeletingVisible()).toBeFalse();
		});

		it('should handle error from ChatService.deleteChat', async () => {
			// Arrange
			confirmSpy.and.returnValue(true);
			mockChatService.deleteChat.and.returnValue(throwError(() => new Error('Deletion failed')));

			// Act
			await po.clickDeleteChatButton();

			// Assert
			expect(mockChatService.deleteChat).toHaveBeenCalledWith('chat-delete-id');
			expect(await po.isChatDeletingVisible()).toBeFalse(); // Spinner should be gone
			// Optionally check for an error message if the UI displays one
		});
	});

	it('databaseUrl should return correct URL via PO', async () => {
		// Arrange
		const testChat: Chat = { id: 'chat-db-url-id', title: 'DB URL Test', updatedAt: Date.now(), userId: 'user1', messages: [] };
		fixture.componentRef.setInput('chat', testChat);
		await po.detectAndWait();

		// Assert
		const dbUrl = await po.getDatabaseUrl();
		expect(dbUrl).toBeTruthy();
		expect(dbUrl).toContain('chat-db-url-id');
	});

	describe('Sharing Functionality', () => {
		const shareableChat: Chat = { id: 'share-123', title: 'Shareable Chat', shareable: true, messages: [], updatedAt: Date.now(), userId: 'user1' };
		const nonShareableChat: Chat = { id: 'share-456', title: 'Private Chat', shareable: false, messages: [], updatedAt: Date.now(), userId: 'user1' };
		const newChat: Chat = { id: 'new-chat', title: 'New Chat', messages: [], updatedAt: Date.now(), userId: 'user1' };

		it('should NOT show the sharing panel for a new chat', async () => {
			fixture.componentRef.setInput('chat', newChat);
			await po.detectAndWait();
			expect(await po.isSharingPanelVisible()).toBeFalse();
		});

		it('should show the sharing panel for an existing chat', async () => {
			fixture.componentRef.setInput('chat', nonShareableChat);
			await po.detectAndWait();
			expect(await po.isSharingPanelVisible()).toBeTrue();
		});

		it('should show the toggle as ON for a shareable chat', async () => {
			fixture.componentRef.setInput('chat', shareableChat);
			await po.detectAndWait();
			expect(await po.isSharingPanelVisible()).toBeTrue();
			expect(await po.isSharingToggleChecked()).toBeTrue();
		});

		it('should show the toggle as OFF for a non-shareable chat', async () => {
			fixture.componentRef.setInput('chat', nonShareableChat);
			await po.detectAndWait();
			expect(await po.isSharingToggleChecked()).toBeFalse();
		});

		it('should call updateChatDetails with "true" when toggled ON', async () => {
			mockChatService.updateChatDetails.and.returnValue(of(null));
			fixture.componentRef.setInput('chat', nonShareableChat);
			await po.detectAndWait();

			await po.clickSharingToggle();

			expect(mockChatService.updateChatDetails).toHaveBeenCalledWith('share-456', { shareable: true });
		});

		it('should call updateChatDetails with "false" when toggled OFF', async () => {
			mockChatService.updateChatDetails.and.returnValue(of(null));
			fixture.componentRef.setInput('chat', shareableChat);
			await po.detectAndWait();

			await po.clickSharingToggle();

			expect(mockChatService.updateChatDetails).toHaveBeenCalledWith('share-123', { shareable: false });
		});

		it('should show the public link input when chat is shareable', async () => {
			fixture.componentRef.setInput('chat', shareableChat);
			await po.detectAndWait();

			expect(await po.isPublicLinkVisible()).toBeTrue();
			const linkValue = await po.getPublicLinkValue();
			expect(linkValue).toContain(window.location.origin);
			expect(linkValue).toContain('share-123');
		});

		it('should hide the public link input when chat is not shareable', async () => {
			fixture.componentRef.setInput('chat', nonShareableChat);
			await po.detectAndWait();
			expect(await po.isPublicLinkVisible()).toBeFalse();
		});

		it('should disable the toggle while the update is in progress', async () => {
			const updateSubject = new Subject<null>();
			mockChatService.updateChatDetails.and.returnValue(updateSubject.asObservable());
			fixture.componentRef.setInput('chat', nonShareableChat);
			await po.detectAndWait();

			// Act: Trigger the update but don't wait for it to complete.
			await po.clickSharingToggle();

			// Assert: Check that the toggle is disabled immediately.
			expect(await po.isSharingToggleDisabled()).withContext('Sharing toggle should be disabled while updating').toBe(true);

			// Act: Complete the asynchronous operation.
			updateSubject.next(null);
			updateSubject.complete();
			await po.detectAndWait(); // Allow component to react to the completion.

			// Assert: Check that the toggle is re-enabled.
			expect(await po.isSharingToggleDisabled()).withContext('Sharing toggle should be re-enabled after update completes').toBe(false);
		});

		it('should re-enable the toggle on API error', async () => {
			mockChatService.updateChatDetails.and.returnValue(throwError(() => new Error('API Error')));
			fixture.componentRef.setInput('chat', nonShareableChat);
			await po.detectAndWait();

			await po.clickSharingToggle();

			expect(await po.isSharingToggleDisabled()).toBeFalse();
		});
	});
});
