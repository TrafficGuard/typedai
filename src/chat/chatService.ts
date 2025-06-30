import type { Chat, ChatList } from '#shared/chat/chat.model';

/**
 * The service only handles the persistence of the Chat objects.
 */
export interface ChatService {
	listChats(startAfter?: string, limit?: number): Promise<ChatList>;

	loadChat(chatId: string): Promise<Chat>;

	saveChat(chat: Chat): Promise<Chat>;

	deleteChat(chatId: string): Promise<void>;
}
