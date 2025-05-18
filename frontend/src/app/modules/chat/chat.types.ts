import {Chat as ChatModel} from "#shared/model/chat.model";
import type { Attachment, UIMessage, TextContent } from '../message.types';

export const NEW_CHAT_ID = 'new';

// Server API types -------------

// ServerChat is effectively ApiChatModel from shared/schemas/chat.schema.ts now

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
    parentId?: string; // <-- Add this line
    rootId?: string;   // <-- Add this line
}

/** Chat UI message */
export interface ChatMessage extends UIMessage {
    isMine?: boolean;
    generating?: boolean;
    // All other properties are inherited from UIMessage
}
