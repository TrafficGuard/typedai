import {Chat as ChatModel} from "#shared/model/chat.model";
export type { Attachment, TextContent } from '../message.types'; // Added export
import type { UIMessage } from '../message.types'; // UIMessage is used internally

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
