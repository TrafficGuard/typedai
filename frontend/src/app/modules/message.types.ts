import type { GenerationStats } from '#shared/llm/llm.model';

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
