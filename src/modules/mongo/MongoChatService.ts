import type { ChatService } from '#chat/chatService';

import type { ChatService } from '#chat/chatService';
import type { Chat, ChatList } from '#shared/chat/chat.model';

export class MongoChatService implements ChatService {
	constructor() {
		// TODO: Implement constructor
	}

	async listChats(startAfter?: string, limit?: number): Promise<ChatList> {
		// TODO: Implement method
		throw new Error('Method not implemented.');
	}

	async loadChat(chatId: string): Promise<Chat> {
		// TODO: Implement method
		throw new Error('Method not implemented.');
	}

	async saveChat(chat: Chat): Promise<Chat> {
		// TODO: Implement method
		throw new Error('Method not implemented.');
	}

	async deleteChat(chatId: string): Promise<void> {
		// TODO: Implement method
		throw new Error('Method not implemented.');
	}
}
