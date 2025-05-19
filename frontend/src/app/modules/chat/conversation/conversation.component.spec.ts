import { ComponentFixture, TestBed, waitForAsync } from '@angular/core/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { RouterTestingModule } from '@angular/router/testing';
import { MatSnackBarModule } from '@angular/material/snack-bar';
import { MatSidenavModule } from '@angular/material/sidenav';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatMenuModule } from '@angular/material/menu';
import { MatSelectModule } from '@angular/material/select';
import { TextFieldModule } from '@angular/cdk/text-field';
import { ClipboardModule } from '@angular/cdk/clipboard';
import { MarkdownModule, provideMarkdown } from 'ngx-markdown';
import { of } from 'rxjs';
import { signal } from '@angular/core';

import { ConversationComponent } from './conversation.component';
import { ChatServiceClient } from '../chat.service';
import { LlmService } from '../../agents/services/llm.service';
import { UserService } from 'app/core/user/user.service';
import { FuseMediaWatcherService } from '@fuse/services/media-watcher';
import { FuseConfirmationService } from '@fuse/services/confirmation';
import type { Chat, ChatMessage } from '../chat.types';
import type { UserProfile } from '#shared/schemas/user.schema';
import type { LLM } from '../../agents/services/llm.service';

const mockChat: Chat = {
  id: 'chat1',
  title: 'Test Chat',
  updatedAt: Date.now(),
  messages: [
    { id: 'msg1', content: 'Hello User', isMine: false, createdAt: new Date().toISOString(), textContent: 'Hello User' },
    { id: 'msg2', content: 'Hello Assistant', isMine: true, createdAt: new Date().toISOString(), textContent: 'Hello Assistant' },
  ],
};

const mockUser: UserProfile = {
  id: 'user1',
  name: 'Test User',
  email: 'test@example.com',
  enabled: true,
  hilBudget: 0,
  hilCount: 0,
  llmConfig: {},
  chat: { defaultLLM: 'llm-default' },
  functionConfig: {},
  // createdAt: new Date().toISOString(), // Removed as UserProfile does not have these
  // updatedAt: new Date().toISOString(),
};

const mockLlms: LLM[] = [
  { id: 'llm-default', name: 'Default LLM', isConfigured: true },
  { id: 'llm-alt', name: 'Alternative LLM', isConfigured: true },
];

describe('ConversationComponent', () => {
  let component: ConversationComponent;
  let fixture: ComponentFixture<ConversationComponent>;
  let mockChatService: any;
  let mockLlmService: any;
  let mockUserService: any;
  let mockMediaWatcherService: any;
  let mockConfirmationService: any;

  beforeEach(waitForAsync(() => {
    mockChatService = {
      chat: signal(null),
      chats: signal([]),
      loadChatById: jasmine.createSpy('loadChatById').and.returnValue(of(undefined)), // Returns Observable<void>
      loadChats: jasmine.createSpy('loadChats').and.returnValue(of(undefined)), // Returns Observable<void>
      resetChat: jasmine.createSpy('resetChat'),
      deleteChat: jasmine.createSpy('deleteChat').and.returnValue(of(undefined)), // Returns Observable<void>
      createChat: jasmine.createSpy('createChat').and.returnValue(of(mockChat)), // Returns Observable<Chat>
      sendMessage: jasmine.createSpy('sendMessage').and.returnValue(of(undefined)), // Returns Observable<void>
      regenerateMessage: jasmine.createSpy('regenerateMessage').and.returnValue(of(undefined)), // Returns Observable<void>
      sendAudioMessage: jasmine.createSpy('sendAudioMessage').and.returnValue(of(undefined)), // Returns Observable<void>
      formatMessageAsMarkdown: jasmine.createSpy('formatMessageAsMarkdown').and.returnValue(of('formatted')),
      setChat: jasmine.createSpy('setChat'),
    };
    // Set the signal value after creating the mock object
    mockChatService.chat.set(mockChat);


    mockLlmService = {
      getLlms: jasmine.createSpy('getLlms').and.returnValue(of(mockLlms)),
    };

    mockUserService = {
      user$: of(mockUser), // UserService exposes user$ as an Observable
      get: jasmine.createSpy('get').and.returnValue(of(mockUser)), // Mock the get method
    };

    mockMediaWatcherService = {
      onMediaChange$: of({ matchingAliases: ['lg'] }),
    };

    mockConfirmationService = {
      open: jasmine.createSpy('open').and.returnValue({ afterClosed: () => of('confirmed') }),
    };

    TestBed.configureTestingModule({
      imports: [
        ConversationComponent, // Import the standalone component
        NoopAnimationsModule,
        RouterTestingModule,
        MatSnackBarModule,
        // MatSidenavModule, // Already imported by ConversationComponent
        // MatFormFieldModule, // Already imported by ConversationComponent
        // MatInputModule, // Already imported by ConversationComponent
        // MatIconModule, // Already imported by ConversationComponent
        // MatButtonModule, // Already imported by ConversationComponent
        // MatMenuModule, // Already imported by ConversationComponent
        // MatSelectModule, // Already imported by ConversationComponent
        // TextFieldModule, // Already imported by ConversationComponent
        // ClipboardModule, // Already imported by ConversationComponent
        MarkdownModule.forRoot(), // Ensure MarkdownModule is configured
      ],
      providers: [
        { provide: ChatServiceClient, useValue: mockChatService },
        { provide: LlmService, useValue: mockLlmService },
        { provide: UserService, useValue: mockUserService },
        { provide: FuseMediaWatcherService, useValue: mockMediaWatcherService },
        { provide: FuseConfirmationService, useValue: mockConfirmationService },
        provideMarkdown(), // Provide markdown services
      ],
    }).compileComponents();
  }));

  beforeEach(() => {
    fixture = TestBed.createComponent(ConversationComponent);
    component = fixture.componentInstance;
    // fixture.detectChanges(); // Moved to after initial setup or specific tests
  });

  it('should create', () => {
    fixture.detectChanges(); // Initial data binding
    expect(component).toBeTruthy();
  });

  it('should load chat on init if route has ID', () => {
    // Simulate route params having an ID
    mockChatService.chat.set(null); // Reset chat before test
    spyOnProperty(component['route'], 'params', 'get').and.returnValue(of({ id: 'chat1' }));
    fixture.detectChanges(); // Trigger ngOnInit and effects

    expect(mockChatService.loadChatById).toHaveBeenCalledWith('chat1');
  });


  it('should display messages from the chat', () => {
    mockChatService.chat.set(mockChat); // Ensure chat is set
    fixture.detectChanges(); // Trigger effects and rendering
    const messages = component.displayedMessages();
    expect(messages.length).toBe(mockChat.messages.length);
    // Further checks can be done on the rendered DOM elements
  });


  describe('Attachment Functionality in ConversationComponent', () => {
    it('should add files to selectedAttachments using addFiles method', () => {
      // Test addFiles
    });

    it('should convert attachments and text to UserContentExt on sendMessage', () => {
      // Test sendMessage payload
    });

    it('should parse UserContentExt to display attachments and text in displayedMessages', () => {
      // Test displayedMessages computation
    });

    it('should handle image previews correctly in the template', () => {
      // Mock messages with image attachments, check DOM
    });

    it('should handle file previews/icons correctly in the template', () => {
      // Mock messages with file attachments, check DOM
    });
  });
});
