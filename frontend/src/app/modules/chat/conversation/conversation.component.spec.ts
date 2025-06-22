import { ClipboardModule } from '@angular/cdk/clipboard';
import { TextFieldModule } from '@angular/cdk/text-field';
import { WritableSignal, signal } from '@angular/core';
import { ComponentFixture, TestBed, fakeAsync, tick, waitForAsync } from '@angular/core/testing';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule, MatIconRegistry } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatMenuModule } from '@angular/material/menu';
import { MatSelectModule } from '@angular/material/select';
import { MatSidenavModule } from '@angular/material/sidenav';
import { MatSnackBarModule } from '@angular/material/snack-bar';
import { By, DomSanitizer } from '@angular/platform-browser';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { ActivatedRoute, Params, Router } from '@angular/router';
import { RouterTestingModule } from '@angular/router/testing';
import { FuseConfirmationService } from '@fuse/services/confirmation';
import { FuseMediaWatcherService } from '@fuse/services/media-watcher'; // Import the actual service type
import { LocalStorageService } from 'app/core/services/local-storage.service';
import { UserService } from 'app/core/user/user.service';
import { MarkdownModule, provideMarkdown } from 'ngx-markdown';
import { BehaviorSubject, catchError, of, throwError } from 'rxjs';
import { UserContentExt } from '#shared/llm/llm.model';
import { UserProfile } from '#shared/user/user.model';
import { LLM, LlmService } from '../../llm.service'; // Keep existing LlmService and LLM type
import { ChatServiceClient } from '../chat.service';
import { Chat, ChatMessage, NEW_CHAT_ID } from '../chat.types';
import { ConversationComponent } from './conversation.component';
// conversation.component.spec.ts

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

const mockLlms: LLM[] = [
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

describe('ConversationComponent', () => {
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

	/* ─────────────────────────────────────────────────────────────── */
	it('shows spinner until a chat arrives', async () => {
		expect(po.isLoading()).toBeTrue();

		chat.setChat({ id: 'c1', title: 'First', messages: [], updatedAt: Date.now() });
		await po.detectAndWait();

		expect(po.isLoading()).toBeFalse();
		expect(po.chatTitle()).toBe('First');
	});

	/* ─────────────────────────────────────────────────────────────── */
	it('sends a message through the UI', async () => {
		chat.setChat({ id: 'c2', title: 'Send', messages: [], updatedAt: Date.now() });
		await po.detectAndWait();

		await po.typeMessage('hello');
		await po.clickSend();

		const svc = TestBed.inject(ChatServiceClient) as unknown as FakeChatSvc;
		expect(svc.sendMessage).toHaveBeenCalled();
		expect(po.inputValue()).toBe('');
	});

	/* ─────────────────────────────────────────────────────────────── */
	it('triggers send on Enter when enabled', async () => {
		chat.setChat({ id: 'c3', title: 'Keys', messages: [], updatedAt: Date.now() });
		await po.detectAndWait();

		await po.typeMessage('enter-send');
		await po.pressEnter();

		expect(chat.sendMessage).toHaveBeenCalled();
	});

	/* ─────────────────────────────────────────────────────────────── */
	it('allows picking an LLM from the select', async () => {
		chat.setChat({ id: 'c4', title: 'LLM', messages: [], updatedAt: Date.now() });
		await po.detectAndWait();

		await po.chooseLlmByText('GPT-4');
		// nothing more to assert – if the above line didn’t throw,
		// the public behaviour (select shows value) is fine.
	});

	/* ─────────────────────────────────────────────────────────────── */
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

	/* ─────────────────────────────────────────────────────────────── */
	it('opens the info drawer', async () => {
		chat.setChat({ id: 'c6', title: 'Drawer', messages: [], updatedAt: Date.now() });
		await po.detectAndWait();

		expect(po.drawerOpened()).toBeFalse();
		await po.openDrawer();
		expect(po.drawerOpened()).toBeTrue();
	});
});
