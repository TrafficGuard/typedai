import type { LlmMessage } from '#llm/llm';

export interface Chat {
	id: string;
	userId: string;
	shareable: boolean;
	title: string;
	updatedAt: number;
	/** When a chat is branched from the original thread by deleting/updating messages etc */
	parentId: undefined | string;
	/** The original parent */
	rootId: undefined | string;
	messages: LlmMessage[];
}

export type ChatPreview = Omit<Chat, 'messages'>;

export const CHAT_PREVIEW_KEYS: Array<keyof ChatPreview> = ['id', 'userId', 'shareable', 'title', 'updatedAt', 'parentId', 'rootId'];

export interface ChatList {
	chats: ChatPreview[];
	hasMore: boolean;
}

/**
 * The service only handle persistence of the Chat objects.
 */
export interface ChatService {
	listChats(startAfter?: string, limit?: number): Promise<ChatList>;
	loadChat(chatId: string): Promise<Chat>;
	saveChat(chat: Chat): Promise<Chat>;
	deleteChat(chatId: string): Promise<void>;
}
