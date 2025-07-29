import { GenerationStats } from '#shared/llm/llm.model';
import { LanguageModelV1Source } from '@ai-sdk/provider';

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
	reasoning?: string;
	fileAttachments?: Attachment[];
	imageAttachments?: Attachment[];
	stats?: GenerationStats;
	textChunks?: Array<{ type: 'text' | 'markdown'; value: string }>;
	sources?: LanguageModelV1Source[];
}
