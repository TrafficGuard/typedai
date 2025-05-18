import type { GenerationStats } from '#shared/model/llm.model';

export interface Attachment {
    type: 'file' | 'image';
    filename: string;
    size: number;
    data: File | null;
    mimeType: string;
    previewUrl?: string;
}

export interface TextContent {
    type: string;
    text: string;
}

export interface UIMessage {
    id?: string;
    llmId?: string;
    createdAt?: string;
    content?: TextContent[];
    textContent: string;
    fileAttachments?: Attachment[];
    imageAttachments?: Attachment[];
    stats?: GenerationStats;
    textChunks?: Array<{type: 'text' | 'markdown', value: string}>;
}
import type { GenerationStats } from '#shared/model/llm.model';

/**
 * Represents a file or image attachment in the UI.
 */
export interface Attachment {
    type: 'file' | 'image';
    filename: string;
    size: number;
    data: File | null; // For files being sent by the user (client-side File object)
    mimeType: string;
    previewUrl?: string; // For local previews (e.g., ObjectURL) or received attachment URLs
}

/**
 * Represents a part of a message's content, typically text.
 */
export interface TextContent {
    type: string; // e.g., 'text', 'markdown', 'reasoning'
    text: string;
}

/**
 * Base UI Message interface.
 */
export interface UIMessage {
    id?: string; // Optional: Unique identifier for the message
    llmId?: string; // Identifier of the LLM that generated the message (if applicable)
    createdAt?: string; // ISO string representation of the creation timestamp
    content?: TextContent[]; // Structured content parts (e.g., for mixed text/code messages)
    textContent: string;     // Plain text representation or primary text content of the message
    fileAttachments?: Attachment[]; // Array of file attachments associated with the message
    imageAttachments?: Attachment[]; // Array of image attachments associated with the message
    stats?: GenerationStats; // Statistics related to the message generation (if applicable)
    // For rich text display, separating code blocks from plain text or other formatted segments
    textChunks?: Array<{type: 'text' | 'markdown', value: string}>;
}
