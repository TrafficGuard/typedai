import {Chat as ChatModel} from "#shared/model/chat.model";
import {GenerationStats} from "#shared/model/llm.model";

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

export interface TextContent {
    type: string,
    text: string
}

/** Chat UI message */
export interface ChatMessage {
    id?: string;
    isMine?: boolean;
    llmId?: string;
    createdAt?: string;
    generating?: boolean;
    content?: TextContent[];
    textContent: string;
    /** File attachments to be sent with the next message */
    fileAttachments?: Attachment[];
    /** Image attachments to be sent with the next message */
    imageAttachments?: Attachment[]
    stats?: GenerationStats;
}

export interface Attachment {
    type: 'file' | 'image';
    filename: string;
    /** File size in bytes */
    size: number;
    /** The actual file data (only present for attachments being sent) */
    data: File | null;
    /** Mime type of the file. */
    mimeType: string;
    /** Optional preview URL for thumbnails etc (for received attachments) */
    previewUrl?: string;
}
