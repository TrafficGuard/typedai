import type { Chat, ChatList } from '#shared/model/chat.model';

/**
 * The service only handles tne persistence of the Chat objects.
 */
export interface ChatService {
	listChats(startAfter?: string, limit?: number): Promise<ChatList>;

	loadChat(chatId: string): Promise<Chat>;

	saveChat(chat: Chat): Promise<Chat>;

	deleteChat(chatId: string): Promise<void>;
}
