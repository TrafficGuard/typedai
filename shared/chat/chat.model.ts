import type { LlmMessage } from '#shared/llm/llm.model';

//#region == Database models ====

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

//#endregion

//#region == Derived models ====

//#region == ChatPreview ====

export const CHAT_PREVIEW_KEYS = ['id', 'userId', 'shareable', 'title', 'updatedAt', 'parentId', 'rootId'] as const satisfies readonly (keyof Chat)[];

export type ChatPreview = Pick<Chat, (typeof CHAT_PREVIEW_KEYS)[number]>;

//#endregion ChatPreview
//#endregion Derived models

//#region == API models ====

export interface ChatList {
	chats: ChatPreview[];
	hasMore: boolean;
}

//#endregion API models
