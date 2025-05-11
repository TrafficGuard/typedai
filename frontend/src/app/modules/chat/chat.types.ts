import {Chat as ChatModel} from "#shared/model/chat.model";
import {GenerationStats} from "#shared/model/llm.model";

export const NEW_CHAT_ID = 'new';

// Server API types -------------

export type ServerChat = ChatModel

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
    updatedAt: number;
    messages?: ChatMessage[];
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
    /** The actual file data */
    data: File;
    /** Mime type of the file. */
    mimeType: string;
    /** Optional preview URL for thumbnails etc */
    previewUrl?: string;
}
