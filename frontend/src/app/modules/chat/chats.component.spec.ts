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
import { ChatServiceClient } from '../chat.service';
import { Chat, NEW_CHAT_ID } from '../chat.types';

// Mock ChatService
class MockChatServiceClient {
    private _chatsSignal: WritableSignal<Chat[] | null> = signal(null);
    public chats = this._chatsSignal.asReadonly();
    private _loadChatsSubject = new BehaviorSubject<void>(undefined);

    loadChats() {
        // Simulate API call behavior
        if (this._shouldError) {
            this._loadChatsSubject = new BehaviorSubject<void>(undefined); // Reset subject for error
            return throwError(() => new Error('Failed to load chats'));
        }
        // Simulate successful load: update signal
        this._chatsSignal.set(this._mockChatData);
        this._loadChatsSubject.next(undefined); // Indicate completion
        return this._loadChatsSubject.asObservable(); // Return an observable that completes
    }
    
    // Helper to set mock data for the signal
    setMockChatData(data: Chat[] | null) {
        this._mockChatData = data;
    }
    private _mockChatData: Chat[] | null = [];

    // Helper to simulate error
    private _shouldError = false;
    simulateError(shouldError: boolean) {
        this._shouldError = shouldError;
    }

    // Mock other methods if needed by the component's template or other interactions
    deleteChat(chatId: string) { return of(null); }
    // Add other methods like createChat, getChatById if they are called directly or indirectly
}

describe('ChatsComponent', () => {
    let component: ChatsComponent;
    let fixture: ComponentFixture<ChatsComponent>;
    let mockChatService: MockChatServiceClient;

    const mockChats: Chat[] = [
        { id: '1', title: 'Chat 1', updatedAt: Date.now() },
        { id: '2', title: 'Chat 2', updatedAt: Date.now() },
    ];

    beforeEach(async () => {
        mockChatService = new MockChatServiceClient();

        await TestBed.configureTestingModule({
            imports: [
                ChatsComponent, // Standalone component
                HttpClientTestingModule,
                NoopAnimationsModule,
                MatIconModule,
                MatFormFieldModule,
                MatInputModule,
                MatButtonModule,
                RouterLink, // Import RouterLink if used in the template directly by ChatsComponent
            ],
            providers: [
                provideRouter([]), // Provide basic router configuration
                { provide: ChatServiceClient, useValue: mockChatService },
            ],
        }).compileComponents();

        fixture = TestBed.createComponent(ChatsComponent);
        component = fixture.componentInstance;
    });

    it('should create', () => {
        expect(component).toBeTruthy();
    });

    it('should call loadChats on init', () => {
        spyOn(mockChatService, 'loadChats').and.callThrough();
        mockChatService.setMockChatData([]); // Ensure signal has some initial state
        fixture.detectChanges(); // Triggers ngOnInit
        expect(mockChatService.loadChats).toHaveBeenCalled();
    });

    it('should display loading indicator when isLoading is true', () => {
        mockChatService.setMockChatData(null); // Start with no data
        // Manually set isLoading to true to test the template part,
        // as loadChats might complete quickly in a test.
        component.isLoading = true;
        fixture.detectChanges();
        const loadingDiv = fixture.nativeElement.querySelector('.animate-spin');
        expect(loadingDiv).toBeTruthy();
        const loadingText = fixture.nativeElement.textContent;
        expect(loadingText).toContain('Loading chats...');
    });

    it('should display chats after successful load', fakeAsync(() => {
        mockChatService.setMockChatData(mockChats);
        spyOn(mockChatService, 'loadChats').and.callThrough();
        
        fixture.detectChanges(); // ngOnInit -> loadChats
        tick(); // Allow async operations in loadChats (like finalize) to complete
        fixture.detectChanges(); // Update view with loaded chats

        expect(component.chats.length).toBe(2);
        expect(component.isLoading).toBe(false);
        expect(component.error).toBeNull();
        
        const chatElements = fixture.nativeElement.querySelectorAll('a[routerLink]');
        expect(chatElements.length).toBe(2);
        expect(chatElements[0].textContent).toContain('Chat 1');
        expect(chatElements[1].textContent).toContain('Chat 2');
    }));
    
    it('should display error and retry button on load failure', fakeAsync(() => {
        mockChatService.simulateError(true);
        spyOn(mockChatService, 'loadChats').and.callThrough();

        fixture.detectChanges(); // ngOnInit -> loadChats
        tick(); // Allow async operations in loadChats to complete
        fixture.detectChanges(); // Update view with error state

        expect(component.isLoading).toBe(false);
        expect(component.error).toBeTruthy();
        expect(component.chats.length).toBe(0);

        const errorText = fixture.nativeElement.textContent;
        expect(errorText).toContain('Failed to load chats.');
        const retryButton = fixture.nativeElement.querySelector('button');
        expect(retryButton).toBeTruthy();
        expect(retryButton.textContent.trim()).toBe('Retry');
    }));

    it('should call loadChats on retry button click', fakeAsync(() => {
        mockChatService.simulateError(true);
        fixture.detectChanges(); // Initial load fails
        tick();
        fixture.detectChanges();

        spyOn(component, 'loadChats').and.callThrough(); // Spy on component's method
        spyOn(mockChatService, 'loadChats').and.callThrough(); // Spy on service method
        
        mockChatService.simulateError(false); // Next attempt will succeed
        mockChatService.setMockChatData(mockChats);

        const retryButton = fixture.nativeElement.querySelector('button');
        retryButton.click();
        
        expect(component.loadChats).toHaveBeenCalled();
        tick(); // Allow async operations in the new loadChats call
        fixture.detectChanges();

        expect(mockChatService.loadChats).toHaveBeenCalledTimes(2); // Initial + retry
        expect(component.isLoading).toBe(false);
        expect(component.error).toBeNull();
        expect(component.chats.length).toBe(2);
    }));

    it('should unsubscribe on destroy', () => {
        const mockSubscription = new Subscription();
        spyOn(mockSubscription, 'unsubscribe');
        component['chatSubscription'] = mockSubscription; // Access private member for test

        component.ngOnDestroy();
        expect(mockSubscription.unsubscribe).toHaveBeenCalled();
    });
    
    // Test for createNewChat (basic, as it's a placeholder)
    it('should call router.navigate on createNewChat', () => {
        const router = TestBed.inject(Router);
        spyOn(router, 'navigate');
        component.createNewChat();
        expect(router.navigate).toHaveBeenCalledWith(['/apps/chat', NEW_CHAT_ID]);
    });

    // Test for deleteChat (basic, as it's a placeholder)
    it('should stop propagation and prevent default on deleteChat', () => {
        const mockEvent = jasmine.createSpyObj('MouseEvent', ['stopPropagation', 'preventDefault']);
        const testChat: Chat = { id: 'chat123', title: 'Test Chat to Delete', updatedAt: Date.now() };
        spyOn(console, 'log'); // To suppress console output if any

        component.deleteChat(mockEvent, testChat);

        expect(mockEvent.stopPropagation).toHaveBeenCalled();
        expect(mockEvent.preventDefault).toHaveBeenCalled();
        // Further tests would involve mocking chatService.deleteChat if it were fully implemented
    });
});
