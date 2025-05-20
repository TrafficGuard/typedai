import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { provideRouter, RouterLink } from '@angular/router';
import { HttpClientTestingModule } from '@angular/common/http/testing';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { BehaviorSubject, of, throwError, EMPTY, Subscription } from 'rxjs';
import { signal, WritableSignal } from '@angular/core';

import { ChatsComponent } from './chats.component';
import { ChatServiceClient } from './chat.service'; // Corrected path
import { Chat, NEW_CHAT_ID } from './chat.types'; // Corrected path

// Mock ChatService
class MockChatServiceClient {
    private _chatsSignal: WritableSignal<Chat[] | null> = signal(null);
    public chats = this._chatsSignal.asReadonly();

    private _mockData: Chat[] | null = [];
    private _shouldSimulateError = false;

    setMockChatData(data: Chat[] | null) {
        this._mockData = data;
    }

    simulateError(shouldError: boolean) {
        this._shouldSimulateError = shouldError;
    }

    loadChats(): Observable<void> {
        if (this._shouldSimulateError) {
            this._chatsSignal.set([]); // Clear chats on error
            return throwError(() => new Error('Failed to load chats'));
        } else {
            this._chatsSignal.set(this._mockData);
            return of(undefined); // Simulate successful completion
        }
    }

    deleteChat(chatId: string) { return of(null); }
    // Add other methods like createChat, getChatById if they are called directly or indirectly by the component
}

describe('ChatsComponent', () => {
    let component: ChatsComponent;
    let fixture: ComponentFixture<ChatsComponent>;
    let mockChatService: MockChatServiceClient;
    let router: Router;

    const mockChatsData: Chat[] = [
        { id: '1', title: 'Chat 1', updatedAt: Date.now() },
        { id: '2', title: 'Chat 2', updatedAt: Date.now() },
    ];

    beforeEach(async () => {
        // Instantiate the mock service before TestBed configuration
        // so it can be provided using useValue.
        mockChatService = new MockChatServiceClient();

        await TestBed.configureTestingModule({
            imports: [
                ChatsComponent, // Standalone component
                HttpClientTestingModule, // Good practice if any service (even mocked) might touch HttpClient
                NoopAnimationsModule,
                MatIconModule,
                MatFormFieldModule,
                MatInputModule,
                MatButtonModule,
                RouterLink,
            ],
            providers: [
                provideRouter([]), // Basic router setup
                { provide: ChatServiceClient, useValue: mockChatService },
            ],
        }).compileComponents();

        fixture = TestBed.createComponent(ChatsComponent);
        component = fixture.componentInstance;
        // mockChatService is already injected via useValue, can also get it via TestBed.inject if needed
        // router = TestBed.inject(Router); // Inject router if needed for navigation tests
    });

    it('should create', () => {
        expect(component).toBeTruthy();
        expect(component.isLoading).toBe(false); // Initial state before ngOnInit
        expect(component.chats.length).toBe(0);
        expect(component.error).toBeNull();
    });

    it('should call ChatService.loadChats on init and set initial loading state', fakeAsync(() => {
        spyOn(mockChatService, 'loadChats').and.callThrough();
        mockChatService.setMockChatData([]); // Simulate empty response initially

        fixture.detectChanges(); // Triggers ngOnInit -> component.loadChats()

        expect(mockChatService.loadChats).toHaveBeenCalled();
        expect(component.isLoading).toBe(true); // isLoading is set to true at the start of component.loadChats()
        
        const loadingDiv = fixture.nativeElement.querySelector('.animate-spin');
        expect(loadingDiv).toBeTruthy('Loading spinner should be visible');
        const loadingText = fixture.nativeElement.textContent;
        expect(loadingText).toContain('Loading chats...');

        tick(); // Allow async operations in loadChats (e.g., observable completion) to complete
        fixture.detectChanges(); // Update view after loading finishes

        expect(component.isLoading).toBe(false); // isLoading is set to false in finalize
    }));

    it('should successfully load chats, update component state, and render them', fakeAsync(() => {
        mockChatService.setMockChatData(mockChatsData);
        mockChatService.simulateError(false);
        spyOn(mockChatService, 'loadChats').and.callThrough();

        fixture.detectChanges(); // ngOnInit -> component.loadChats()
        expect(component.isLoading).toBe(true); // Check during load

        tick(); // Complete async operations
        fixture.detectChanges(); // Update view with loaded chats

        expect(mockChatService.loadChats).toHaveBeenCalledTimes(1);
        expect(component.isLoading).toBe(false);
        expect(component.chats.length).toBe(mockChatsData.length);
        expect(component.chats).toEqual(mockChatsData);
        expect(component.error).toBeNull();

        const chatElements = fixture.nativeElement.querySelectorAll('a[routerLink]');
        expect(chatElements.length).toBe(mockChatsData.length);
        expect(chatElements[0].textContent).toContain(mockChatsData[0].title);
        expect(chatElements[1].textContent).toContain(mockChatsData[1].title);
        expect(fixture.nativeElement.querySelector('.animate-spin')).toBeNull('Loading spinner should NOT be visible');
        expect(fixture.nativeElement.textContent).not.toContain('Failed to load chats.');
    }));
    
    it('should handle error during chat loading, update component state, and show error message', fakeAsync(() => {
        mockChatService.simulateError(true);
        spyOn(mockChatService, 'loadChats').and.callThrough();

        fixture.detectChanges(); // ngOnInit -> component.loadChats()
        expect(component.isLoading).toBe(true); // Check during load

        tick(); // Complete async operations
        fixture.detectChanges(); // Update view with error state

        expect(mockChatService.loadChats).toHaveBeenCalledTimes(1);
        expect(component.isLoading).toBe(false);
        expect(component.error).toEqual(jasmine.any(Error));
        expect(component.error.message).toContain('Failed to load chats');
        expect(component.chats.length).toBe(0); // Chats should be empty or reset

        const errorContainer = fixture.nativeElement.querySelector('.flex.flex-col.items-center.justify-center.p-8.text-center');
        expect(errorContainer).toBeTruthy('Error container should be visible');
        expect(errorContainer.textContent).toContain('Failed to load chats.');
        const retryButton = errorContainer.querySelector('button');
        expect(retryButton).toBeTruthy('Retry button should be visible');
        expect(retryButton.textContent.trim()).toBe('Retry');
        expect(fixture.nativeElement.querySelector('.animate-spin')).toBeNull('Loading spinner should NOT be visible');
        expect(fixture.nativeElement.querySelectorAll('a[routerLink]').length).toBe(0, 'Chat list should not be rendered');
    }));

    it('should retry loading chats successfully after an initial failure', fakeAsync(() => {
        // Step 1: Initial load fails
        mockChatService.simulateError(true);
        spyOn(mockChatService, 'loadChats').and.callThrough();
        
        fixture.detectChanges(); // ngOnInit -> component.loadChats()
        tick(); // Allow initial load to fail
        fixture.detectChanges(); // Update view to show error state

        expect(component.isLoading).toBe(false);
        expect(component.error).toBeTruthy();
        let retryButton = fixture.nativeElement.querySelector('button'); // Query for retry button
        expect(retryButton).toBeTruthy('Retry button should be visible after initial failure');

        // Step 2: Configure mock for successful retry and spy on component's loadChats
        mockChatService.simulateError(false); // Next attempt will succeed
        mockChatService.setMockChatData(mockChatsData);
        // component.loadChats is called by retryLoadChats, which is called by button click.
        // We've already spied on mockChatService.loadChats, it will be called again.

        // Step 3: Click retry button
        retryButton.click();
        fixture.detectChanges(); // Detect changes after click (isLoading should become true)
        
        expect(component.isLoading).toBe(true); // isLoading becomes true at start of new loadChats call
        const loadingDiv = fixture.nativeElement.querySelector('.animate-spin');
        expect(loadingDiv).toBeTruthy('Loading spinner should be visible during retry');


        tick(); // Allow async operations in the new loadChats call to complete
        fixture.detectChanges(); // Update view with successful state

        // Step 4: Assert successful state after retry
        expect(mockChatService.loadChats).toHaveBeenCalledTimes(2); // Initial + retry
        expect(component.isLoading).toBe(false);
        expect(component.error).toBeNull();
        expect(component.chats.length).toBe(mockChatsData.length);
        expect(component.chats).toEqual(mockChatsData);

        const chatElements = fixture.nativeElement.querySelectorAll('a[routerLink]');
        expect(chatElements.length).toBe(mockChatsData.length);
        expect(fixture.nativeElement.querySelector('.animate-spin')).toBeNull('Loading spinner should NOT be visible after retry');
        expect(fixture.nativeElement.textContent).not.toContain('Failed to load chats.');
        retryButton = fixture.nativeElement.querySelector('button.retry-button'); // Check if retry button is gone
        expect(fixture.nativeElement.querySelector('button[mat-flat-button][color="warn"]')).toBeNull('Retry button should NOT be visible after successful retry');

    }));

    it('should unsubscribe from chatSubscription on destroy', () => {
        // Ensure there's a subscription to test against
        mockChatService.setMockChatData([]);
        fixture.detectChanges(); // This will create the subscription
        tick(); // Allow subscription to complete its setup if async

        const subscription = component['chatSubscription']; // Access private member
        expect(subscription).toBeDefined();
        spyOn(subscription!, 'unsubscribe');

        component.ngOnDestroy();
        expect(subscription!.unsubscribe).toHaveBeenCalled();
    }));
    
    // Test for createNewChat (basic, as it's a placeholder, but ensure it's covered)
    it('should call router.navigate on createNewChat', () => {
        router = TestBed.inject(Router); // Ensure router is injected for this test
        spyOn(router, 'navigate');
        component.createNewChat();
        expect(router.navigate).toHaveBeenCalledWith(['/apps/chat', NEW_CHAT_ID]);
    });

    // Test for deleteChat (basic, as it's a placeholder, but ensure it's covered)
    it('should stop propagation and prevent default on deleteChat, and call service if not NEW_CHAT_ID', () => {
        const mockEvent = jasmine.createSpyObj('MouseEvent', ['stopPropagation', 'preventDefault']);
        const testChat: Chat = { id: 'chat123', title: 'Test Chat to Delete', updatedAt: Date.now() };
        
        spyOn(mockChatService, 'deleteChat').and.callThrough(); // Spy on the service method

        component.deleteChat(mockEvent, testChat);

        expect(mockEvent.stopPropagation).toHaveBeenCalled();
        expect(mockEvent.preventDefault).toHaveBeenCalled();
        expect(mockChatService.deleteChat).toHaveBeenCalledWith(testChat.id);
    });

    it('should not call deleteChat service for NEW_CHAT_ID', () => {
        const mockEvent = jasmine.createSpyObj('MouseEvent', ['stopPropagation', 'preventDefault']);
        const newChatPlaceholder: Chat = { id: NEW_CHAT_ID, title: 'New Chat', updatedAt: Date.now() };
        spyOn(mockChatService, 'deleteChat').and.callThrough();

        component.deleteChat(mockEvent, newChatPlaceholder);

        expect(mockEvent.stopPropagation).toHaveBeenCalled();
        expect(mockEvent.preventDefault).toHaveBeenCalled();
        expect(mockChatService.deleteChat).not.toHaveBeenCalled();
    });
});
