import { randomUUID } from 'node:crypto';
import type { Firestore } from '@google-cloud/firestore';
import type { ChatService } from '#chat/chatService';
import { logger } from '#o11y/logger';
import { span } from '#o11y/trace';
import { CHAT_PREVIEW_KEYS, type Chat, type ChatPreview } from '#shared/chat/chat.model';
import { currentUser } from '#user/userContext';
import { firestoreDb } from './firestore';

/**
 * Google Firestore implementation of ChatService
 */
export class FirestoreChatService implements ChatService {
	private db: Firestore;

	constructor() {
		this.db = firestoreDb();
	}

	@span()
	async loadChat(chatId: string): Promise<Chat> {
		try {
			const docRef = this.db.doc(`Chats/${chatId}`);
			const docSnap = await docRef.get();

			if (!docSnap.exists) {
				logger.warn(`Chat with id ${chatId} not found`);
				{
					const err = new Error(`Chat with id ${chatId} not found`);
					(err as any).code = 'NOT_FOUND';
					throw err;
				}
			}

			const data = docSnap.data()!;
			const chat: Chat = {
				id: chatId,
				userId: data.userId,
				title: data.title,
				updatedAt: data.updatedAt,
				shareable: data.shareable,
				parentId: data.parentId,
				rootId: data.rootId,
				messages: data.messages,
			};

			// Backwards compatability
			for (const message of chat.messages) {
				const oldMessage = message as any;
				if (oldMessage.text) message.content = oldMessage.text;
			}

			if (!chat.shareable && chat.userId !== currentUser().id) {
				{
					const err = new Error('Chat not visible.');
					(err as any).code = 'UNAUTHORIZED';
					throw err;
				}
			}
			return chat;
		} catch (error) {
			logger.error(error, `Error loading chat ${chatId}`);
			throw error;
		}
	}

	@span()
	async saveChat(chat: Chat): Promise<Chat> {
		const userId = currentUser().id;
		if (!chat.userId) {
			const err = new Error('chat.userId is required');
			(err as any).code = 'INVALID_REQUEST';
			throw err;
		}

		if (!chat.id) chat.id = randomUUID();
		if (chat.updatedAt === undefined) {
			chat.updatedAt = Date.now(); // generate only if absent
		}

		try {
			const docRef = this.db.doc(`Chats/${chat.id}`);
			const existingDoc = await docRef.get();

			// If updating an existing chat, enforce ownership using current user and prevent userId spoofing
			if (existingDoc.exists) {
				const existing = existingDoc.data()!;
				if (existing.userId !== userId) {
					{
						const err = new Error('Not authorized to modify this chat');
						(err as any).code = 'UNAUTHORIZED';
						throw err;
					}
				}
				// Preserve original owner on updates
				chat.userId = existing.userId;
			} else {
				// Enforce ownership on create
				if (chat.userId !== userId) {
					{
						const err = new Error('Not authorized to create this chat');
						(err as any).code = 'UNAUTHORIZED';
						throw err;
					}
				}
			}

			await docRef.set(chat, { merge: true });
			return chat;
		} catch (error) {
			logger.error(error, `Error saving chat ${chat.id}`);
			throw error;
		}
	}

	async listChats(startAfterId?: string, limit = 100): Promise<{ chats: ChatPreview[]; hasMore: boolean }> {
		try {
			const userId = currentUser().id;

			logger.info(`list ${limit} chats for ${userId} ${startAfterId ? `after ${startAfterId}` : ''}`);
			let query = this.db
				.collection('Chats')
				.select(...CHAT_PREVIEW_KEYS)
				.where('userId', '==', userId)
				.orderBy('updatedAt', 'desc')
				.limit(limit + 1);

			if (startAfterId) {
				const startAfterDoc = await this.db.collection('Chats').doc(startAfterId).get();
				if (startAfterDoc.exists) {
					query = query.startAfter(startAfterDoc);
				}
			}

			const querySnapshot = await query.get();

			const chats: ChatPreview[] = [];
			let hasMore = false;

			for (const doc of querySnapshot.docs) {
				if (chats.length < limit) {
					const data = doc.data();
					chats.push({
						id: doc.id,
						userId: data.userId,
						title: data.title,
						updatedAt: data.updatedAt,
						shareable: data.shareable,
						parentId: data.parentId,
						rootId: data.rootId,
					});
				} else {
					hasMore = true;
				}
			}
			chats.sort((a, b) => b.updatedAt - a.updatedAt || (b.id > a.id ? 1 : b.id < a.id ? -1 : 0));
			return { chats, hasMore };
		} catch (error) {
			logger.error(error, 'Error listing chats');
			throw error;
		}
	}

	@span()
	async deleteChat(chatId: string): Promise<void> {
		try {
			const userId = currentUser().id;
			const docRef = this.db.doc(`Chats/${chatId}`);
			const docSnap = await docRef.get();

			if (!docSnap.exists) {
				logger.warn(`Chat with id ${chatId} not found`);
				{
					const err = new Error(`Chat with id ${chatId} not found`);
					(err as any).code = 'NOT_FOUND';
					throw err;
				}
			}

			const chatData = docSnap.data()!;
			if (chatData.userId !== userId) {
				logger.warn(`User ${userId} is not authorized to delete chat ${chatId}`);
				{
					const err = new Error('Not authorized to delete this chat');
					(err as any).code = 'UNAUTHORIZED';
					throw err;
				}
			}

			await docRef.delete();
			logger.info(`Chat ${chatId} deleted successfully`);
		} catch (error) {
			logger.error(error, `Error deleting chat ${chatId}`);
			throw error;
		}
	}
}
