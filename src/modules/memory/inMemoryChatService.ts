import { randomUUID } from 'node:crypto';
import type { ChatService } from '#chat/chatService';
import { logger } from '#o11y/logger';
import { span } from '#o11y/trace';
import type { Chat, ChatList, ChatPreview } from '#shared/chat/chat.model';
import { InvalidRequest, NotFound, Unauthorized } from '#shared/errors';
import type { LlmMessage } from '#shared/llm/llm.model';
import { currentUser } from '#user/userContext';

/**
 * In-memory implementation of ChatService
 * Used for testing and local development
 */
export class InMemoryChatService implements ChatService {
	private chats: Map<string, Chat> = new Map();

	/**
	 * Load a chat by its ID
	 * @param chatId The ID of the chat to load
	 * @returns The chat object
	 */
	@span()
	async loadChat(chatId: string): Promise<Chat> {
		const currentUserId = currentUser().id;
		const chat = this.chats.get(chatId);
		if (!chat) {
			logger.warn(`Chat with id ${chatId} not found`);
			throw new NotFound(`Chat with id ${chatId} not found`);
		}

		if (!chat.shareable && chat.userId !== currentUserId) {
			throw new Unauthorized('Chat not visible.');
		}

		return structuredClone(chat);
	}

	/**
	 * Save a chat to the in-memory store
	 * @param chat The chat to save
	 * @returns The saved chat
	 */
	@span()
	async saveChat(chat: Chat): Promise<Chat> {
		const currentUserId = currentUser().id;

		// ---- basic validation --------------------------------
		if (!chat.title) {
			throw new InvalidRequest('chat title is required');
		}
		if (!chat.id) chat.id = randomUUID();

		const existing = this.chats.get(chat.id);

		/* ------------------- UPDATE -------------------------- */
		if (existing) {
			if (existing.userId !== currentUserId) {
				throw new Unauthorized('Not authorized to modify this chat');
			}
			chat.userId = existing.userId; // preserve owner
			chat.updatedAt = Date.now();
		} else {
			/* ------------------- INSERT -------------------------- */
			chat.userId = chat.userId ?? currentUserId;
			chat.updatedAt = chat.updatedAt ?? Date.now();
		}

		this.chats.set(chat.id, structuredClone(chat));
		return { ...chat };
	}

	/**
	 * List chats with pagination support
	 * @param startAfterId Optional ID to start listing after (for pagination)
	 * @param limit Maximum number of chats to return
	 * @returns Object containing chat previews and hasMore flag
	 */
	async listChats(startAfterId?: string, limit = 100): Promise<ChatList> {
		const currentUserId = currentUser().id;

		// Get all chats for the current user
		const userChats = Array.from(this.chats.values())
			.filter((chat) => chat.userId === currentUserId)
			.sort((a, b) => b.updatedAt - a.updatedAt); // Sort by updatedAt desc

		// Find the starting index if startAfterId is provided
		let startIndex = 0;
		if (startAfterId) {
			const startAfterIndex = userChats.findIndex((chat) => chat.id === startAfterId);
			if (startAfterIndex !== -1) {
				startIndex = startAfterIndex + 1;
			}
		}

		// Get the slice of chats based on startIndex and limit
		const chatSlice = userChats.slice(startIndex, startIndex + limit + 1);
		const hasMore = chatSlice.length > limit;

		// Convert to chat previews and respect the limit
		const chats: ChatPreview[] = chatSlice.slice(0, limit).map((chat) => structuredClone({ ...chat, messages: undefined }));

		return { chats, hasMore };
	}

	/**
	 * Delete a chat by its ID
	 * @param chatId The ID of the chat to delete
	 */
	@span()
	async deleteChat(chatId: string): Promise<void> {
		const currentUserId = currentUser().id;
		const chat = this.chats.get(chatId);

		if (!chat) {
			logger.warn(`Chat with id ${chatId} not found`);
			throw new NotFound(`Chat with id ${chatId} not found`);
		}

		if (chat.userId !== currentUserId) {
			logger.warn(`User ${currentUserId} is not authorized to delete chat ${chatId}`);
			throw new Unauthorized('Not authorized to delete this chat');
		}

		this.chats.delete(chatId);
		logger.info(`Chat ${chatId} deleted successfully`);
	}

	/**
	 * Clear all chats from memory
	 * Useful for testing
	 */
	clear(): void {
		this.chats.clear();
	}
}
