import { Buffer } from 'node:buffer';
import { randomUUID } from 'node:crypto';
import type { Db } from 'mongodb';
import { type Collection, ObjectId } from 'mongodb';
import type { ChatService } from '#chat/chatService';
import type { Chat, ChatList, ChatPreview } from '#shared/chat/chat.model';
import { CHAT_PREVIEW_KEYS } from '#shared/chat/chat.model';
import type { FilePartExt, ImagePartExt, TextPartExt } from '#shared/llm/llm.model';
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
		try {
			// a. User Validation
			const user = currentUser();
			if (!user || !user.id) {
				throw new Error('User not authenticated or user ID is missing.');
			}
			// If chat.userId is provided, it must match the authenticated user.
			if (chat.userId && chat.userId !== user.id) {
				throw new Error('Chat userId does not match authenticated user. Cannot save chat for another user.');
			}
			// If chat.userId is not provided, assign the current user's ID.
			if (!chat.userId) {
				chat.userId = user.id;
			}

			// b. ID and Timestamps
			// Ensure consistency with ObjectId usage in listChats and loadChat.
			// chat.id (string) is the canonical ID in the Chat object.
			// mongoId (ObjectId) is used for MongoDB operations.
			let mongoId: ObjectId;
			// let isNewChat = false; // Variable not strictly needed for current logic but can be useful for logging

			if (!chat.id) {
				// This is a new chat
				mongoId = new ObjectId();
				chat.id = mongoId.toString();
				// isNewChat = true;
			} else {
				// This is an existing chat, chat.id should be a string representation of an ObjectId
				try {
					mongoId = new ObjectId(chat.id);
				} catch (e) {
					console.error(`Invalid chat.id format: "${chat.id}". It must be a 24-character hex string to be a valid ObjectId.`, e);
					throw new Error(`Invalid chat.id format: "${chat.id}". Cannot save chat with non-ObjectId compatible ID.`);
				}
			}
			chat.updatedAt = Date.now();

			// c. Message Externalization (Mock GCS Placeholder)
			// TODO: This section requires actual GCS integration.
			// The following is a MOCK implementation that replaces large parts with a placeholder URI.
			const MAX_PART_SIZE_BYTES = 1 * 1024 * 1024; // 1MB threshold for externalization (example value)

			if (chat.messages) {
				for (const message of chat.messages) {
					if (Array.isArray(message.content)) {
						for (let i = 0; i < message.content.length; i++) {
							const part = message.content[i] as TextPartExt | ImagePartExt | FilePartExt; // Cast for easier access
							let dataToSizeCheck: string | Uint8Array | Buffer | null = null;
							let originalDataField: 'text' | 'image' | 'data' | null = null;
							let isAlreadyExternalPlaceholder = false;

							if (part.type === 'text') {
								// Assuming part.text is string as per TextPartExt
								dataToSizeCheck = part.text;
								originalDataField = 'text';
								if (part.text.startsWith('gcs_placeholder://')) isAlreadyExternalPlaceholder = true;
							} else if (part.type === 'image') {
								// ImagePartExt.image is string (URL or base64). Requirement implies it could be Buffer/Uint8Array at this stage.
								const imagePart = part as ImagePartExt;
								if (typeof imagePart.image === 'string') {
									dataToSizeCheck = imagePart.image;
									if (imagePart.image.startsWith('gcs_placeholder://')) isAlreadyExternalPlaceholder = true;
								} else if ((imagePart.image as any) instanceof Uint8Array || Buffer.isBuffer(imagePart.image as any)) {
									dataToSizeCheck = imagePart.image;
								}
								originalDataField = 'image';
							} else if (part.type === 'file') {
								// FilePartExt.data is string (URL or base64). Requirement implies it could be Buffer/Uint8Array.
								const filePart = part as FilePartExt;
								if (typeof filePart.data === 'string') {
									dataToSizeCheck = filePart.data;
									if (filePart.data.startsWith('gcs_placeholder://')) isAlreadyExternalPlaceholder = true;
								} else if ((filePart.data as any) instanceof Uint8Array || Buffer.isBuffer(filePart.data as any)) {
									dataToSizeCheck = filePart.data;
								}
								originalDataField = 'data';
							}

							if (dataToSizeCheck && originalDataField && !isAlreadyExternalPlaceholder) {
								const partSize = typeof dataToSizeCheck === 'string' ? Buffer.byteLength(dataToSizeCheck, 'utf8') : dataToSizeCheck.byteLength;
								if (partSize > MAX_PART_SIZE_BYTES) {
									const placeholderAssetId = randomUUID();
									// LlmMessage doesn't have a persistent ID, generate one for the placeholder path
									const messageIdentifier = randomUUID();
									const placeholderUri = `gcs_placeholder://${chat.id}/${messageIdentifier}/${placeholderAssetId}`;

									// Update the part's data field with the placeholder URI.
									// This relies on originalDataField being a key of 'part'.
									(part as any)[originalDataField] = placeholderUri;

									console.warn(
										`MOCK EXTERNALIZATION: Message part (type: ${part.type}, field: ${originalDataField}) in chat ${chat.id} was marked for GCS. Placeholder: ${placeholderUri}. Size: ${partSize} bytes. Actual GCS upload needed.`,
									);
								}
							}
						}
					}
				}
			}

			// d. Prepare Document for MongoDB
			// The 'id' field in the chat object is the string representation.
			// For MongoDB, we use the 'mongoId' (ObjectId instance) as '_id'.
			const { id, ...chatProps } = chat; // Destructure to get properties other than 'id'
			const docToSave = {
				_id: mongoId, // Use the ObjectId instance for MongoDB's _id field
				...chatProps, // Spread the rest of the chat properties
			};

			// e. Save to MongoDB
			const result = await this.chatsCollection.updateOne(
				{ _id: docToSave._id }, // Filter by ObjectId
				{ $set: docToSave }, // Set all fields from docToSave
				{ upsert: true }, // Create if not exists, update if exists
			);

			if (result.upsertedId) {
				// MongoDB returns the _id in upsertedId if a new document was inserted.
				// It will be the same as docToSave._id (which is mongoId).
				console.log(`Chat ${chat.id} created successfully (upserted _id: ${result.upsertedId}).`);
			} else if (result.modifiedCount > 0) {
				console.log(`Chat ${chat.id} updated successfully.`);
			} else if (result.matchedCount > 0) {
				// Matched but not modified (e.g., submitted data was identical to stored data)
				console.log(`Chat ${chat.id} matched but no changes were made (content might be identical).`);
			} else {
				// This case (no match, no modification, no upsert) is unusual for an upsert with _id.
				// It might indicate an unexpected issue.
				console.warn(`Chat ${chat.id} save operation reported no match, modification, or upsert. Result: ${JSON.stringify(result)}`);
			}

			// f. Return `chat` (which includes the string ID and updated timestamp)
			return chat;
		} catch (error) {
			const chatIdForError = chat?.id ? chat.id : 'new chat';
			console.error(`Error saving chat ${chatIdForError}:`, error);
			throw error; // Re-throw the error to be handled by the caller
		}
	}

	async deleteChat(chatId: string): Promise<void> {
		try {
			// a. Input Validation
			if (!chatId) {
				throw new Error('Chat ID must be provided.');
			}

			// b. User and Chat Fetching
			const user = currentUser();
			if (!user || !user.id) {
				throw new Error('User not authenticated or user ID is missing.');
			}

			let objectIdToDelete: ObjectId;
			try {
				objectIdToDelete = new ObjectId(chatId);
			} catch (e) {
				// console.error(`Invalid chatId format for deletion: ${chatId}`, e); // Optional detailed logging as per requirement's comment
				throw new Error(`Invalid Chat ID format for deletion: ${chatId}`);
			}

			const chatDoc = await this.chatsCollection.findOne({ _id: objectIdToDelete });

			if (!chatDoc) {
				// console.warn(`Chat with ID ${chatId} (ObjectId: ${objectIdToDelete.toHexString()}) not found for deletion.`); // Optional logging as per requirement's comment
				throw new Error(`Chat with ID ${chatId} not found.`);
			}

			// c. Authorization
			if (chatDoc.userId !== user.id) {
				// console.warn(`User ${user.id} attempted to delete unauthorized chat ${chatId}`); // Optional logging as per requirement's comment
				throw new Error('User not authorized to delete this chat.');
			}

			// d. Mock GCS Cleanup Logging
			let hasExternalParts = false;
			if (chatDoc.messages && Array.isArray(chatDoc.messages)) {
				for (const message of chatDoc.messages) {
					if (Array.isArray(message.content)) {
						for (const part of message.content) {
							// Check text, image, and data fields for the placeholder
							let dataToCheck: string | Uint8Array | Buffer | null = null;
							if (part.type === 'text') {
								dataToCheck = part.text;
							} else if (part.type === 'image') {
								dataToCheck = (part as any).image as string | Buffer; // Cast to access 'image'
							} else if (part.type === 'file') {
								dataToCheck = (part as any).data as string | Buffer; // Cast to access 'data'
							}

							if (typeof dataToCheck === 'string' && dataToCheck.startsWith('gcs_placeholder://')) {
								hasExternalParts = true;
								break;
							}
						}
					}
					if (hasExternalParts) break;
				}
			}
			if (hasExternalParts) {
				console.info(
					`Chat ${chatId} (ObjectId: ${objectIdToDelete.toHexString()}) contained mock GCS references. In a real system, associated GCS assets would also need to be deleted.`,
				);
			}

			// e. Delete from MongoDB
			const deleteResult = await this.chatsCollection.deleteOne({ _id: objectIdToDelete });

			if (deleteResult.deletedCount === 0) {
				// console.warn(`Chat with ID ${chatId} (ObjectId: ${objectIdToDelete.toHexString()}) reported 0 deleted, though found earlier.`); // Optional logging as per requirement's comment
				throw new Error(`Chat with ID ${chatId} not found during deletion, or was already deleted.`);
			}
			console.log(`Chat ${chatId} (ObjectId: ${objectIdToDelete.toHexString()}) deleted successfully by user ${user.id}.`);
		} catch (error) {
			console.error(`Error deleting chat ${chatId}:`, error);
			throw error;
		}
	}
}
