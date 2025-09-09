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
				throw new Error(`Chat with id ${chatId} not found`);
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
				throw new Error('Chat not visible.');
			}
			return chat;
		} catch (error) {
			logger.error(error, `Error loading chat ${chatId}`);
			throw error;
		}
	}

	@span()
	async saveChat(chat: Chat): Promise<Chat> {
		if (!chat.title) throw new Error('chat title is required');
		if (!chat.userId) chat.userId = randomUUID();
		if (chat.userId !== currentUser().id) throw new Error(`chat userId ${chat.userId} is invalid. Should be ${currentUser().id}`);

		if (!chat.id) chat.id = randomUUID();
		if (chat.updatedAt === undefined) {
			chat.updatedAt = Date.now(); // generate only if absent
		}

		try {
			const docRef = this.db.doc(`Chats/${chat.id}`);

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
				throw new Error(`Chat with id ${chatId} not found`);
			}

			const chatData = docSnap.data()!;
			if (chatData.userId !== userId) {
				logger.warn(`User ${userId} is not authorized to delete chat ${chatId}`);
				throw new Error('Not authorized to delete this chat');
			}

			await docRef.delete();
			logger.info(`Chat ${chatId} deleted successfully`);
		} catch (error) {
			logger.error(error, `Error deleting chat ${chatId}`);
			throw error;
		}
	}
}
