import type {LlmMessage} from '#shared/model/llm.model';

export interface Chat {
	id: string;
	userId: string;
	shareable: boolean;
	title: string;
	updatedAt: number;
	/** When a chat is branched from the original thread by deleting/updating messages etc */
	parentId?: string;
	/** The original parent */
	rootId?: string;
	messages: LlmMessage[];
}

export type ChatPreview = Omit<Chat, 'messages'>;

export const CHAT_PREVIEW_KEYS: Array<keyof ChatPreview> = ['id', 'userId', 'shareable', 'title', 'updatedAt', 'parentId', 'rootId'];

export interface ChatList {
	chats: ChatPreview[];
	hasMore: boolean;
}

export interface ChatMessage {
	role: 'user' | 'assistant' | 'system' | 'tool';
	content: string;
	// TODO: Consider more complex content types like LlmContent or allow structured content
	// name?: string; // Optional: for 'tool' role, the name of the tool
	// tool_call_id?: string; // Optional: for 'tool' role, the ID of the tool call
	// tool_calls?: any[]; // Optional: for 'assistant' role, if it made tool calls
}

export interface Chat {
	id: string;
	userId: string;
	title: string;
	updatedAt: number; // Unix timestamp in milliseconds
	shareable: boolean;
	parentId?: string;
	rootId?: string;
	messages: ChatMessage[];
	// createdAt?: number; // Consider adding if consistently used/needed
}

export type ChatPreview = Omit<Chat, 'messages'>;

export interface ChatList {
	chats: ChatPreview[];
	hasMore: boolean;
}

/**
 * Array of keys that constitute a ChatPreview.
 * Used by Firestore to select only necessary fields for list operations.
 */
export const CHAT_PREVIEW_KEYS: Array<keyof ChatPreview> = [
	'id',
	'userId',
	'title',
	'updatedAt',
	'shareable',
	'parentId',
	'rootId',
];
