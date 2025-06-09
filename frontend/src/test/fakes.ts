// tests/fakes.ts
import { signal } from '@angular/core';
import { Chat, NEW_CHAT_ID } from 'app/modules/chat/chat.types';
import { of } from 'rxjs';

export class FakeChatSvc {
	private _chat = signal<Chat | null>(null);
	chat = this._chat.asReadonly();
	chats = signal<Chat[] | null>(null).asReadonly();

	setChat(c: Chat) {
		this._chat.set(c);
	}

	/* public API stubs – return observables so component thinks it’s real */
	sendMessage = jasmine.createSpy().and.returnValue(of(void 0));
	createChat = jasmine.createSpy().and.callFake(() => of({ id: 'c99', title: '', messages: [], updatedAt: Date.now() }));
	loadChatById = jasmine.createSpy().and.returnValue(of(void 0));
	loadChats = jasmine.createSpy().and.returnValue(of([]));
	resetChat = jasmine.createSpy().and.callFake(() => this._chat.set(null));
}

export class FakeUserSvc {
	userProfile = signal<any>({ id: 'u1', chat: { defaultLLM: 'llm-1' } }).asReadonly();
	loadUser() {}
}

export class FakeLlmSvc {
	llmsState = signal({ status: 'success', data: [{ id: 'llm-1', name: 'GPT-4' }] });
	loadLlms() {}
}
