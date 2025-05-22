import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { RouterLink } from '@angular/router';
import { RouterTestingModule } from '@angular/router/testing';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { FormsModule } from '@angular/forms';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner'; // Import spinner module
import { ChatsComponent } from './chats.component'; // Corrected import path
import { Chat, NEW_CHAT_ID } from '../chat.types';
import { signal, DestroyRef } from '@angular/core';
import { of, throwError, EMPTY } from 'rxjs';
import { ChatServiceClient } from '../chat.service';
import { ActivatedRoute, Router } from '@angular/router';
import { ParamMap, convertToParamMap } from '@angular/router';
import { BehaviorSubject } from 'rxjs';

describe('ChatsComponent', () => {
    let component: ChatsComponent;
    let fixture: ComponentFixture<ChatsComponent>;
    let mockChatService: jasmine.SpyObj<ChatServiceClient>;
    let mockRouter: jasmine.SpyObj<Router>;
    let mockActivatedRoute: any;
    let mockDestroyRefInstance: jasmine.SpyObj<DestroyRef>;
    let paramMapSubject: BehaviorSubject<ParamMap>;


    const mockSessionsData: Chat[] = [
        { id: '1', title: 'Chat 1', updatedAt: Date.now(), messages: [] },
        { id: '2', title: 'Chat 2', updatedAt: Date.now(), messages: [] },
        { id: '3', title: 'Another Chat', updatedAt: Date.now(), messages: [] },
    ];

    beforeEach(async () => {
        mockChatService = jasmine.createSpyObj('ChatServiceClient', ['createChat', 'loadChats', 'deleteChat', 'chats']);
        mockRouter = jasmine.createSpyObj('Router', ['navigate']);
        mockDestroyRefInstance = jasmine.createSpyObj('DestroyRef', ['onDestroy']);

        paramMapSubject = new BehaviorSubject(convertToParamMap({}));
        mockActivatedRoute = {
            paramMap: paramMapSubject.asObservable(),
            snapshot: { paramMap: convertToParamMap({}) } // Provide a snapshot for initial value in toSignal
        };


        // Mock default return values for service methods called during component initialization or general use
        // loadChats is called in ngOnInit, make it return an observable that completes immediately with data
        mockChatService.loadChats.and.returnValue(of([...mockSessionsData]));
        // createChat is no longer called by startNewChat, but keep a mock for other potential uses or future tests
        mockChatService.createChat.and.returnValue(of({ id: 'new-chat-default', title: 'Default New Chat', updatedAt: Date.now() }));
        // deleteChat needs a default return
        mockChatService.deleteChat.and.returnValue(of(void 0));


        await TestBed.configureTestingModule({
            imports: [
                ChatsComponent, // Standalone component
                NoopAnimationsModule,
                FormsModule,
                MatIconModule,
                MatFormFieldModule,
                MatInputModule,
                MatButtonModule,
                MatProgressSpinnerModule, // Add spinner module
                RouterLink,
                RouterTestingModule,
            ],
            providers: [
                { provide: ChatServiceClient, useValue: mockChatService },
                { provide: Router, useValue: mockRouter },
                { provide: ActivatedRoute, useValue: mockActivatedRoute },
                { provide: DestroyRef, useValue: mockDestroyRefInstance },
            ],
        }).compileComponents();

        fixture = TestBed.createComponent(ChatsComponent);
        component = fixture.componentInstance;
        // No need to set inputs anymore, component manages its own state
        fixture.detectChanges(); // Initial binding, triggers ngOnInit and effect
        tick(); // Allow async operations (like loadChats subscription) and effects to complete
        fixture.detectChanges(); // Update view after data load
    }));

    afterEach(() => {
        // Clean up any potential async operations left hanging
        // This might be needed if tests don't fully drain the microtask queue
        // For simple 'of' observables, tick() after detectChanges() is usually enough.
    });


    it('should create', () => {
        expect(component).toBeTruthy();
    });

    it('should load chats on initialization', fakeAsync(() => {
        // loadChats is mocked to return mockSessionsData
        expect(mockChatService.loadChats).toHaveBeenCalled();
        expect(component.sessions()).toEqual(mockSessionsData);
        expect(component.isLoading()).toBeFalse();
        expect(component.error()).toBeNull();
        expect(component.hasDisplayableSessions()).toBeTrue();

        // Check if sessions are rendered
        const sessionElements = fixture.nativeElement.querySelectorAll('a[routerLink]');
        expect(sessionElements.length).toBe(mockSessionsData.length);
        expect(sessionElements[0].textContent).toContain(mockSessionsData[0].title);
    }));

    it('should display error message if loading fails', fakeAsync(() => {
        const errorResponse = new Error('Load failed');
        mockChatService.loadChats.and.returnValue(throwError(() => errorResponse));

        // Re-initialize component or trigger load again
        component.loadChats();
        tick(); // Allow observable to complete
        fixture.detectChanges(); // Update view

        expect(component.isLoading()).toBeFalse();
        expect(component.error()).toBe(errorResponse);
        expect(component.sessions()).toEqual([]); // Sessions should be cleared on error
        expect(component.hasDisplayableSessions()).toBeFalse();

        const errorMessage = fixture.nativeElement.querySelector('.text-2xl.font-semibold.tracking-tight');
        expect(errorMessage.textContent).toContain('Error Loading Chats');
    }));

    it('should retry loading chats when retry button is clicked', fakeAsync(() => {
        const errorResponse = new Error('Load failed');
        mockChatService.loadChats.and.returnValue(throwError(() => errorResponse));

        component.loadChats(); // Simulate initial failed load
        tick();
        fixture.detectChanges();

        // Now mock loadChats to succeed for the retry
        mockChatService.loadChats.and.returnValue(of([...mockSessionsData]));

        const retryButton = fixture.nativeElement.querySelector('button[color="warn"]');
        expect(retryButton).toBeTruthy();
        retryButton.click();
        tick(); // Allow retryLoadChats and subsequent loadChats to complete
        fixture.detectChanges();

        expect(mockChatService.loadChats).toHaveBeenCalledTimes(2); // Initial load + retry
        expect(component.sessions()).toEqual(mockSessionsData);
        expect(component.isLoading()).toBeFalse();
        expect(component.error()).toBeNull();
        expect(component.hasDisplayableSessions()).toBeTrue();
    }));


    it('should filter sessions based on filterTerm signal', fakeAsync(() => {
        component.sessions.set([...mockSessionsData]); // Ensure sessions are loaded
        fixture.detectChanges();
        tick();
        fixture.detectChanges();

        // Set filter term
        component.filterTerm.set('Chat');
        tick(); // Allow computed signal to update
        fixture.detectChanges(); // Re-render with filtered list

        let sessionElements = fixture.nativeElement.querySelectorAll('a[routerLink]');
        expect(sessionElements.length).toBe(2); // Chat 1, Chat 2
        expect(sessionElements[0].textContent).toContain('Chat 1');
        expect(sessionElements[1].textContent).toContain('Chat 2');

        // Set filter term to something specific
        component.filterTerm.set('Another');
        tick();
        fixture.detectChanges();

        sessionElements = fixture.nativeElement.querySelectorAll('a[routerLink]');
        expect(sessionElements.length).toBe(1); // Another Chat
        expect(sessionElements[0].textContent).toContain('Another Chat');

        // Clear filter term
        component.filterTerm.set('');
        tick();
        fixture.detectChanges();

        sessionElements = fixture.nativeElement.querySelectorAll('a[routerLink]');
        expect(sessionElements.length).toBe(mockSessionsData.length); // All sessions
    }));

    it('should update filterTerm when onFilterSessions is called (e.g., by input event)', fakeAsync(() => {
        component.sessions.set([...mockSessionsData]); // Ensure sessions are loaded
        fixture.detectChanges();
        tick();
        fixture.detectChanges();

        const inputElement: HTMLInputElement = fixture.nativeElement.querySelector('input[matInput]');
        inputElement.value = 'Test Filter';
        inputElement.dispatchEvent(new Event('input')); // Simulate input event
        // No need for tick() here as signal update is synchronous
        fixture.detectChanges();

        expect(component.filterTerm()).toBe('Test Filter');
    }));


    it('should highlight the selected session based on route parameter', fakeAsync(() => {
        component.sessions.set([...mockSessionsData]); // Ensure sessions are loaded
        fixture.detectChanges();
        tick();
        fixture.detectChanges();

        // Simulate route change to select the second chat
        paramMapSubject.next(convertToParamMap({ id: mockSessionsData[1].id }));
        tick(); // Allow effect to run
        fixture.detectChanges(); // Update view based on selectedSessionId signal

        const sessionElements = fixture.nativeElement.querySelectorAll('a[routerLink]');
        const selectedElement = sessionElements[1]; // Second chat
        const unselectedElement = sessionElements[0]; // First chat

        // Check for a class that indicates selection, e.g., 'bg-primary-50'
        expect(selectedElement.classList).toContain('bg-primary-50');
        expect(unselectedElement.classList).not.toContain('bg-primary-50');

        // Simulate route change away from a specific chat
        paramMapSubject.next(convertToParamMap({}));
        tick();
        fixture.detectChanges();

        expect(component.selectedSessionId()).toBeNull();
        const allElements = fixture.nativeElement.querySelectorAll('a[routerLink]');
        allElements.forEach((el: HTMLElement) => {
            expect(el.classList).not.toContain('bg-primary-50');
        });
    }));

    it('should display "No chats available" message when sessions signal is empty and no filter', fakeAsync(() => {
        component.sessions.set([]); // Ensure sessions are empty
        component.filterTerm.set(''); // Ensure no filter
        fixture.detectChanges();
        tick();
        fixture.detectChanges();

        const noChatsMessage = fixture.nativeElement.querySelector('.text-2xl.font-semibold.tracking-tight');
        expect(noChatsMessage).toBeTruthy();
        expect(noChatsMessage.textContent).toContain('No chats available.');

        const subMessage = fixture.nativeElement.querySelector('.text-secondary.mt-1');
        expect(subMessage.textContent).toContain('Click "New Chat" to start a conversation.');
    }));

    it('should display "No chats found" message when sessions signal is not empty but filter yields no results', fakeAsync(() => {
        component.sessions.set([...mockSessionsData]); // Ensure sessions are loaded
        component.filterTerm.set('NonExistentChat'); // Set filter that won't match
        fixture.detectChanges();
        tick();
        fixture.detectChanges();

        const noChatsMessage = fixture.nativeElement.querySelector('.text-2xl.font-semibold.tracking-tight');
        expect(noChatsMessage).toBeTruthy();
        expect(noChatsMessage.textContent).toContain('No chats found matching "NonExistentChat"');

        const subMessage = fixture.nativeElement.querySelector('.text-secondary.mt-1');
        expect(subMessage.textContent).toContain('Try a different search term.');
    }));


    it('should show delete icon on hover and call onClickDeleteSession on click', fakeAsync(() => {
        spyOn(component, 'onClickDeleteSession').and.callThrough(); // Spy on the component method
        component.sessions.set([mockSessionsData[0]]); // Use a single chat for simplicity
        fixture.detectChanges();
        tick();
        fixture.detectChanges();

        const chatItem = fixture.nativeElement.querySelector('a[routerLink]');
        expect(chatItem).toBeTruthy();

        // Simulate mouse enter by setting the signal directly
        component.hoveredChatId.set(mockSessionsData[0].id);
        fixture.detectChanges();
        tick();
        fixture.detectChanges();

        let deleteButton = fixture.nativeElement.querySelector('button mat-icon[svgicon="heroicons_solid:trash"]');
        expect(deleteButton).toBeTruthy('Delete button should be visible on hover');

        // Simulate click on delete button
        deleteButton.parentElement.click(); // Click the button element
        expect(component.onClickDeleteSession).toHaveBeenCalledWith(jasmine.any(MouseEvent), mockSessionsData[0]);

        // Simulate mouse leave
        component.hoveredChatId.set(null);
        fixture.detectChanges();
        tick();
        fixture.detectChanges();

        deleteButton = fixture.nativeElement.querySelector('button mat-icon[svgicon="heroicons_solid:trash"]');
        expect(deleteButton).toBeNull('Delete button should not be visible after mouse leave');
    }));

    it('should not show delete icon for NEW_CHAT_ID', fakeAsync(() => {
        const newChatMock: Chat = { id: NEW_CHAT_ID, title: 'New Chat', updatedAt: Date.now() };
        component.sessions.set([newChatMock]);
        fixture.detectChanges();
        tick();
        fixture.detectChanges();

        const chatItem = fixture.nativeElement.querySelector('a[routerLink]');
        expect(chatItem).toBeTruthy();

        // Simulate mouse enter
        component.hoveredChatId.set(newChatMock.id);
        fixture.detectChanges();
        tick();
        fixture.detectChanges();

        const deleteButton = fixture.nativeElement.querySelector('button mat-icon[svgicon="heroicons_solid:trash"]');
        expect(deleteButton).toBeNull('Delete button should not be visible for NEW_CHAT_ID');
    }));


    describe('startNewChat', () => {
        it('should navigate to the new chat route', fakeAsync(() => {
            component.startNewChat();
            // No API call should be made
            expect(mockChatService.createChat).not.toHaveBeenCalled();
            // Should navigate to the NEW_CHAT_ID route
            expect(mockRouter.navigate).toHaveBeenCalledWith(['./', NEW_CHAT_ID], { relativeTo: mockActivatedRoute });
            // isCreatingChat signal is removed, no state to check
        }));

        // Remove tests related to isCreatingChat state and API call success/failure
    });

    describe('onClickDeleteSession', () => {
        it('should call chatService.deleteChat and reload chats on success', fakeAsync(() => {
            const chatToDelete = mockSessionsData[0];
            component.sessions.set([...mockSessionsData]); // Ensure sessions are loaded
            fixture.detectChanges();
            tick();
            fixture.detectChanges();

            // Mock loadChats to return the list without the deleted chat after deletion
            mockChatService.loadChats.and.returnValue(of(mockSessionsData.filter(c => c.id !== chatToDelete.id)));

            component.onClickDeleteSession(new MouseEvent('click'), chatToDelete);
            tick(); // Allow deleteChat observable to complete
            fixture.detectChanges(); // Update view

            expect(mockChatService.deleteChat).toHaveBeenCalledWith(chatToDelete.id);
            expect(mockChatService.loadChats).toHaveBeenCalledTimes(2); // Initial load + load after delete
            expect(component.sessions()).not.toContain(chatToDelete);
            expect(mockRouter.navigate).not.toHaveBeenCalled(); // Should not navigate if selected chat is different
        }));

        it('should navigate away if the selected chat is deleted', fakeAsync(() => {
            const chatToDelete = mockSessionsData[1]; // Select the second chat
            component.sessions.set([...mockSessionsData]);
            // Simulate this chat being selected via route
            paramMapSubject.next(convertToParamMap({ id: chatToDelete.id }));
            fixture.detectChanges();
            tick();
            fixture.detectChanges();

            expect(component.selectedSessionId()).toBe(chatToDelete.id);

            // Mock loadChats to return the list without the deleted chat after deletion
            mockChatService.loadChats.and.returnValue(of(mockSessionsData.filter(c => c.id !== chatToDelete.id)));

            component.onClickDeleteSession(new MouseEvent('click'), chatToDelete);
            tick(); // Allow deleteChat observable to complete
            fixture.detectChanges(); // Update view

            expect(mockChatService.deleteChat).toHaveBeenCalledWith(chatToDelete.id);
            expect(mockChatService.loadChats).toHaveBeenCalledTimes(2); // Initial load + load after delete
            expect(component.sessions()).not.toContain(chatToDelete);
            // Check navigation
            expect(mockRouter.navigate).toHaveBeenCalledWith(['../'], { relativeTo: mockActivatedRoute });
        }));

        it('should log error if delete fails', fakeAsync(() => {
            const chatToDelete = mockSessionsData[0];
            const errorResponse = new Error('Delete failed');
            mockChatService.deleteChat.and.returnValue(throwError(() => errorResponse));
            spyOn(console, 'error');

            component.sessions.set([...mockSessionsData]); // Ensure sessions are loaded
            fixture.detectChanges();
            tick();
            fixture.detectChanges();

            component.onClickDeleteSession(new MouseEvent('click'), chatToDelete);
            tick(); // Allow deleteChat observable to complete
            fixture.detectChanges(); // Update view

            expect(mockChatService.deleteChat).toHaveBeenCalledWith(chatToDelete.id);
            expect(mockChatService.loadChats).toHaveBeenCalledTimes(1); // loadChats should not be called again
            expect(component.sessions()).toContain(chatToDelete); // Session should still be in the list
            expect(console.error).toHaveBeenCalledWith('Failed to delete chat:', errorResponse);
            expect(mockRouter.navigate).not.toHaveBeenCalled();
        }));

        it('should prevent default and stop propagation on delete click', () => {
            const chatToDelete = mockSessionsData[0];
            const mockEvent = jasmine.createSpyObj('MouseEvent', ['stopPropagation', 'preventDefault']);

            component.onClickDeleteSession(mockEvent, chatToDelete);

            expect(mockEvent.stopPropagation).toHaveBeenCalled();
            expect(mockEvent.preventDefault).toHaveBeenCalled();
        });
    });

    it('should update selectedSessionId optimistically when onSessionSelect is called', fakeAsync(() => {
        const selectedChat = mockSessionsData[0];
        component.sessions.set([...mockSessionsData]);
        fixture.detectChanges();
        tick();
        fixture.detectChanges();

        // Initially, no chat is selected based on route
        expect(component.selectedSessionId()).toBeNull();

        component.onSessionSelect(selectedChat);
        // selectedSessionId should be updated immediately by the signal set
        expect(component.selectedSessionId()).toBe(selectedChat.id);

        // The route effect might overwrite this if the route param doesn't match,
        // but the immediate effect of calling the method is the signal update.
    }));

    // Add tests for trackBySessionId if needed, but it's a simple passthrough
    it('trackBySessionId should return the session id', () => {
        const session: Chat = { id: 'test-id', title: 'Test', updatedAt: Date.now(), messages: [] };
        expect(component.trackBySessionId(0, session)).toBe('test-id');
    });
});

