import type { UserContentExt } from '#shared/llm/llm.model';
import type { UIMessage } from '../message.types';

export const NEW_CHAT_ID = 'new';

// UI types -------------

/** Chat UI data type  */
export interface Chat {
	id: string;
	title: string;
	userId?: string;
	shareable?: boolean;
	unreadCount?: number;
	lastMessage?: string;
	lastMessageAt?: string;
	updatedAt: number; // Ensure this is consistently a number (timestamp)
	messages?: ChatMessage[];
	parentId?: string;
	rootId?: string;
}

/** Chat UI message */
export interface ChatMessage extends Omit<UIMessage, 'content'> {
	// textContent from UIMessage is inherited.
	// UIMessage.content (TextContent[]) is omitted.
	// ChatMessage defines its own 'content' of type UserContentExt.
	content: UserContentExt; // New primary content field, superseding UIMessage.content
	isMine?: boolean;
	generating?: boolean;
}
