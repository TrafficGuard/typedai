import {Chat as ChatModel} from "#shared/model/chat.model";
// Removed: export type { Attachment, TextContent } from '../message.types';
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
export interface ChatMessage extends UIMessage {
    isMine?: boolean;
    generating?: boolean;
}
