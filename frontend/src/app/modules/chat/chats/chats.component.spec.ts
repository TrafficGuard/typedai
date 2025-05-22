import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { RouterLink } from '@angular/router';
import { RouterTestingModule } from '@angular/router/testing';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { FormsModule } from '@angular/forms';
import { ChatsComponent } from '../chats.component';
import { Chat } from '../chat.types';
import { signal, DestroyRef } from '@angular/core';
import { of, throwError, EMPTY } from 'rxjs';
import { ChatServiceClient } from '../chat.service';
import { ActivatedRoute, Router } from '@angular/router';

describe('ChatsComponent', () => {
    let component: ChatsComponent;
    let fixture: ComponentFixture<ChatsComponent>;
    let mockChatService: jasmine.SpyObj<ChatServiceClient>;
    let mockRouter: jasmine.SpyObj<Router>;
    let mockActivatedRoute: any;
    let mockDestroyRefInstance: jasmine.SpyObj<DestroyRef>;

    const mockSessionsData: Chat[] = [
        { id: '1', title: 'Chat 1', updatedAt: Date.now(), messages: [] },
        { id: '2', title: 'Chat 2', updatedAt: Date.now(), messages: [] },
        { id: '3', title: 'Another Chat', updatedAt: Date.now(), messages: [] },
    ];

    beforeEach(async () => {
        mockChatService = jasmine.createSpyObj('ChatServiceClient', ['createChat', 'loadChats', 'deleteChat', 'chats']);
        mockRouter = jasmine.createSpyObj('Router', ['navigate']);
        mockActivatedRoute = {}; // Sufficient for relativeTo: this.route in startNewChat
        mockDestroyRefInstance = jasmine.createSpyObj('DestroyRef', ['onDestroy']);

        // Mock default return values for service methods called during component initialization or general use
        mockChatService.chats.and.returnValue(signal([])); // ngOnInit -> loadChats -> this.sessions.set(this.chatService.chats())
        mockChatService.loadChats.and.returnValue(EMPTY); // ngOnInit calls loadChats

        await TestBed.configureTestingModule({
            imports: [
                ChatsComponent, // Standalone component
                NoopAnimationsModule,
                FormsModule, // For filter input [(ngModel)] or [value]/(input)
                MatIconModule,
                MatFormFieldModule,
                MatInputModule,
                MatButtonModule,
                RouterLink, // If routerLink is used in the template
                RouterTestingModule, // For routerLink
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
        // Set initial inputs if necessary
        // component.sessions.set(null);
        // component.selectedSessionId.set(null);
        fixture.detectChanges(); // Initial binding, triggers ngOnInit
    });

    it('should create', () => {
        expect(component).toBeTruthy();
    });

    it('should display sessions passed via input', fakeAsync(() => {
        // Directly set the input signal's value
        component.sessions.set([...mockSessionsData]);
        fixture.detectChanges(); // Trigger change detection for signal update
        tick(); // Allow UI to update
        fixture.detectChanges();


        const sessionElements = fixture.nativeElement.querySelectorAll('a[routerLink]');
        expect(sessionElements.length).toBe(mockSessionsData.length);
        expect(sessionElements[0].textContent).toContain(mockSessionsData[0].title);
        expect(sessionElements[1].textContent).toContain(mockSessionsData[1].title);
    }));

    it('should emit sessionSelected output when a session is clicked', () => {
        spyOn(component.sessionSelected, 'emit');
        component.sessions.set([...mockSessionsData]);
        fixture.detectChanges();

        const firstSessionElement = fixture.nativeElement.querySelector('a[routerLink]');
        firstSessionElement.click();

        expect(component.sessionSelected.emit).toHaveBeenCalledWith(mockSessionsData[0]);
    });

    it('should emit newChatClicked output when "New Chat" button is clicked', () => {
        spyOn(component.newChatClicked, 'emit');
        const newChatButton = fixture.nativeElement.querySelector('button mat-icon[svgicon="heroicons_outline:plus"]');
        newChatButton.parentElement.click(); // Clicking the button itself

        expect(component.newChatClicked.emit).toHaveBeenCalled();
    });

    it('should filter sessions based on filterTerm signal', fakeAsync(() => {
        component.sessions.set([...mockSessionsData]);
        fixture.detectChanges();

        // Set filter term
        component.filterTerm.set('Chat 1');
        tick(); // Allow computed signal to update
        fixture.detectChanges(); // Re-render with filtered list

        let sessionElements = fixture.nativeElement.querySelectorAll('a[routerLink]');
        expect(sessionElements.length).toBe(1);
        expect(sessionElements[0].textContent).toContain('Chat 1');

        // Clear filter term
        component.filterTerm.set('');
        tick();
        fixture.detectChanges();

        sessionElements = fixture.nativeElement.querySelectorAll('a[routerLink]');
        expect(sessionElements.length).toBe(mockSessionsData.length);
    }));

    it('should update filterTerm when onFilterSessions is called (e.g., by input event)', () => {
        const inputElement = fixture.nativeElement.querySelector('input[matInput]');
        inputElement.value = 'Test Filter';
        inputElement.dispatchEvent(new Event('input')); // Simulate input event
        fixture.detectChanges();

        expect(component.filterTerm()).toBe('Test Filter');
    });


    it('should highlight the selected session based on selectedSessionId input', () => {
        component.sessions.set([...mockSessionsData]);
        component.selectedSessionId.set(mockSessionsData[1].id); // Select the second chat
        fixture.detectChanges();

        const sessionElements = fixture.nativeElement.querySelectorAll('a[routerLink]');
        const selectedElement = sessionElements[1]; // Second chat
        const unselectedElement = sessionElements[0]; // First chat

        // Check for a class that indicates selection, e.g., 'bg-primary-50'
        expect(selectedElement.classList).toContain('bg-primary-50');
        expect(unselectedElement.classList).not.toContain('bg-primary-50');
    });

    it('should display "No chats available" message when sessions input is null or empty', () => {
        component.sessions.set(null);
        fixture.detectChanges();
        let noChatsMessage = fixture.nativeElement.querySelector('.text-2xl.font-semibold.tracking-tight');
        expect(noChatsMessage.textContent).toContain('No chats available.');

        component.sessions.set([]);
        fixture.detectChanges();
        noChatsMessage = fixture.nativeElement.querySelector('.text-2xl.font-semibold.tracking-tight');
        expect(noChatsMessage.textContent).toContain('No chats available.');
    });

    it('should show delete icon on hover and emit chatDeleted on click', fakeAsync(() => {
        spyOn(component.chatDeleted, 'emit');
        component.sessions.set([mockSessionsData[0]]);
        fixture.detectChanges();
        tick();
        fixture.detectChanges();


        const chatItem = fixture.nativeElement.querySelector('a[routerLink]');
        expect(chatItem).toBeTruthy();

        // Simulate mouse enter
        component.hoveredChatId.set(mockSessionsData[0].id);
        fixture.detectChanges();
        tick(); // Allow UI to update
        fixture.detectChanges();


        let deleteButton = fixture.nativeElement.querySelector('button mat-icon[svgicon="heroicons_solid:trash"]');
        expect(deleteButton).toBeTruthy('Delete button should be visible on hover');

        // Simulate click on delete button
        deleteButton.parentElement.click(); // Click the button element
        expect(component.chatDeleted.emit).toHaveBeenCalledWith(mockSessionsData[0]);

        // Simulate mouse leave
        component.hoveredChatId.set(null);
        fixture.detectChanges();
        tick(); // Allow UI to update
        fixture.detectChanges();

        deleteButton = fixture.nativeElement.querySelector('button mat-icon[svgicon="heroicons_solid:trash"]');
        expect(deleteButton).toBeNull('Delete button should not be visible after mouse leave');
    }));

    describe('startNewChat', () => {
        it('should create a new chat and navigate on successful creation', () => {
            const newChatMock: Chat = { id: 'new-chat-123', title: 'Test Chat', updatedAt: Date.now() };
            mockChatService.createChat.and.returnValue(of(newChatMock));

            component.startNewChat();

            expect(mockChatService.createChat).toHaveBeenCalledWith('', 'default-llm');
            expect(mockRouter.navigate).toHaveBeenCalledWith(['./', newChatMock.id], { relativeTo: mockActivatedRoute });
            expect(component.isCreatingChat()).toBeFalse(); // Should be reset after synchronous observable
        });

        it('should set isCreatingChat to false and log error on chat creation failure', () => {
            const errorResponse = new Error('Failed to create chat');
            mockChatService.createChat.and.returnValue(throwError(() => errorResponse));
            spyOn(console, 'error');

            component.startNewChat();

            expect(mockChatService.createChat).toHaveBeenCalledWith('', 'default-llm');
            expect(mockRouter.navigate).not.toHaveBeenCalled();
            expect(component.isCreatingChat()).toBeFalse();
            expect(console.error).toHaveBeenCalledWith('Error creating new chat:', errorResponse);
        });

        it('should not call createChat if isCreatingChat is already true', () => {
            component.isCreatingChat.set(true);
            // fixture.detectChanges(); // Not needed for signal state check

            component.startNewChat();
            expect(mockChatService.createChat).not.toHaveBeenCalled();
        });

        it('should have isCreatingChat initially false and toggle correctly during successful call', () => {
            expect(component.isCreatingChat()).toBeFalse(); // Initial state check
            const newChatMock: Chat = { id: 'new-chat-456', title: 'Another Test Chat', updatedAt: Date.now() };
            mockChatService.createChat.and.returnValue(of(newChatMock));

            component.startNewChat(); // Call the method

            // For 'of()', the subscription block runs synchronously.
            // The component sets isCreatingChat to true, then false in next/error/complete.
            // So, after the call, it should be false.
            expect(component.isCreatingChat()).toBeFalse();
        });

        it('should have isCreatingChat initially false and toggle correctly during error call', () => {
            expect(component.isCreatingChat()).toBeFalse(); // Initial state check
            const errorResponse = new Error('Failed to create chat');
            mockChatService.createChat.and.returnValue(throwError(() => errorResponse));
            spyOn(console, 'error'); // To avoid actual console error during test

            component.startNewChat();

            expect(component.isCreatingChat()).toBeFalse(); // Check after the synchronous execution of subscribe block
        });
    });
});
