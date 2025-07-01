
import { TestBed, fakeAsync, tick } from '@angular/core/testing';
import { MatIconModule, MatIconRegistry } from '@angular/material/icon';
import { DomSanitizer } from '@angular/platform-browser';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { ActivatedRoute, Params, Router } from '@angular/router';
import { FuseConfirmationService } from '@fuse/services/confirmation';
import { FuseMediaWatcherService } from '@fuse/services/media-watcher';
import { LocalStorageService } from 'app/core/services/local-storage.service';
import { UserService } from 'app/core/user/user.service';
import { MarkdownModule, provideMarkdown } from 'ngx-markdown';
import { BehaviorSubject, catchError, of } from 'rxjs';
import { LlmInfo } from '#shared/llm/llm.model';
import { UserProfile } from '#shared/user/user.model';
import { LlmService } from '../../llm.service';
import { ChatServiceClient } from '../chat.service';
import { Chat, ChatMessage, NEW_CHAT_ID } from '../chat.types';
import { ConversationComponent } from './conversation.component';
import { FUSE_CONFIG } from '../../../../@fuse/services/config/config.constants';
import { FakeChatSvc, FakeLlmSvc, FakeUserSvc } from '../../../../test/fakes';
import { ConversationPo } from './conversation.component.po';

const mockUser: UserProfile = {
	id: 'user1',
	name: 'Test User',
	email: 'test@example.com',
	enabled: true,
	hilBudget: 0,
	hilCount: 0,
	llmConfig: {},
	chat: { defaultLLM: 'llm-default' }, // Ensure chat.defaultLLM is present
	functionConfig: {},
};

const mockLlms: LlmInfo[] = [
	{ id: 'llm-default', name: 'Default LLM', isConfigured: true },
	{ id: 'llm-alt', name: 'Alternative LLM', isConfigured: true },
];

const initialMockChat: Chat = {
	id: 'chat1',
	title: 'Test Chat',
	updatedAt: Date.now(),
	messages: [
		{ id: 'msg1', content: 'Hello User', isMine: false, createdAt: new Date().toISOString(), textContent: 'Hello User' },
		{ id: 'msg2', content: 'Hello Assistant', isMine: true, createdAt: new Date().toISOString(), textContent: 'Hello Assistant' },
	],
};

// Create a fake for FuseMediaWatcherService
export class FakeFuseMediaWatcherService {
	// Mock the onMediaChange$ observable to emit a typical value
	onMediaChange$ = of({ matchingAliases: ['lg'] });
}

xdescribe('ConversationComponent', () => {
	let po: ConversationPo;
	let chat: FakeChatSvc;
	let mockActivatedRouteParams: BehaviorSubject<Params>;

	beforeEach(async () => {
		mockActivatedRouteParams = new BehaviorSubject<Params>({});

		await TestBed.configureTestingModule({
			imports: [ConversationComponent, NoopAnimationsModule, MatIconModule],
			providers: [
				{ provide: ChatServiceClient, useClass: FakeChatSvc },
				{ provide: UserService, useClass: FakeUserSvc },
				{ provide: LlmService, useClass: FakeLlmSvc },
				{ provide: FUSE_CONFIG, useValue: {} },
				{
					provide: ActivatedRoute,
					useValue: {
						params: mockActivatedRouteParams.asObservable(),
						snapshot: { params: {}, queryParams: {} },
						queryParams: of({}),
					},
				},
				// Add the provider for FuseMediaWatcherService
				{ provide: FuseMediaWatcherService, useClass: FakeFuseMediaWatcherService },
			],
		}).compileComponents();

		const iconRegistry = TestBed.inject(MatIconRegistry);
		const sanitizer = TestBed.inject(DomSanitizer);
		iconRegistry.addSvgIconLiteral('heroicons_outline:trash', sanitizer.bypassSecurityTrustHtml('<svg></svg>'));
		const originalGetNamedSvgIcon = iconRegistry.getNamedSvgIcon;
		spyOn(iconRegistry, 'getNamedSvgIcon').and.callFake((iconName: string, namespace = '') => {
			return originalGetNamedSvgIcon.call(iconRegistry, iconName, namespace).pipe(
				catchError(() => {
					const dummySvgElement = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
					return of(dummySvgElement);
				}),
			);
		});

		chat = TestBed.inject(ChatServiceClient) as unknown as FakeChatSvc;

		const fix = TestBed.createComponent(ConversationComponent);
		po = await ConversationPo.create(fix);
	});

	it('shows spinner until a chat arrives', async () => {
		expect(po.isLoading()).toBeTrue();

		chat.setChat({ id: 'c1', title: 'First', messages: [], updatedAt: Date.now() });
		await po.detectAndWait();

		expect(po.isLoading()).toBeFalse();
		expect(po.chatTitle()).toBe('First');
	});

	
	it('sends a message through the UI', async () => {
		chat.setChat({ id: 'c2', title: 'Send', messages: [], updatedAt: Date.now() });
		await po.detectAndWait();

		await po.typeMessage('hello');
		await po.clickSend();

		const svc = TestBed.inject(ChatServiceClient) as unknown as FakeChatSvc;
		expect(svc.sendMessage).toHaveBeenCalled();
		expect(po.inputValue()).toBe('');
	});

	
	it('triggers send on Enter when enabled', async () => {
		chat.setChat({ id: 'c3', title: 'Keys', messages: [], updatedAt: Date.now() });
		await po.detectAndWait();

		await po.typeMessage('enter-send');
		await po.pressEnter();

		expect(chat.sendMessage).toHaveBeenCalled();
	});

	it('when the user sends a message it should 1) clear the input text area, 2) Display the message in the message list, 3) Show a generating message', async () => {
		chat.setChat({ id: 'c2', title: 'Send', messages: [], updatedAt: Date.now() });
		await po.detectAndWait();

		await po.typeMessage('hello');
		await po.clickSend();

		expect(po.inputValue()).toBe('');
		expect(po.messageCount()).toBe(1);

		// What do we really want to verify?
		expect(po.isLoading()).toBeTrue();
	});

	it('when the user sends a message creating a new chat and the generation fails 1) the input text area should be re-populated with the message 2) the failed user message and generating message should be removed', async () => {
		chat.setChat({ id: 'c2', title: 'Send', messages: [], updatedAt: Date.now() });
		await po.detectAndWait();

		// Make the chatService fail
		// chat.createChat() should sleep 1 and throw an error
		chat.createChat.and.returnValue(of(new Error('test')));

		await po.typeMessage('hello');
		await po.clickSend();

		expect(po.inputValue()).toBe('hello');
		expect(po.messageCount()).toBe(0);
		expect(po.isLoading()).toBeFalse();
	});

	it('when the user sends a message to an existing chat and the generation fails 1) the input text area should be re-populated with the message 2) the failed user message and generating message should be removed', async () => {
		chat.setChat({ id: 'c2', title: 'Send', messages: [], updatedAt: Date.now() });
		await po.detectAndWait();

		// Make the chatService fail
		// chat.createChat() should sleep 1 and throw an error
		chat.sendMessage.and.returnValue(of(new Error('test')));

		await po.typeMessage('hello');
		await po.clickSend();

		expect(po.inputValue()).toBe('hello');
		expect(po.messageCount()).toBe(0);
		expect(po.isLoading()).toBeFalse();
	});



	// This is a valid case for interaction testing, as we want to test the values are being set on the remote API call
	describe('Sending message options', () => {
		it('The selected LLM should be set on the options', async () => {
			chat.setChat({ id: 'c2', title: 'Send', messages: [], updatedAt: Date.now() });
			await po.detectAndWait();

			await po.chooseLlmByText('GPT-4');
			// To reduce the brittlenes off the test, only verify that the llmId is set correctly on the sendMessage options
			// The following is incorrect as we are assuming the chatId and content are set correctly
			// expect(chat.sendMessage).toHaveBeenCalledWith({
			// 	chatId: 'c2',
			// 	llmId: 'llm-alt',
			// 	content: 'hello',
			// });
			// Make the test non-brittle by only verifying that the llmId is set correctly on the sendMessage options
			expect(chat.sendMessage).toHaveBeenCalledWith(jasmine.objectContaining({ llmId: 'llm-alt' }));
		})

		it('The temperature should be set on the options', async() => {
			chat.setChat({ id: 'c2', title: 'Send', messages: [], updatedAt: Date.now() });
			await po.detectAndWait();

			await po.setTemperature(0.7);
			expect(chat.sendMessage).toHaveBeenCalledWith(jasmine.objectContaining({ temperature: 0.7 }));
		})
	})

	
	it('allows picking an LLM from the select', async () => {
		chat.setChat({ id: 'c4', title: 'LLM', messages: [], updatedAt: Date.now() });
		await po.detectAndWait();

		await po.chooseLlmByText('GPT-4');
		// nothing more to assert – if the above line didn’t throw,
		// the public behaviour (select shows value) is fine.
	});

	
	it('attaches a file before sending', fakeAsync(async () => {
		chat.setChat({ id: 'c5', title: 'Files', messages: [], updatedAt: Date.now() });
		await po.detectAndWait();

		const file = new File(['x'], 'img.png', { type: 'image/png' });
		await po.attach([file]);

		await po.typeMessage('with file');
		await po.clickSend();
		tick(); // process observables in fakeAsync zone

		expect(chat.sendMessage).toHaveBeenCalled();
	}));

	
	it('opens the info drawer', async () => {
		chat.setChat({ id: 'c6', title: 'Drawer', messages: [], updatedAt: Date.now() });
		await po.detectAndWait();

		expect(po.drawerOpened()).toBeFalse();
		await po.openDrawer();
		expect(po.drawerOpened()).toBeTrue();
	});
});
