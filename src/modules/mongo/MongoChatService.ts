import type { Db } from 'mongodb';
import { type Collection, ObjectId } from 'mongodb';
import type { ChatService } from '#chat/chatService';
import type { Chat, ChatList, ChatPreview } from '#shared/chat/chat.model';
import { CHAT_PREVIEW_KEYS } from '#shared/chat/chat.model';
import { currentUser } from '#user/userContext';

const CHATS_COLLECTION = 'chats';

export class MongoChatService implements ChatService {
	private readonly chatsCollection: Collection<any>;

	constructor(private db: Db) {
		this.chatsCollection = this.db.collection<any>(CHATS_COLLECTION);
	}

	async listChats(startAfterId?: string, limit = 100): Promise<ChatList> {
		try {
			// a. Get the current user's ID
			const user = currentUser();
			if (!user || !user.id) {
				throw new Error('User not authenticated or user ID is missing.');
			}
			const userId = user.id;

			// b. Set the actual limit for the MongoDB query (fetch one extra to check for 'hasMore')
			const actualLimit = limit + 1;

			// c. Initialize the query filter object
			const queryFilter: any = { userId }; // MongoDB query filter

			// d. Define the projection dynamically based on CHAT_PREVIEW_KEYS
			const projection = CHAT_PREVIEW_KEYS.reduce(
				(acc, key) => {
					if (key === 'id') {
						acc._id = 1; // Map 'id' from ChatPreview to '_id' in MongoDB
					} else {
						acc[key as string] = 1; // Use other keys directly
					}
					return acc;
				},
				{} as Record<string, 1>,
			);

			// e. Define sort options for pagination (newest first, with _id as a tie-breaker)
			const sortOptions: any = { updatedAt: -1, _id: -1 }; // MongoDB sort options

			// f. Handle Pagination (if startAfterId is provided)
			if (startAfterId) {
				let startDocObjectId: ObjectId | undefined;
				try {
					startDocObjectId = new ObjectId(startAfterId);
				} catch (e) {
					console.warn(`Invalid startAfterId format: ${startAfterId}. Proceeding without this pagination filter component.`);
				}

				if (startDocObjectId) {
					const startDocument = await this.chatsCollection.findOne(
						{ _id: startDocObjectId, userId }, // Ensure the start document belongs to the current user
						{ projection: { updatedAt: 1, _id: 1 } }, // Only fetch fields needed for pagination logic
					);

					if (startDocument) {
						// Keyset pagination: fetch documents "older" than the startDocument
						// (older means lower updatedAt, or same updatedAt but lower _id)
						queryFilter.$or = [{ updatedAt: { $lt: startDocument.updatedAt } }, { updatedAt: startDocument.updatedAt, _id: { $lt: startDocument._id } }];
					} else {
						console.warn(`Chat document with _id ${startAfterId} (for pagination) not found for user ${userId}. Listing from beginning or check ID.`);
					}
				}
			}

			// g. Execute the MongoDB query
			const mongoDocs = await this.chatsCollection.find(queryFilter).sort(sortOptions).project(projection).limit(actualLimit).toArray();

			// h. Determine if there are more chats beyond the current page
			const hasMore = mongoDocs.length === actualLimit;

			// i. Get the chats for the current page (remove the extra one if it was fetched)
			const relevantDocs = hasMore ? mongoDocs.slice(0, limit) : mongoDocs;

			// j. Map MongoDB documents to ChatPreview objects
			const chats: ChatPreview[] = relevantDocs.map((doc) => {
				let updatedAtAsNumber: number;

				if (typeof doc.updatedAt === 'number') {
					updatedAtAsNumber = doc.updatedAt;
				} else if (doc.updatedAt instanceof Date) {
					updatedAtAsNumber = doc.updatedAt.getTime();
				} else {
					const parsedTimestamp = typeof doc.updatedAt === 'string' || typeof doc.updatedAt === 'number' ? Number(doc.updatedAt) : Number.NaN;
					if (!Number.isNaN(parsedTimestamp)) {
						updatedAtAsNumber = parsedTimestamp;
					} else {
						console.warn(`Document ${doc._id?.toString()} has missing, unparseable, or invalid updatedAt field (value: ${doc.updatedAt}). Defaulting to 0.`);
						updatedAtAsNumber = 0;
					}
				}

				const chatPreview: ChatPreview = {
					id: doc._id.toString(), // Convert ObjectId to string
					userId: doc.userId,
					title: doc.title,
					updatedAt: updatedAtAsNumber,
					shareable: doc.shareable,
					parentId: doc.parentId,
					rootId: doc.rootId,
				};
				return chatPreview;
			});

			// k. Return the ChatList object
			return { chats, hasMore };
		} catch (error) {
			console.error('Error in listChats:', error);
			throw error;
		}
	}

	async loadChat(chatId: string): Promise<Chat> {
		try {
			// a. Input Validation
			if (!chatId) {
				throw new Error('Chat ID must be provided.');
			}

			// b. Convert chatId to ObjectId
			let objectId: ObjectId;
			try {
				objectId = new ObjectId(chatId);
			} catch (e) {
				// console.error(`Invalid chatId format: ${chatId}`, e); // Optional detailed logging
				throw new Error(`Invalid Chat ID format: ${chatId}`);
			}

			// c. Fetch Document
			const doc = await this.chatsCollection.findOne({ _id: objectId });

			// d. Handle Not Found
			if (!doc) {
				// console.warn(`Chat with id ${chatId} not found`); // Optional logging
				throw new Error(`Chat with id ${chatId} not found`);
			}

			// e. Map to Chat object (including updatedAt processing)
			const user = currentUser();

			let updatedAtAsNumber: number;
			if (typeof doc.updatedAt === 'number') {
				updatedAtAsNumber = doc.updatedAt;
			} else if (doc.updatedAt instanceof Date) {
				updatedAtAsNumber = doc.updatedAt.getTime();
			} else {
				// Defaulting to 0 if unparseable or missing, with a warning.
				// Consider if throwing an error or using a different default is more appropriate
				// if updatedAt is strictly required and must be valid.
				console.warn(
					`Document ${doc._id?.toString()} (chatId: ${chatId}) has missing, unparseable, or invalid updatedAt field (value: ${doc.updatedAt}). Defaulting to 0.`,
				);
				updatedAtAsNumber = 0;
			}

			const chat: Chat = {
				id: doc._id.toString(),
				userId: doc.userId,
				title: doc.title,
				updatedAt: updatedAtAsNumber,
				shareable: doc.shareable,
				parentId: doc.parentId,
				rootId: doc.rootId,
				messages: doc.messages ?? [], // Ensure messages is an array, default to empty if null/undefined
			};

			// Authorization Check
			if (!chat.shareable && (!user || chat.userId !== user.id)) {
				// console.warn(`User ${user?.id} attempted to access unauthorized chat ${chatId}`); // Optional logging
				throw new Error('Chat not visible or user not authorized.');
			}

			// f. Message Handling
			// TODO: Implement message hydration here if messages or their parts are stored externally (e.g., GCS, agentfs).
			// This would involve checking message parts for references (e.g., a special URI scheme)
			// and fetching the actual content from the external store, then replacing the reference.

			// Backwards compatibility for old message format (text vs content)
			if (chat.messages) {
				for (const message of chat.messages) {
					const oldMessage = message as any;
					// Ensure content doesn't already exist before populating from old 'text' field
					if (oldMessage.text && message.content === undefined) {
						message.content = oldMessage.text;
						// delete oldMessage.text; // Optional: clean up the old field if desired after migration
					}
				}
			}

			// g. Return chat
			return chat;
		} catch (error) {
			console.error(`Error loading chat ${chatId}:`, error);
			throw error;
		}
	}

	async saveChat(chat: Chat): Promise<Chat> {
		// TODO: Implement method
		throw new Error('Method not implemented.');
	}

	async deleteChat(chatId: string): Promise<void> {
		// TODO: Implement method
		throw new Error('Method not implemented.');
	}
}
