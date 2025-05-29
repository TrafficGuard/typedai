import { randomUUID } from 'node:crypto';
import type { ExpressionBuilder, Insertable, Kysely, Selectable, Updateable } from 'kysely';
import type { ChatService } from '#chat/chatService';
import { logger } from '#o11y/logger';
import { span } from '#o11y/trace';
import { CHAT_PREVIEW_KEYS, type Chat, type ChatList, type ChatPreview } from '#shared/chat/chat.model';
import type { LlmMessage } from '#shared/llm/llm.model';
import { currentUser } from '#user/userContext';
import { type ChatsTable, type Database, db } from './db';

export class PostgresChatService implements ChatService {
	private mapDbRowToChat(row: Selectable<ChatsTable>): Chat {
		return {
			id: row.id,
			userId: row.user_id,
			title: row.title,
			updatedAt: new Date(row.updated_at).getTime(), // Ensure conversion from DB Date to number
			shareable: row.shareable,
			parentId: row.parent_id ?? undefined,
			rootId: row.root_id ?? undefined,
			messages: row.messages_serialized ? (JSON.parse(row.messages_serialized) as LlmMessage[]) : [],
		};
	}

	private mapChatToDbInsert(chat: Chat): Insertable<ChatsTable> {
		const now = new Date();
		return {
			id: chat.id,
			user_id: chat.userId,
			title: chat.title,
			updated_at: now,
			created_at: now,
			shareable: chat.shareable,
			parent_id: chat.parentId ?? null,
			root_id: chat.rootId ?? null,
			messages_serialized: JSON.stringify(chat.messages),
		};
	}

	// Ensure this only includes fields that can be updated and are part of ChatsTable
	private mapChatToDbUpdate(chat: Partial<Chat>): Omit<Updateable<ChatsTable>, 'id' | 'user_id' | 'created_at'> {
		const updateData: Partial<Omit<Updateable<ChatsTable>, 'id' | 'user_id' | 'created_at'>> & { updated_at: Date } = {
			updated_at: new Date(), // Always update updated_at
		};
		if (chat.title !== undefined) updateData.title = chat.title;
		if (chat.shareable !== undefined) updateData.shareable = chat.shareable;
		if (chat.parentId !== undefined) updateData.parent_id = chat.parentId ?? null;
		if (chat.rootId !== undefined) updateData.root_id = chat.rootId ?? null;
		if (chat.messages !== undefined) updateData.messages_serialized = JSON.stringify(chat.messages);
		return updateData;
	}

	@span()
	async loadChat(chatId: string): Promise<Chat> {
		const row = await db.selectFrom('chats').selectAll().where('id', '=', chatId).executeTakeFirst();

		if (!row) {
			logger.warn(`Chat with id ${chatId} not found`);
			throw new Error(`Chat with id ${chatId} not found`);
		}
		const chat = this.mapDbRowToChat(row);
		if (!chat.shareable && chat.userId !== currentUser().id) {
			throw new Error('Chat not visible.');
		}
		return chat;
	}

	@span()
	async saveChat(chat: Chat): Promise<Chat> {
		if (!chat.title) throw new Error('chat title is required');

		chat.userId = chat.userId || currentUser().id;
		if (chat.userId !== currentUser().id) {
			throw new Error('chat userId is invalid or does not match current user');
		}

		const isUpdate = !!chat.id;
		chat.id = chat.id || randomUUID();

		try {
			if (isUpdate) {
				const updateData = this.mapChatToDbUpdate(chat);
				const updatedRow = await db
					.updateTable('chats')
					.set(updateData)
					.where('id', '=', chat.id)
					.where('user_id', '=', chat.userId)
					.returningAll()
					.executeTakeFirst();
				if (!updatedRow) {
					const existingChat = await db.selectFrom('chats').select('id').where('id', '=', chat.id).executeTakeFirst();
					if (existingChat) throw new Error('Failed to update chat, possibly due to ownership or concurrent modification.');
					throw new Error(`Chat with id ${chat.id} not found for update.`);
				}
				return this.mapDbRowToChat(updatedRow);
			}
			const insertData = this.mapChatToDbInsert(chat);
			const insertedRow = await db.insertInto('chats').values(insertData).returningAll().executeTakeFirstOrThrow();
			return this.mapDbRowToChat(insertedRow);
		} catch (error) {
			logger.error(error, `Error saving chat ${chat.id}`);
			throw error;
		}
	}

	@span()
	async listChats(startAfterId?: string, limit = 100): Promise<ChatList> {
		const userId = currentUser().id;

		const selection = ['id', 'user_id as userId', 'title', 'updated_at as updatedAt', 'shareable', 'parent_id as parentId', 'root_id as rootId'];

		let query = db
			.selectFrom('chats')
			.select(selection as any[])
			.where('user_id', '=', userId)
			.orderBy('updated_at', 'desc')
			.orderBy('id', 'desc');

		if (startAfterId) {
			const cursorDoc = await db
				.selectFrom('chats')
				.select(['updated_at', 'id'])
				.where('id', '=', startAfterId)
				.where('user_id', '=', userId)
				.executeTakeFirst();

			if (cursorDoc) {
				query = query.where((eb: ExpressionBuilder<Database, 'chats'>) =>
					eb.or([eb('updated_at', '<', cursorDoc.updated_at), eb.and([eb('updated_at', '=', cursorDoc.updated_at), eb('id', '<', cursorDoc.id)])]),
				);
			}
		}

		const rows = await query.limit(limit + 1).execute();

		const chats: ChatPreview[] = rows.slice(0, limit).map((row) => ({
			id: row.id,
			userId: row.userId,
			title: row.title,
			updatedAt: new Date(row.updatedAt).getTime(),
			shareable: row.shareable,
			parentId: row.parentId ?? undefined,
			rootId: row.rootId ?? undefined,
		}));
		const hasMore = rows.length > limit;
		return { chats, hasMore };
	}

	@span()
	async deleteChat(chatId: string): Promise<void> {
		const userId = currentUser().id;
		const chatOwnerCheck = await db.selectFrom('chats').select('id').where('id', '=', chatId).where('user_id', '=', userId).executeTakeFirst();

		if (!chatOwnerCheck) {
			const existsAnyUser = await db.selectFrom('chats').select('id').where('id', '=', chatId).executeTakeFirst();
			if (!existsAnyUser) {
				logger.warn(`Chat with id ${chatId} not found for deletion.`);
				throw new Error(`Chat with id ${chatId} not found`);
			}
			logger.warn(`User ${userId} is not authorized to delete chat ${chatId}`);
			throw new Error('Not authorized to delete this chat');
		}

		const result = await db.deleteFrom('chats').where('id', '=', chatId).where('user_id', '=', userId).executeTakeFirst();

		if (Number(result.numDeletedRows) === 0) {
			logger.warn(`Chat with id ${chatId} was not deleted, though ownership check passed. It might have been deleted concurrently.`);
		} else {
			logger.info(`Chat ${chatId} deleted successfully.`);
		}
	}
}
