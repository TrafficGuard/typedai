import type {LlmMessage} from '#shared/model/llm.model';

export interface Chat {
	id: string;
	userId: string;
	shareable: boolean;
	title: string;
	updatedAt: number;
	/** When a chat is branched from the original thread by deleting/updating messages etc */
	parentId?: string;
	/** The original parent */
	rootId?: string;
	messages: LlmMessage[];
}

export type ChatPreview = Omit<Chat, 'messages'>;

export const CHAT_PREVIEW_KEYS: Array<keyof ChatPreview> = ['id', 'userId', 'shareable', 'title', 'updatedAt', 'parentId', 'rootId'];

export interface ChatList {
	chats: ChatPreview[];
	hasMore: boolean;
}

