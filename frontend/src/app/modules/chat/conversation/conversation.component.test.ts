import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { ConversationComponent } from './conversation.component';
import { ChatServiceClient } from '../chat.service';
import { LlmService } from 'app/modules/agents/services/llm.service';
import { UserService } from 'app/core/user/user.service';
import { FuseConfirmationService } from '@fuse/services/confirmation';
import { FuseMediaWatcherService } from '@fuse/services/media-watcher';
import { MarkdownService, provideMarkdown } from 'ngx-markdown';
import { ActivatedRoute, Router } from '@angular/router';
import { MatSnackBar } from '@angular/material/snack-bar';
import { ChangeDetectorRef, ElementRef, NgZone } from '@angular/core';
import { of, Subject, throwError } from 'rxjs';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatTooltipModule } from '@angular/material/tooltip';
import { TextFieldModule } from '@angular/cdk/text-field';
import { ClipboardModule } from '@angular/cdk/clipboard';
import { By } from '@angular/platform-browser';
import { DatePipe, DecimalPipe } from '@angular/common';
import {UserProfile} from "#shared/schemas/user.api.schema"; // Import necessary pipes

// Helper function to create a mock File object
const createMockFile = (name: string, size: number, type: string): File => {
    const blob = new Blob(['a'.repeat(size)], { type });
    return new File([blob], name, { type });
};

// Mock FileReader
class MockFileReader {
    result: string | ArrayBuffer | null = null;
    onload: (event: ProgressEvent<FileReader>) => void = () => {};
    onerror: (event: ProgressEvent<FileReader>) => void = () => {};
    readAsDataURL(file: Blob): void {
        // Simulate async reading
        setTimeout(() => {
            if (file.type.startsWith('image/')) {
                this.result = `data:${file.type};base64,${btoa('mock-image-content')}`; // Simulate base64 data URL
                if (this.onload) {
                    // this.onload({ target: this } as ProgressEvent<FileReader>); // compile error
                }
            } else {
                // Simulate an error for non-images if needed, or just don't call onload
                 if (this.onerror) {
                    // this.onerror({ target: this } as ProgressEvent<FileReader>); // compile error
                 }
            }
        }, 10); // Simulate async delay
    }
    // Add other methods if needed (readAsText, etc.)
}

describe('ConversationComponent', () => {
    let component: ConversationComponent;
    let fixture: ComponentFixture<ConversationComponent>;
    let mockChatService: jasmine.SpyObj<ChatServiceClient>;
    let mockLlmService: jasmine.SpyObj<LlmService>;
    let mockUserService: jasmine.SpyObj<UserService>;
    let mockConfirmationService: jasmine.SpyObj<FuseConfirmationService>;
    let mockMediaWatcherService: jasmine.SpyObj<FuseMediaWatcherService>;
    let mockMarkdownService: jasmine.SpyObj<MarkdownService>;
    let mockRouter: jasmine.SpyObj<Router>;
    let mockActivatedRoute: any;
    let mockSnackBar: jasmine.SpyObj<MatSnackBar>;
    let mockChangeDetectorRef: jasmine.SpyObj<ChangeDetectorRef>;
    let mockNgZone: jasmine.SpyObj<NgZone>;

    const mockUser: UserProfile = {
        id: 'user-1',
        name: 'Test User',
        email: 'test@example.com',
        enabled: true,
        hilBudget: 0,
        hilCount: 0,
        functionConfig: {},
        llmConfig: {},
        chat: { defaultLLM: 'openai:gpt-4'}
    };

    beforeEach(async () => {
        mockChatService = jasmine.createSpyObj('ChatService', ['resetChat', 'deleteChat', 'createChat', 'sendMessage', 'sendAudioMessage', 'regenerateMessage'], {
            chat$: new Subject<any>(), // Use Subjects for observables
            chats$: new Subject<any>()
        });
        mockLlmService = jasmine.createSpyObj('LlmService', ['getLlms']);
        mockUserService = jasmine.createSpyObj('UserService', ['get'], { user$: of(mockUser) });
        mockConfirmationService = jasmine.createSpyObj('FuseConfirmationService', ['open']);
        mockMediaWatcherService = jasmine.createSpyObj('FuseMediaWatcherService', ['onMediaChange$'], { onMediaChange$: new Subject<any>() });
        mockMarkdownService = jasmine.createSpyObj('MarkdownService', [], { options: {} });
        mockRouter = jasmine.createSpyObj('Router', ['navigate']);
        mockActivatedRoute = { params: of({ id: 'chat-1' }) }; // Simulate route params
        mockSnackBar = jasmine.createSpyObj('MatSnackBar', ['open']);
        // Use partial spy for ChangeDetectorRef to allow detectChanges to work
        const cdRef = jasmine.createSpyObj<ChangeDetectorRef>('ChangeDetectorRef', ['markForCheck', 'detectChanges']);
        mockChangeDetectorRef = cdRef;

        mockNgZone = jasmine.createSpyObj('NgZone', ['runOutsideAngular']);

        // Mock NgZone runOutsideAngular to just run the callback immediately for simplicity
        mockNgZone.runOutsideAngular.and.callFake((fn: Function) => fn());

        // Mock global FileReader
        spyOn(window, 'FileReader').and.returnValue(new MockFileReader() as any);


        await TestBed.configureTestingModule({
            imports: [
                ConversationComponent, // Import standalone component
                NoopAnimationsModule, // Disable animations for testing
                MatIconModule,
                MatFormFieldModule,
                MatInputModule,
                MatSelectModule,
                MatTooltipModule,
                TextFieldModule,
                ClipboardModule,
                // Import other necessary modules used by the template if not standalone
            ],
            providers: [
                { provide: ChatServiceClient, useValue: mockChatService },
                { provide: LlmService, useValue: mockLlmService },
                { provide: UserService, useValue: mockUserService },
                { provide: FuseConfirmationService, useValue: mockConfirmationService },
                { provide: FuseMediaWatcherService, useValue: mockMediaWatcherService },
                { provide: MarkdownService, useValue: mockMarkdownService },
                { provide: Router, useValue: mockRouter },
                { provide: ActivatedRoute, useValue: mockActivatedRoute },
                { provide: MatSnackBar, useValue: mockSnackBar },
                // Provide the partial spy, but allow TestBed to manage the actual instance for detectChanges
                { provide: ChangeDetectorRef, useValue: mockChangeDetectorRef },
                { provide: NgZone, useValue: mockNgZone },
                provideMarkdown(), // Provide markdown service
                DatePipe, // Provide necessary pipes used in template
                DecimalPipe,
            ],
            // schemas: [NO_ERRORS_SCHEMA] // Use if child components are complex and not needed
        }).compileComponents();

        // Mock return values
        mockLlmService.getLlms.and.returnValue(of([{ isConfigured: true, id: 'openai:gpt-4', name: 'GPT-4', supports_anthropic_beta_tools: false, supports_functions: false, supports_json: false, supports_parallel_function_calling: false, supports_system_prompt: false, supports_tools: false, supports_vision: false }]));
        mockUserService.get.and.returnValue(of(mockUser));

        fixture = TestBed.createComponent(ConversationComponent);
        component = fixture.componentInstance;

        // Mock necessary elements if accessed directly (prefer template interaction)
        // component.messageInput = { nativeElement: { value: '', style: {}, scrollHeight: 50, focus: jasmine.createSpy() } } as ElementRef<HTMLTextAreaElement>; // compile error

        // Use the actual ChangeDetectorRef from the fixture after creation
        // This allows markForCheck to be spied on, but detectChanges to work naturally
        spyOn(fixture.componentRef.injector.get(ChangeDetectorRef).constructor.prototype, 'markForCheck').and.callThrough();


        // Initial data load simulation
        (mockChatService.chat$ as Subject<any>).next({ id: 'chat-1', messages: [], title: 'Test Chat', updatedAt: Date.now() });
        (mockChatService.chats$ as Subject<any>).next([{ id: 'chat-1', title: 'Test Chat', updatedAt: Date.now() }]);

        fixture.detectChanges(); // Initial binding
    });

    it('should create', () => {
        expect(component).toBeTruthy();
    });

    describe('Attachment Handling', () => {

        it('should add a file attachment without previewUrl', fakeAsync(() => {
            const file = createMockFile('document.pdf', 1024, 'application/pdf');
            component['addFiles']([file]); // Access private method for specific unit test
            tick(20); // Allow FileReader simulation to complete (even though it errors/doesn't load for PDF)
            fixture.detectChanges();

            expect(component.selectedAttachments.length).toBe(1);
            const attachment = component.selectedAttachments[0];
            expect(attachment.filename).toBe('document.pdf');
            expect(attachment.type).toBe('file');
            expect(attachment.previewUrl).toBeUndefined();
            expect(attachment.data).toBe(file); // Ensure original file is stored
            expect(fixture.componentRef.injector.get(ChangeDetectorRef).markForCheck).toHaveBeenCalled();

            // Check template for preview section update
            const previewElements = fixture.debugElement.queryAll(By.css('.attachment-previews > div'));
            expect(previewElements.length).toBe(1);
            const imgElement = previewElements[0].query(By.css('img'));
            expect(imgElement).toBeNull(); // No image preview for PDF
            const fileIcon = previewElements[0].query(By.css('mat-icon[svgicon="heroicons_outline:document"]'));
            expect(fileIcon).not.toBeNull();
            expect(previewElements[0].nativeElement.textContent).toContain('document.pdf');
            expect(previewElements[0].nativeElement.textContent).toContain('1.0 KB'); // Check size display
        }));

        it('should add an image attachment with previewUrl', fakeAsync(() => {
            const imageFile = createMockFile('image.png', 2048, 'image/png');
            component['addFiles']([imageFile]);
            tick(20); // Allow FileReader simulation to complete
            fixture.detectChanges();

            expect(component.selectedAttachments.length).toBe(1);
            const attachment = component.selectedAttachments[0];
            expect(attachment.filename).toBe('image.png');
            expect(attachment.type).toBe('image');
            expect(attachment.previewUrl).toMatch(/^data:image\/png;base64,/); // Check if data URL is set
            expect(attachment.data).toBe(imageFile);
            expect(fixture.componentRef.injector.get(ChangeDetectorRef).markForCheck).toHaveBeenCalledTimes(2); // Once after loop, once in onload

            // Check template for preview section update
            const previewElements = fixture.debugElement.queryAll(By.css('.attachment-previews > div'));
            expect(previewElements.length).toBe(1);
            const imgElement = previewElements[0].query(By.css('img'));
            expect(imgElement).not.toBeNull();
            expect(imgElement.properties['src']).toBe(attachment.previewUrl);
            expect(imgElement.properties['alt']).toBe('image.png');
            expect(previewElements[0].nativeElement.textContent).toContain('image.png');
            expect(previewElements[0].nativeElement.textContent).toContain('2.0 KB');
        }));

        it('should prevent adding duplicate files', fakeAsync(() => {
            const file1 = createMockFile('report.txt', 500, 'text/plain');
            component['addFiles']([file1]);
            tick(20);
            component['addFiles']([file1]); // Add the same file again
            tick(20);
            fixture.detectChanges();

            expect(component.selectedAttachments.length).toBe(1); // Should only be added once
        }));

        it('should remove an attachment when remove button is clicked', fakeAsync(() => {
            const imageFile = createMockFile('image.jpg', 1000, 'image/jpeg');
            const docFile = createMockFile('notes.txt', 500, 'text/plain');
            component['addFiles']([imageFile, docFile]);
            tick(20);
            fixture.detectChanges();

            expect(component.selectedAttachments.length).toBe(2);
            let previewElements = fixture.debugElement.queryAll(By.css('.attachment-previews > div'));
            expect(previewElements.length).toBe(2);

            // Find the remove button for the first attachment (image.jpg)
            const removeButton = previewElements[0].query(By.css('button[mat-icon-button]'));
            expect(removeButton).toBeTruthy(); // Ensure button exists
            removeButton.nativeElement.click();
            tick(); // Allow event processing and state update
            fixture.detectChanges();

            expect(component.selectedAttachments.length).toBe(1);
            expect(component.selectedAttachments[0].filename).toBe('notes.txt');
            const updatedPreviewElements = fixture.debugElement.queryAll(By.css('.attachment-previews > div'));
            expect(updatedPreviewElements.length).toBe(1);
            expect(updatedPreviewElements[0].nativeElement.textContent).toContain('notes.txt');
            expect(fixture.componentRef.injector.get(ChangeDetectorRef).markForCheck).toHaveBeenCalled();
        }));
    });

    describe('Message Sending with Attachments', () => {

        beforeEach(() => {
            // Ensure user is set for preference checks
             mockUserService.get.and.returnValue(of(mockUser));
             component.chat = { id: 'chat-1', messages: [], title: 'Test Chat', updatedAt: Date.now() };
             component.llmId = 'openai:gpt-4'; // Set a default LLM
             fixture.detectChanges();
        });

        it('should add message with image attachment (including preview) locally immediately', fakeAsync(() => {
            const imageFile = createMockFile('cat.gif', 3000, 'image/gif');
            component['addFiles']([imageFile]);
            tick(20); // Process file reading
            fixture.detectChanges();

            expect(component.selectedAttachments.length).toBe(1);
            const previewUrl = component.selectedAttachments[0].previewUrl;
            expect(previewUrl).toBeTruthy();

            // Set message text and send
            component.messageInput.nativeElement.value = 'Look at this cat!';
            const sendButton = fixture.debugElement.query(By.css('button[mat-icon-button] > mat-icon[svgicon="heroicons_outline:paper-airplane"]'))?.parent;
            expect(sendButton).toBeTruthy("Send button not found");

            const mockResponseChat = {
                 id: 'chat-1',
                 title: 'Test Chat',
                 updatedAt: Date.now(),
                 messages: [ // Simulate backend response with the message and maybe stats
                    { id: 'msg-1', textContent: 'Look at this cat!', isMine: true, attachments: [{ filename: 'cat.gif', type: 'image', size: 3000, mimeType: 'image/gif' /* no previewUrl from backend */ }], createdAt: new Date().toISOString() },
                    { id: 'msg-2', textContent: 'Wow, cute cat!', isMine: false, llmId: 'openai:gpt-4', createdAt: new Date().toISOString() }
                 ]
            };
            mockChatService.sendMessage.and.returnValue(of(mockResponseChat));

            sendButton.nativeElement.click();
            tick(); // Allow async operations like _getUserPreferences
            fixture.detectChanges(); // Detect changes after clicking send

            // Check local chat messages *before* service responds fully (user + generating)
            expect(component.chat.messages.length).toBe(2);
            const userMessage = component.chat.messages[0];
            expect(userMessage.isMine).toBeTrue();
            expect(userMessage.textContent).toBe('Look at this cat!');
            expect(userMessage.imageAttachments?.length).toBe(1);
            expect(userMessage.imageAttachments[0].filename).toBe('cat.gif');
            expect(userMessage.imageAttachments[0].previewUrl).toBe(previewUrl); // Crucial: Preview URL is present locally
            expect(userMessage.imageAttachments[0].data).toBe(imageFile); // Original file data should still be there locally initially

            // Check the template for the rendered message
            // Need to wait for potential async updates within the template rendering if any
            fixture.detectChanges(); // Ensure template is up-to-date with local messages
            const messageElements = fixture.debugElement.queryAll(By.css('.conversation-container .flex-col[ngclass]'));
            // Find the user's message bubble (should be the first one added)
            const userMessageBubble = messageElements[0];
            expect(userMessageBubble).toBeTruthy("User message bubble not found in template");

            const imgElement = userMessageBubble.query(By.css('img'));
            expect(imgElement).not.toBeNull("Image element not found in user message bubble");
            expect(imgElement.properties['src']).toBe(previewUrl);
            expect(imgElement.properties['alt']).toBe('cat.gif');

            // Check that selectedAttachments is cleared
            expect(component.selectedAttachments.length).toBe(0);
            const previewContainer = fixture.debugElement.query(By.css('.attachment-previews'));
            expect(previewContainer).toBeNull("Preview container should disappear after sending"); // Preview section should disappear

            // Simulate service response
            tick(100); // Allow time for the service call observable to emit
            fixture.detectChanges(); // Update view with response from service

            // Verify chat state after service response
            expect(component.chat.messages.length).toBe(mockResponseChat.messages.length);
            expect(component.chat.messages[0].textContent).toBe(mockResponseChat.messages[0].textContent);
            // Backend response might not include previewUrl, check accordingly
            expect(component.chat.messages[0].imageAttachments[0].previewUrl).toBeUndefined(); // Assuming backend doesn't send previewUrl

            tick(1000); // Simulate passage of time
        }));

         it('should call ChatService.sendMessage with correct attachment data (no previewUrl)', fakeAsync(() => {
            const imageFile = createMockFile('dog.png', 4000, 'image/png');
            const docFile = createMockFile('info.txt', 500, 'text/plain');
            component['addFiles']([imageFile, docFile]);
            tick(20);
            fixture.detectChanges();

            const localAttachments = [...component.selectedAttachments]; // Copy for verification later

            component.messageInput.nativeElement.value = 'Files attached';
            const sendButton = fixture.debugElement.query(By.css('button[mat-icon-button] > mat-icon[svgicon="heroicons_outline:paper-airplane"]'))?.parent;
             expect(sendButton).toBeTruthy("Send button not found");

            mockChatService.sendMessage.and.returnValue(of({
                 id: 'chat-1', messages: [], title: 'Test Chat', updatedAt: Date.now()
            }));

            sendButton.nativeElement.click();
            tick(); // Allow async operations in send
            fixture.detectChanges();

            expect(mockChatService.sendMessage).toHaveBeenCalledTimes(1);
            const [chatId, message, llmId, options, attachmentsToSend] = mockChatService.sendMessage.calls.argsFor(0);

            expect(chatId).toBe('chat-1');
            expect(message).toBe('Files attached');
            expect(llmId).toBe('openai:gpt-4');
            expect(attachmentsToSend.length).toBe(2);

            // Verify image attachment sent to service
            const imageAttachmentSent = attachmentsToSend.find(a => a.filename === 'dog.png');
            expect(imageAttachmentSent).toBeTruthy();
            expect(imageAttachmentSent.type).toBe('image');
            expect(imageAttachmentSent.data).toBe(imageFile); // Should be the File object
            expect(imageAttachmentSent.mimeType).toBe('image/png');
            expect(imageAttachmentSent.previewUrl).toBeUndefined(); // Service shouldn't receive previewUrl

            // Verify file attachment sent to service
            const fileAttachmentSent = attachmentsToSend.find(a => a.filename === 'info.txt');
            expect(fileAttachmentSent).toBeTruthy();
            expect(fileAttachmentSent.type).toBe('file');
            expect(fileAttachmentSent.data).toBe(docFile);
            expect(fileAttachmentSent.mimeType).toBe('text/plain');
            expect(fileAttachmentSent.previewUrl).toBeUndefined();

            tick(1000);
        }));

        it('should restore attachments and input if sending fails', fakeAsync(() => {
            const imageFile = createMockFile('fail.jpg', 1500, 'image/jpeg');
            component['addFiles']([imageFile]);
            tick(20);
            fixture.detectChanges();

            const initialAttachments = [...component.selectedAttachments];
            const messageText = 'This will fail';
            component.messageInput.nativeElement.value = messageText;

            mockChatService.sendMessage.and.returnValue(throwError(() => new Error('Network Error')));
            mockUserService.get.and.returnValue(of(mockUser)); // Ensure user prefs are fetched

            const sendButton = fixture.debugElement.query(By.css('button[mat-icon-button] > mat-icon[svgicon="heroicons_outline:paper-airplane"]'))?.parent;
            expect(sendButton).toBeTruthy("Send button not found");

            sendButton.nativeElement.click();
            tick(); // Allow async operations (getUserPrefs, sendMessage call)
            fixture.detectChanges(); // Update view after error handling

            // Check that generating is false
            expect(component.generating).toBeFalse();

            // Check that input is restored
            expect(component.messageInput.nativeElement.value).toBe(messageText);

            // Check that attachments are restored
            expect(component.selectedAttachments.length).toBe(1);
            expect(component.selectedAttachments[0].filename).toBe('fail.jpg');
            expect(component.selectedAttachments[0].previewUrl).toEqual(initialAttachments[0].previewUrl); // Check preview URL is also restored

            // Check that preview section is visible again
            const previewElements = fixture.debugElement.queryAll(By.css('.attachment-previews > div'));
            expect(previewElements.length).toBe(1);
            expect(previewElements[0].nativeElement.textContent).toContain('fail.jpg');

            // Check that error snackbar was shown
            expect(mockSnackBar.open).toHaveBeenCalledWith(
                'Failed to send message. Please try again.',
                'Close',
                jasmine.objectContaining({ // Use objectContaining for flexibility
                    duration: 5000,
                    horizontalPosition: 'center',
                    verticalPosition: 'bottom',
                    panelClass: ['error-snackbar']
                })
            );

            // Check that the local messages were removed
            expect(component.chat.messages.length).toBe(0); // Assuming it started empty

            tick(1000);
        }));
    });

    describe('parseMessageContent', () => {
        it('should return an empty array for null input', () => {
            const componentInstance = fixture.componentInstance;
            const inputString = null;
            const expectedOutput: any[] = [];
            const result = (componentInstance as any).parseMessageContent(inputString);
            expect(result).toEqual(expectedOutput);
        });

        it('should return an empty array for undefined input', () => {
            const componentInstance = fixture.componentInstance;
            const inputString = undefined;
            const expectedOutput: any[] = [];
            const result = (componentInstance as any).parseMessageContent(inputString);
            expect(result).toEqual(expectedOutput);
        });

        it('should return an empty array for an empty string input', () => {
            const componentInstance = fixture.componentInstance;
            const inputString = "";
            const expectedOutput: any[] = [];
            const result = (componentInstance as any).parseMessageContent(inputString);
            expect(result).toEqual(expectedOutput);
        });

        it('should parse plain text into a single text chunk', () => {
            const componentInstance = fixture.componentInstance;
            const inputString = "Hello world";
            const expectedOutput = [{ type: 'text', value: "Hello world" }];
            const result = (componentInstance as any).parseMessageContent(inputString);
            expect(result).toEqual(expectedOutput);
        });

        it('should parse whitespace-only string into a single text chunk', () => {
            const componentInstance = fixture.componentInstance;
            const inputString = "   ";
            const expectedOutput = [{ type: 'text', value: "   " }];
            const result = (componentInstance as any).parseMessageContent(inputString);
            expect(result).toEqual(expectedOutput);
        });

        it('should parse a single code block with language correctly', () => {
            const componentInstance = fixture.componentInstance;
            const inputString = "```javascript\nconsole.log(\"test\");\n```";
            const expectedOutput = [{ type: 'markdown', value: "```javascript\nconsole.log(\"test\");\n```" }];
            const result = (componentInstance as any).parseMessageContent(inputString);
            expect(result).toEqual(expectedOutput);
        });

        it('should parse a single code block without language correctly', () => {
            const componentInstance = fixture.componentInstance;
            const inputString = "```\ncode\n```";
            const expectedOutput = [{ type: 'markdown', value: "```\ncode\n```" }];
            const result = (componentInstance as any).parseMessageContent(inputString);
            expect(result).toEqual(expectedOutput);
        });

        it('should parse text followed by a code block', () => {
            const componentInstance = fixture.componentInstance;
            const inputString = "Hello\n```python\nprint(\"world\")\n```";
            const expectedOutput = [{ type: 'text', value: "Hello\n" }, { type: 'markdown', value: "```python\nprint(\"world\")\n```" }];
            const result = (componentInstance as any).parseMessageContent(inputString);
            expect(result).toEqual(expectedOutput);
        });

        it('should parse a code block followed by text', () => {
            const componentInstance = fixture.componentInstance;
            const inputString = "```python\nprint(\"world\")\n```\nHello";
            const expectedOutput = [{ type: 'markdown', value: "```python\nprint(\"world\")\n```" }, { type: 'text', value: "\nHello" }];
            const result = (componentInstance as any).parseMessageContent(inputString);
            expect(result).toEqual(expectedOutput);
        });

        it('should parse text, then a code block, then more text', () => {
            const componentInstance = fixture.componentInstance;
            const inputString = "Prefix\n```js\nvar x = 1;\n```\nSuffix";
            const expectedOutput = [{ type: 'text', value: "Prefix\n" }, { type: 'markdown', value: "```js\nvar x = 1;\n```" }, { type: 'text', value: "\nSuffix" }];
            const result = (componentInstance as any).parseMessageContent(inputString);
            expect(result).toEqual(expectedOutput);
        });

        it('should parse multiple code blocks with interleaving text', () => {
            const componentInstance = fixture.componentInstance;
            const inputString = "Block 1\n```code1\ncontent1\n```\nBlock 2\n```code2\ncontent2\n```";
            const expectedOutput = [{ type: 'text', value: "Block 1\n" }, { type: 'markdown', value: "```code1\ncontent1\n```" }, { type: 'text', value: "\nBlock 2\n" }, { type: 'markdown', value: "```code2\ncontent2\n```" }];
            const result = (componentInstance as any).parseMessageContent(inputString);
            expect(result).toEqual(expectedOutput);
        });

        it('should parse adjacent code blocks without creating empty text chunks between them', () => {
            const componentInstance = fixture.componentInstance;
            const inputString = "```lang1\ncontent1\n``````lang2\ncontent2\n```";
            const expectedOutput = [{ type: 'markdown', value: "```lang1\ncontent1\n```" }, { type: 'markdown', value: "```lang2\ncontent2\n```" }];
            const result = (componentInstance as any).parseMessageContent(inputString);
            expect(result).toEqual(expectedOutput);
        });

        it('should parse code blocks separated by only a newline into three chunks (md, text, md)', () => {
            const componentInstance = fixture.componentInstance;
            const inputString = "```c1\ncode1\n```\n```c2\ncode2\n```";
            const expectedOutput = [{ type: 'markdown', value: "```c1\ncode1\n```" }, { type: 'text', value: "\n" }, { type: 'markdown', value: "```c2\ncode2\n```" }];
            const result = (componentInstance as any).parseMessageContent(inputString);
            expect(result).toEqual(expectedOutput);
        });
    });
});
