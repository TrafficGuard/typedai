import { DestroyRef, WritableSignal, signal } from '@angular/core';
import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule, MatIconRegistry } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { RouterLink } from '@angular/router';
import { ActivatedRoute, Router } from '@angular/router';
import { ParamMap, convertToParamMap } from '@angular/router';
import { RouterTestingModule } from '@angular/router/testing';
import { ApiListState } from 'app/core/api-state.types';
import { EMPTY, catchError, delay, of, tap, throwError } from 'rxjs';
import { BehaviorSubject } from 'rxjs';
import { ChatServiceClient } from '../chat.service';
import { Chat as UIChat } from '../chat.types';
import { NEW_CHAT_ID } from '../chat.types';
import { ChatsComponent } from './chats.component';

class MockMatIconRegistry {
	addSvgIcon() {}
	addSvgIconSet() {}
	getNamedSvgIcon() { return of(document.createElementNS('http://www.w3.org/2000/svg', 'svg')); }
	// ... add other methods as needed
}

xdescribe('ChatsComponent', () => {
	let component: ChatsComponent;
	let fixture: ComponentFixture<ChatsComponent>;
	let mockChatService: jasmine.SpyObj<ChatServiceClient>;
	let mockRouter: jasmine.SpyObj<Router>;
	let mockActivatedRoute: any;
	let mockDestroyRefInstance: jasmine.SpyObj<DestroyRef>;
	let paramMapSubject: BehaviorSubject<ParamMap>;

	// Signals that would be part of the mocked ChatServiceClient
	let mockServiceChatsSignal: WritableSignal<UIChat[] | null>;
	let mockServiceChatsStateSignal: WritableSignal<ApiListState<UIChat>>;

	const mockSessionsData: UIChat[] = [
		{ id: '1', title: 'Chat 1', updatedAt: Date.now(), messages: [] },
		{ id: '2', title: 'Chat 2', updatedAt: Date.now(), messages: [] },
		{ id: '3', title: 'Another Chat', updatedAt: Date.now(), messages: [] },
	];

	beforeEach(async () => {
		mockServiceChatsSignal = signal<UIChat[] | null>([]);
		mockServiceChatsStateSignal = signal<ApiListState<UIChat>>({ status: 'idle' });

		mockChatService = jasmine.createSpyObj('ChatServiceClient', ['loadChats', 'forceReloadChats', 'deleteChat', 'createChat'], {
			chats: mockServiceChatsSignal, // component reads this.chatService.chats()
			chatsState: mockServiceChatsStateSignal, // service methods update this
		});

		mockRouter = jasmine.createSpyObj('Router', ['navigate']);
		mockDestroyRefInstance = jasmine.createSpyObj('DestroyRef', ['onDestroy']);

		paramMapSubject = new BehaviorSubject(convertToParamMap({}));
		mockActivatedRoute = {
			paramMap: paramMapSubject.asObservable(),
			snapshot: { paramMap: convertToParamMap({}) },
		};

		// Default mock implementations for service methods
		mockChatService.loadChats.and.callFake(() => {
			mockServiceChatsStateSignal.set({ status: 'loading' });
			return of(undefined).pipe(
				delay(1), // Simulate async
				tap(() => {
					mockServiceChatsSignal.set([...mockSessionsData]);
					mockServiceChatsStateSignal.set({ status: 'success', data: [...mockSessionsData] });
				}),
				catchError((err) => {
					mockServiceChatsStateSignal.set({ status: 'error', error: err, code: err.status });
					mockServiceChatsSignal.set([]); // Clear chats on error
					return throwError(() => err);
				}),
			);
		});

		mockChatService.forceReloadChats.and.callFake(() => {
			mockServiceChatsStateSignal.set({ status: 'loading' });
			// Simulate async fetch and success for force reload
			const reloadedData: UIChat[] = [{ id: 'reloaded1', title: 'Reloaded Chat 1', updatedAt: Date.now(), messages: [] }];
			return of(undefined).pipe(
				delay(1),
				tap(() => {
					mockServiceChatsSignal.set(reloadedData);
					mockServiceChatsStateSignal.set({ status: 'success', data: reloadedData });
				}),
				catchError((err) => {
					mockServiceChatsStateSignal.set({ status: 'error', error: err, code: err.status });
					mockServiceChatsSignal.set([]);
					return throwError(() => err);
				}),
			);
		});

		mockChatService.createEmptyChat.and.returnValue(of({ id: 'new-chat-default', title: 'Default New Chat', updatedAt: Date.now(), messages: [] }));
		mockChatService.deleteChat.and.returnValue(of(void 0));

		await TestBed.configureTestingModule({
			imports: [
				ChatsComponent,
				NoopAnimationsModule,
				// FormsModule, MatIconModule, MatFormFieldModule, MatInputModule, MatButtonModule, MatProgressSpinnerModule, RouterLink are imported by ChatsComponent
				RouterTestingModule,
			],
			providers: [
				{ provide: ChatServiceClient, useValue: mockChatService },
				{ provide: Router, useValue: mockRouter },
				{ provide: ActivatedRoute, useValue: mockActivatedRoute },
				{ provide: DestroyRef, useValue: mockDestroyRefInstance },
				{ provide: MatIconRegistry, useClass: MockMatIconRegistry }
			],
		}).compileComponents();

		fixture = TestBed.createComponent(ChatsComponent);
		component = fixture.componentInstance;
		fixture.detectChanges(); // ngOnInit will call loadChats
		tick(1); // Allow loadChats mock to complete (due to delay(1))
		fixture.detectChanges(); // Update view with loaded data
	});

	it('should create', () => {
		expect(component).toBeTruthy();
	});

	it('should load chats on initialization', fakeAsync(() => {
		// ngOnInit calls loadChats, which is mocked to update signals
		expect(mockChatService.loadChats).toHaveBeenCalled();
		// The component's `sessions` signal is computed from `mockChatService.chats()`
		expect(component.sessions()).toEqual(mockSessionsData);
		expect(component.isLoading()).toBeFalse(); // isLoading is derived from chatsState
		expect(component.error()).toBeNull();
		expect(component.hasDisplayableSessions()).toBeTrue();

		const sessionElements = fixture.nativeElement.querySelectorAll('a[routerLink]');
		expect(sessionElements.length).toBe(mockSessionsData.length);
		expect(sessionElements[0].textContent).toContain(mockSessionsData[0].title);
	}));

	it('should display error message if loading fails', fakeAsync(() => {
		const errorResponse = new Error('Load failed');
		// Configure loadChats to return an error
		mockChatService.loadChats.and.callFake(() => {
			mockServiceChatsStateSignal.set({ status: 'loading' });
			return of(undefined).pipe(
				delay(1),
				tap(() => {
					throw errorResponse;
				}), // Throw error inside tap to simulate service error
				catchError((err) => {
					mockServiceChatsStateSignal.set({ status: 'error', error: err, code: (err as any).status });
					mockServiceChatsSignal.set([]);
					return throwError(() => err); // Ensure error propagates to component's catchError
				}),
			);
		});

		component.loadChats(); // Call the component's loadChats method
		tick(1); // Allow async operations in mock to complete
		fixture.detectChanges();

		expect(component.isLoading()).toBeFalse();
		expect(component.error()).toBe(errorResponse);
		expect(component.sessions()).toEqual([]);
		expect(component.hasDisplayableSessions()).toBeFalse();

		const errorMessage = fixture.nativeElement.querySelector('.text-2xl.font-semibold.tracking-tight');
		expect(errorMessage.textContent).toContain('Error Loading Chats');
	}));

	it('should retry loading chats when retry button is clicked', fakeAsync(() => {
		const errorResponse = new Error('Load failed');
		// Initial failed load
		mockChatService.loadChats.and.callFake(() => {
			mockServiceChatsStateSignal.set({ status: 'loading' });
			return of(undefined).pipe(
				delay(1),
				tap(() => {
					mockServiceChatsStateSignal.set({ status: 'error', error: errorResponse, code: 500 });
					mockServiceChatsSignal.set([]);
				}),
			);
		});
		component.loadChats();
		tick(1);
		fixture.detectChanges();
		expect(component.error()).toBe(errorResponse);

		// Setup successful load for retry
		mockChatService.loadChats.and.callFake(() => {
			mockServiceChatsStateSignal.set({ status: 'loading' });
			return of(undefined).pipe(
				delay(1),
				tap(() => {
					mockServiceChatsSignal.set([...mockSessionsData]);
					mockServiceChatsStateSignal.set({ status: 'success', data: [...mockSessionsData] });
				}),
			);
		});

		const retryButton = fixture.nativeElement.querySelector('button[color="warn"]');
		expect(retryButton).toBeTruthy();
		retryButton.click(); // This calls component.retryLoadChats() -> component.loadChats()

		expect(mockChatService.loadChats).toHaveBeenCalledTimes(2); // Initial + retry
		tick(1); // Allow retry load to complete
		fixture.detectChanges();

		expect(component.sessions()).toEqual(mockSessionsData);
		expect(component.isLoading()).toBeFalse();
		expect(component.error()).toBeNull();
	}));

	it('should filter sessions based on filterTerm signal', fakeAsync(() => {
		// Initial data is already loaded in beforeEach
		expect(component.sessions()).toEqual(mockSessionsData);

		component.filterTerm.set('Chat 1');
		tick();
		fixture.detectChanges();
		expect(component.displaySessions().length).toBe(1);
		expect(component.displaySessions()[0].title).toBe('Chat 1');

		component.filterTerm.set('NonExistent');
		tick();
		fixture.detectChanges();
		expect(component.displaySessions().length).toBe(0);

		component.filterTerm.set('');
		tick();
		fixture.detectChanges();
		expect(component.displaySessions().length).toBe(mockSessionsData.length);
	}));

	it('should update filterTerm when onFilterSessions is called', fakeAsync(() => {
		const inputElement: HTMLInputElement = fixture.nativeElement.querySelector('input[matInput]');
		inputElement.value = 'Test Filter';
		inputElement.dispatchEvent(new Event('input'));
		fixture.detectChanges();
		expect(component.filterTerm()).toBe('Test Filter');
	}));

	it('should highlight the selected session based on route parameter', fakeAsync(() => {
		// Data loaded in beforeEach
		paramMapSubject.next(convertToParamMap({ id: mockSessionsData[1].id }));
		tick();
		fixture.detectChanges();

		expect(component.selectedSessionId()).toBe(mockSessionsData[1].id);
		const sessionElements = fixture.nativeElement.querySelectorAll('a[routerLink]');
		expect(sessionElements[1].classList).toContain('bg-primary-50');
		expect(sessionElements[0].classList).not.toContain('bg-primary-50');

		paramMapSubject.next(convertToParamMap({})); // No ID
		tick();
		fixture.detectChanges();
		expect(component.selectedSessionId()).toBeNull();
		sessionElements.forEach((el: HTMLElement) => expect(el.classList).not.toContain('bg-primary-50'));
	}));

	it('should display "No chats available" message when sessions signal is empty and no filter', fakeAsync(() => {
		mockServiceChatsSignal.set([]); // Set to empty
		mockServiceChatsStateSignal.set({ status: 'success', data: [] });
		component.filterTerm.set('');
		tick();
		fixture.detectChanges();

		const noChatsMessage = fixture.nativeElement.querySelector('.text-2xl.font-semibold.tracking-tight');
		expect(noChatsMessage.textContent).toContain('No chats available.');
	}));

	it('should display "No chats found" message when sessions signal is not empty but filter yields no results', fakeAsync(() => {
		// mockSessionsData is already set
		component.filterTerm.set('NonExistentChat');
		tick();
		fixture.detectChanges();

		const noChatsMessage = fixture.nativeElement.querySelector('.text-2xl.font-semibold.tracking-tight');
		expect(noChatsMessage.textContent).toContain('No chats found matching "NonExistentChat"');
	}));

	it('should show delete icon on hover and call onClickDeleteSession on click', fakeAsync(() => {
		spyOn(component, 'onClickDeleteSession').and.callThrough();
		mockServiceChatsSignal.set([mockSessionsData[0]]);
		mockServiceChatsStateSignal.set({ status: 'success', data: [mockSessionsData[0]] });
		tick();
		fixture.detectChanges();

		const chatItem = fixture.nativeElement.querySelector('a[routerLink]');
		component.hoveredChatId.set(mockSessionsData[0].id);
		tick();
		fixture.detectChanges();

		let deleteButton = fixture.nativeElement.querySelector('button mat-icon[svgicon="heroicons_solid:trash"]');
		expect(deleteButton).toBeTruthy();

		deleteButton.parentElement.click();
		expect(component.onClickDeleteSession).toHaveBeenCalledWith(jasmine.any(MouseEvent), mockSessionsData[0]);

		component.hoveredChatId.set(null);
		tick();
		fixture.detectChanges();
		deleteButton = fixture.nativeElement.querySelector('button mat-icon[svgicon="heroicons_solid:trash"]');
		expect(deleteButton).toBeNull();
	}));

	it('should not show delete icon for NEW_CHAT_ID', fakeAsync(() => {
		const newChatMock: UIChat = { id: NEW_CHAT_ID, title: 'New Chat', updatedAt: Date.now(), messages: [] };
		mockServiceChatsSignal.set([newChatMock]);
		mockServiceChatsStateSignal.set({ status: 'success', data: [newChatMock] });
		tick();
		fixture.detectChanges();

		component.hoveredChatId.set(newChatMock.id);
		tick();
		fixture.detectChanges();
		const deleteButton = fixture.nativeElement.querySelector('button mat-icon[svgicon="heroicons_solid:trash"]');
		expect(deleteButton).toBeNull();
	}));

	describe('startNewChat', () => {
		it('should navigate to the new chat route', fakeAsync(() => {
			component.startNewChat();
			// No API call should be made
			expect(mockChatService.createEmptyChat).not.toHaveBeenCalled();
			// Should navigate to the NEW_CHAT_ID route
			expect(mockRouter.navigate).toHaveBeenCalledWith(['./', NEW_CHAT_ID], { relativeTo: mockActivatedRoute });
			// isCreatingChat signal is removed, no state to check
		}));

		// Remove tests related to isCreatingChat state and API call success/failure
	});

	describe('onClickDeleteSession', () => {
		it('should call chatService.deleteChat and update sessions on success', fakeAsync(() => {
			const chatToDelete = mockSessionsData[0];
			// mockSessionsData is already in mockServiceChatsSignal
			mockChatService.deleteChat.and.callFake((id: string) => {
				// Simulate service updating its signals upon successful deletion
				const currentChats = mockServiceChatsSignal() || [];
				mockServiceChatsSignal.set(currentChats.filter((c) => c.id !== id));
				mockServiceChatsStateSignal.set({ status: 'success', data: mockServiceChatsSignal()! });
				return of(undefined);
			});

			component.onClickDeleteSession(new MouseEvent('click'), chatToDelete);
			tick(); // Allow deleteChat and subsequent signal updates
			fixture.detectChanges();

			expect(mockChatService.deleteChat).toHaveBeenCalledWith(chatToDelete.id);
			expect(component.sessions().find((s) => s.id === chatToDelete.id)).toBeUndefined();
			expect(mockRouter.navigate).not.toHaveBeenCalled();
		}));

		it('should navigate away if the selected chat is deleted', fakeAsync(() => {
			const chatToDelete = mockSessionsData[1];
			paramMapSubject.next(convertToParamMap({ id: chatToDelete.id })); // Select this chat
			tick();
			fixture.detectChanges();
			expect(component.selectedSessionId()).toBe(chatToDelete.id);

			mockChatService.deleteChat.and.callFake((id: string) => {
				const currentChats = mockServiceChatsSignal() || [];
				mockServiceChatsSignal.set(currentChats.filter((c) => c.id !== id));
				mockServiceChatsStateSignal.set({ status: 'success', data: mockServiceChatsSignal()! });
				return of(undefined);
			});

			component.onClickDeleteSession(new MouseEvent('click'), chatToDelete);
			tick();
			fixture.detectChanges();

			expect(mockChatService.deleteChat).toHaveBeenCalledWith(chatToDelete.id);
			expect(mockRouter.navigate).toHaveBeenCalledWith(['../'], { relativeTo: mockActivatedRoute });
		}));

		it('should log error if delete fails', fakeAsync(() => {
			const chatToDelete = mockSessionsData[0];
			const errorResponse = new Error('Delete failed');
			mockChatService.deleteChat.and.returnValue(throwError(() => errorResponse));
			spyOn(console, 'error');

			component.onClickDeleteSession(new MouseEvent('click'), chatToDelete);
			tick();
			fixture.detectChanges();

			expect(mockChatService.deleteChat).toHaveBeenCalledWith(chatToDelete.id);
			// Sessions should not change if delete fails and service doesn't update signals on error
			expect(component.sessions().find((s) => s.id === chatToDelete.id)).toBeTruthy();
			expect(console.error).toHaveBeenCalledWith('Failed to delete chat:', errorResponse);
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
		// Data loaded in beforeEach
		expect(component.selectedSessionId()).toBeNull(); // Assuming no route param initially

		component.onSessionSelect(selectedChat);
		expect(component.selectedSessionId()).toBe(selectedChat.id);
	}));

	it('trackBySessionId should return the session id', () => {
		const session: UIChat = { id: 'test-id', title: 'Test', updatedAt: Date.now(), messages: [] };
		expect(component.trackBySessionId(0, session)).toBe('test-id');
	});

	describe('forceReloadChats method', () => {
		it('should call chatService.forceReloadChats and set isLoading states correctly on success', fakeAsync(() => {
			// Mock forceReloadChats to simulate success and update signals
			mockChatService.forceReloadChats.and.callFake(() => {
				mockServiceChatsStateSignal.set({ status: 'loading' });
				return of(undefined).pipe(
					delay(1),
					tap(() => {
						const reloadedData = [{ id: 'reloaded', title: 'Reloaded', updatedAt: Date.now(), messages: [] }];
						mockServiceChatsSignal.set(reloadedData);
						mockServiceChatsStateSignal.set({ status: 'success', data: reloadedData });
					}),
				);
			});
			fixture.detectChanges(); // Initial render

			component.forceReloadChats();
			expect(component.isLoading()).toBe(true); // Check immediately after call
			expect(mockChatService.forceReloadChats).toHaveBeenCalled();

			tick(1); // Process microtasks and timers (finalize in this case)
			fixture.detectChanges(); // Update view after async op

			expect(component.isLoading()).toBe(false);
			expect(component.sessions()![0].id).toBe('reloaded'); // Check if data is updated
		}));

		it('should set error signal and isLoading to false if chatService.forceReloadChats fails', fakeAsync(() => {
			const errorResponse = new Error('Reload Failed');
			mockChatService.forceReloadChats.and.callFake(() => {
				mockServiceChatsStateSignal.set({ status: 'loading' });
				return of(undefined).pipe(
					delay(1),
					tap(() => {
						throw errorResponse;
					}),
					catchError((err) => {
						mockServiceChatsStateSignal.set({ status: 'error', error: err, code: (err as any).status });
						mockServiceChatsSignal.set([]);
						return throwError(() => err);
					}),
				);
			});
			fixture.detectChanges();

			component.forceReloadChats();
			tick(1);
			fixture.detectChanges();

			expect(component.isLoading()).toBe(false);
			expect(component.error()).toBe(errorResponse);
		}));

		it('should clear error signal when forceReloadChats is called', () => {
			component.error.set(new Error('Previous Error'));
			// Mock to success
			mockChatService.forceReloadChats.and.callFake(() => {
				mockServiceChatsStateSignal.set({ status: 'loading' });
				return of(undefined).pipe(
					delay(1),
					tap(() => {
						mockServiceChatsStateSignal.set({ status: 'success', data: [] });
					}),
				);
			});
			fixture.detectChanges();

			component.forceReloadChats();
			// Error is cleared at the start of forceReloadChats in component
			expect(component.error()).toBeNull();
		});
	});

	describe('Reload Button', () => {
		beforeEach(() => {
			// Ensure component is rendered and initial load is complete
			fixture.detectChanges();
			tick(); // If initial load has delay
			fixture.detectChanges();
		});

		it('should exist in the template', () => {
			const button = fixture.debugElement.nativeElement.querySelector('button[aria-label="Reload chat list"]');
			expect(button).toBeTruthy();
		});

		it('should call component.forceReloadChats() when clicked', () => {
			spyOn(component, 'forceReloadChats').and.callThrough();
			// Mock service call for this interaction
			mockChatService.forceReloadChats.and.returnValue(
				of(undefined).pipe(
					delay(1),
					tap(() => {
						mockServiceChatsStateSignal.set({ status: 'success', data: [] });
					}),
				),
			);

			const button = fixture.debugElement.nativeElement.querySelector('button[aria-label="Reload chat list"]');
			button.click();
			// fixture.detectChanges(); // Not strictly needed before expect if spy is on component method
			expect(component.forceReloadChats).toHaveBeenCalled();
		});

		it('should be disabled when component.isLoading() is true', fakeAsync(() => {
			const button = fixture.debugElement.nativeElement.querySelector('button[aria-label="Reload chat list"]');

			component.isLoading.set(true);
			fixture.detectChanges();
			expect(button.disabled).toBe(true);

			component.isLoading.set(false);
			fixture.detectChanges();
			expect(button.disabled).toBe(false);
		}));
	});
});
