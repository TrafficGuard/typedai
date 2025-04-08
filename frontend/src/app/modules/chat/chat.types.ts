import {CoreMessage} from "./ai.types";

export const NEW_CHAT_ID = 'new';

/** Server API chat data type. Must match Chat interface in src/chat/chatTypes.ts */
export interface ServerChat {
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

/** Server API chat message data type. Must match GenerationStats in src/llm/llm.ts */
export interface GenerationStats {
    requestTime: number;
    timeToFirstToken: number;
    totalTime: number;
    inputTokens: number;
    outputTokens: number;
    cost: number;
    llmId: string;
}

/** Server API chat message data type. Must match LlmMessage in src/llm/llm.ts */
export type LlmMessage = CoreMessage & {
    /** Set the cache_control flag with Claude models */
    cache?: 'ephemeral';
    /** Stats on message generation (i.e when role=assistant) */
    stats?: GenerationStats;
};

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

export interface ChatMessage {
    id?: string;
    isMine?: boolean;
    llmId?: string;
    createdAt?: string;
    generating?: boolean;
    content?: TextContent[];
    textContent: string;
    /** Attachments to be sent with the next message */
    attachments?: Attachment[];
}

export interface Attachment {
    type: 'file' | 'image';
    /** File name */
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
