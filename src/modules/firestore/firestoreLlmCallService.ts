import { randomUUID } from 'node:crypto';
import { DocumentData, DocumentSnapshot, Firestore, WriteBatch } from '@google-cloud/firestore';
import { LlmMessage } from '#llm/llm';
import { CreateLlmRequest, LlmCall, LlmRequest } from '#llm/llmCallService/llmCall';
import { LlmCallService } from '#llm/llmCallService/llmCallService';
import { logger } from '#o11y/logger';
import { currentUser } from '#user/userService/userContext';
import { firestoreDb } from './firestore';

// Firestore document size limit (slightly under 1 MiB)
const MAX_DOC_SIZE = 1_000_000;

// TODO add composite index LlmCall	agentId Ascending requestTime Descending __name__ Descending
// TODO add composite index LlmCall	userId Ascending description Ascending requestTime Descending __name__ Descending
// TODO add composite index LlmCall	llmCallId Ascending chunkIndex Ascending __name__ Ascending
/**
 * Implementation of the LlmCallService interface using Google Firestore.
 * Handles LlmCall objects potentially larger than Firestore's 1MB limit
 * by splitting the 'messages' array into separate chunk documents.
 */
export class FirestoreLlmCallService implements LlmCallService {
	private db: Firestore = firestoreDb();

	/** Helper to estimate the byte size of an object when stringified */
	private estimateSize(data: any): number {
		return Buffer.byteLength(JSON.stringify(data), 'utf8');
	}

	private deserialize(id: string, data: DocumentData): LlmCall {
		return {
			id: id,
			// Ensure messages is an array, even if it was stored in chunks
			messages: data.messages ?? [],
			cost: data.cost,
			description: data.description,
			llmId: data.llmId,
			requestTime: data.requestTime,
			timeToFirstToken: data.timeToFirstToken,
			totalTime: data.totalTime,
			agentId: data.agentId,
			userId: data.userId,
			callStack: data.callStack,
			inputTokens: data.inputTokens,
			outputTokens: data.outputTokens,
			// Chunk count might not be present in older data or if not chunked
			chunkCount: data.chunkCount ?? 0,
			// Include llmCallId which might be needed internally, though id is the primary identifier
			llmCallId: data.llmCallId ?? id,
		};
	}

	/**
	 * Retrieves LlmResponse entities from the Firestore based on the provided agentId.
	 * @param {string} agentId - The agentId to filter the LlmResponse entities.
	 * @returns {Promise<LlmCall[]>} - A promise that resolves to an array of reconstructed LlmCall entities.
	 */
	async getLlmCallsForAgent(agentId: string): Promise<LlmCall[]> {
		const querySnapshot = await this.db
			.collection('LlmCall')
			.where('agentId', '==', agentId)
			// We filter out chunks here, they will be fetched during reconstruction if needed
			// .where('chunkIndex', '==', null) // Cannot query for null equality directly with inequality/orderBy
			.orderBy('requestTime', 'desc')
			.get();

		// Filter out chunk documents manually and reconstruct
		const mainDocs = querySnapshot.docs.filter((doc) => !doc.data().chunkIndex || doc.data().chunkIndex === 0);
		const reconstructedCalls = await Promise.all(mainDocs.map((doc) => this.getCall(doc.id)));

		// Filter out any null results (shouldn't happen if getCall is correct) and sort again
		return reconstructedCalls.filter((call): call is LlmCall => call !== null).sort((a, b) => b.requestTime - a.requestTime);
	}

	/**
	 * Internal helper to save or update an LlmCall, handling chunking.
	 * @param llmCallId The ID of the LlmCall document.
	 * @param dataToSave The core data (excluding messages if chunking).
	 * @param messages The full list of messages to save.
	 * @param merge Whether to merge with existing document (for updates).
	 */
	private async _saveOrUpdateLlmCall(
		llmCallId: string,
		dataToSave: Omit<LlmCall, 'messages' | 'id'> & { llmCallId: string },
		messages: ReadonlyArray<LlmMessage>,
		merge: boolean,
	): Promise<void> {
		const estimatedSize = this.estimateSize({ ...dataToSave, messages });

		if (estimatedSize < MAX_DOC_SIZE) {
			// --- Single Document Case ---
			const llmCallDocRef = this.db.doc(`LlmCall/${llmCallId}`);
			const finalData = { ...dataToSave, messages, chunkCount: 0 };
			try {
				await llmCallDocRef.set(finalData, { merge });
			} catch (e) {
				logger.info(finalData, `Failed LlmCall save (single doc, merge=${merge}) [finalData]`);
				logger.error(e, `Error saving single LlmCall (merge=${merge}) ${llmCallId}: ${e.message}`);
				throw e;
			}
		} else {
			logger.debug(`LlmCall ${llmCallId} estimated size ${estimatedSize} exceeds limit ${MAX_DOC_SIZE}. Chunking messages.`);

			// Check if any single message, when wrapped in a chunk document, exceeds the limit
			for (const message of messages) {
				const estimatedChunkWithMessageSize = this.estimateSize({ llmCallId, chunkIndex: 1, messages: [message] });
				if (estimatedChunkWithMessageSize > MAX_DOC_SIZE) {
					logger.error(
						`Single message estimated size within chunk (${estimatedChunkWithMessageSize} bytes) exceeds limit (${MAX_DOC_SIZE} bytes) for LlmCall ${llmCallId}. Message content size: ${this.estimateSize(
							message.content,
						)} bytes.`,
					);
					throw new Error(`Single message in LlmCall ${llmCallId} causes chunk document to exceed maximum size limit of ${MAX_DOC_SIZE} bytes.`);
				}
			}

			const batch = this.db.batch();
			const mainDocRef = this.db.doc(`LlmCall/${llmCallId}`);

			// Main document data (without messages) - initialize chunkCount
			const mainDocData = { ...dataToSave, chunkCount: 0 };

			let currentChunkIndex = 1;
			let currentChunkMessages: LlmMessage[] = [];
			// Estimate base size of a chunk document
			let currentChunkSize = this.estimateSize({ llmCallId, chunkIndex: currentChunkIndex, messages: [] });

			for (const message of messages) {
				const messageSize = this.estimateSize(message);
				const potentialChunkSize = this.estimateSize({ llmCallId, chunkIndex: currentChunkIndex, messages: [...currentChunkMessages, message] });

				if (potentialChunkSize >= MAX_DOC_SIZE && currentChunkMessages.length > 0) {
					const chunkData = { llmCallId, chunkIndex: currentChunkIndex, messages: currentChunkMessages };
					const chunkDocRef = this.db.doc(`LlmCall/${llmCallId}-${currentChunkIndex}`);
					batch.set(chunkDocRef, chunkData); // Chunks are always new, so no merge needed
					mainDocData.chunkCount++;
					logger.debug(`Adding chunk ${currentChunkIndex} for LlmCall ${llmCallId} with ${currentChunkMessages.length} messages.`);

					currentChunkIndex++;
					currentChunkMessages = [message];
					currentChunkSize = this.estimateSize({ llmCallId, chunkIndex: currentChunkIndex, messages: currentChunkMessages });
				} else {
					currentChunkMessages.push(message);
					currentChunkSize = potentialChunkSize;
				}
			}

			if (currentChunkMessages.length > 0) {
				const chunkData = { llmCallId, chunkIndex: currentChunkIndex, messages: currentChunkMessages };
				const chunkDocRef = this.db.doc(`LlmCall/${llmCallId}-${currentChunkIndex}`);
				batch.set(chunkDocRef, chunkData);
				mainDocData.chunkCount++;
				logger.debug(`Adding final chunk ${currentChunkIndex} for LlmCall ${llmCallId} with ${currentChunkMessages.length} messages.`);
			}

			// Set/Update the main document with the final chunkCount and other data (no messages)
			batch.set(mainDocRef, mainDocData, { merge });

			try {
				await batch.commit();
				logger.info(`Successfully saved chunked LlmCall ${llmCallId} (merge=${merge}) with ${mainDocData.chunkCount} chunks.`);
			} catch (e) {
				logger.info(mainDocData, `Failed LlmCall save (chunking, merge=${merge}) [mainDocData]`);
				logger.error(e, `Error committing batch for chunked LlmCall ${llmCallId} (merge=${merge}): ${e.message}`);
				throw e;
			}
		}
	}

	async saveRequest(request: CreateLlmRequest): Promise<LlmRequest> {
		const id: string = randomUUID();
		const requestTime = Date.now();
		const userId = request.userId ?? currentUser()?.id; // Determine userId

		// Prepare the core data, excluding messages initially for size calculation/chunking
		// eslint-disable-next-line @typescript-eslint/no-unused-vars
		const { messages, ...baseRequestData } = request;
		const dataToSave: Omit<LlmRequest, 'id' | 'messages'> & { llmCallId: string } = {
			...baseRequestData,
			requestTime,
			llmCallId: id, // Use generated id as llmCallId
			userId: userId, // Ensure userId is included
		};

		const messagesToSave = messages ?? []; // Handle case where messages might be undefined

		try {
			// Use the helper to save, passing messages separately. merge=false for new request.
			await this._saveOrUpdateLlmCall(id, dataToSave, messagesToSave, false);
		} catch (e) {
			logger.error(e, `Error saving LLMCall request via _saveOrUpdateLlmCall: ${e.message}`);
			throw e; // Re-throw after logging context
		}

		// Return the LlmRequest interface, including the generated id and original messages
		return { id, ...dataToSave, messages: messagesToSave };
	}

	async saveResponse(llmCall: LlmCall): Promise<void> {
		const llmCallId = llmCall.llmCallId ?? llmCall.id;
		if (!llmCallId) {
			throw new Error('LlmCall is missing both id and llmCallId');
		}

		// Messages should already contain the final assistant response
		const finalMessages: ReadonlyArray<LlmMessage> = llmCall.messages ?? [];

		// Prepare the core data object, excluding messages
		// eslint-disable-next-line @typescript-eslint/no-unused-vars
		const { messages, id, ...baseData } = llmCall; // Exclude id as well, llmCallId is the key
		const dataToSave: Omit<LlmCall, 'messages' | 'id'> & { llmCallId: string } = {
			...baseData,
			llmCallId: llmCallId, // Ensure llmCallId is explicitly included
			userId: llmCall.userId ?? currentUser()?.id, // Ensure userId is set
		};

		try {
			// Use the helper to update, passing final messages. merge=true for update.
			await this._saveOrUpdateLlmCall(llmCallId, dataToSave, finalMessages, true);
		} catch (e) {
			logger.error(e, `Error saving LLMCall response via _saveOrUpdateLlmCall: ${e.message}`);
			throw e; // Re-throw after logging context
		}
	}

	async getCall(llmCallId: string): Promise<LlmCall | null> {
		const mainDocRef = this.db.doc(`LlmCall/${llmCallId}`);
		const mainDocSnap: DocumentSnapshot = await mainDocRef.get();

		if (!mainDocSnap.exists) {
			logger.warn(`LlmCall document not found for ID: ${llmCallId}`);
			return null;
		}

		const mainData = mainDocSnap.data();
		if (!mainData) {
			logger.error(`LlmCall document data is missing for ID: ${llmCallId}`);
			return null; // Should not happen if exists is true, but safeguard
		}

		const chunkCount = mainData.chunkCount ?? 0;
		const callIdFromData = mainData.llmCallId ?? llmCallId; // Use llmCallId from data if present

		if (chunkCount === 0) {
			// Not chunked or messages fit in main doc
			return this.deserialize(mainDocSnap.id, mainData);
		}
		// Chunked: Fetch chunks and reconstruct messages
		logger.debug(`LlmCall ${llmCallId} has ${chunkCount} chunks. Fetching...`);
		const chunksQuery = this.db
			.collection('LlmCall')
			.where('llmCallId', '==', callIdFromData) // Query using llmCallId field
			.where('chunkIndex', '>', 0) // Select only chunk documents
			.orderBy('chunkIndex', 'asc'); // Order chunks correctly

		const chunksSnapshot = await chunksQuery.get();

		if (chunksSnapshot.size !== chunkCount) {
			logger.warn(
				`Mismatch in expected chunk count (${chunkCount}) and found chunks (${chunksSnapshot.size}) for LlmCall ID: ${llmCallId}. Proceeding with found chunks.`,
			);
			// Potentially update chunkCount on mainData if desired, but might indicate an issue.
		}

		const allMessages: LlmMessage[] = [];
		chunksSnapshot.docs.forEach((doc) => {
			const chunkData = doc.data();
			if (chunkData.messages && Array.isArray(chunkData.messages)) {
				allMessages.push(...chunkData.messages);
			} else {
				logger.warn(`Chunk document ${doc.id} for LlmCall ${llmCallId} is missing or has invalid 'messages' array.`);
			}
		});

		// Combine main data (without its potentially partial messages) and the reconstructed messages
		const combinedData = { ...mainData, messages: allMessages };
		return this.deserialize(mainDocSnap.id, combinedData);
	}

	async getLlmCallsByDescription(description: string): Promise<LlmCall[]> {
		const userId = currentUser()?.id;
		if (!userId) {
			logger.warn('Cannot getLlmCallsByDescription without a current user ID.');
			return [];
		}
		const querySnapshot = await this.db
			.collection('LlmCall')
			.where('userId', '==', userId)
			.where('description', '==', description)
			// Filter out chunks manually after query
			.orderBy('requestTime', 'desc')
			.get();

		// Filter out chunk documents manually and reconstruct
		const mainDocs = querySnapshot.docs.filter((doc) => !doc.data().chunkIndex || doc.data().chunkIndex === 0);
		const reconstructedCalls = await Promise.all(mainDocs.map((doc) => this.getCall(doc.id)));

		// Filter out any null results and sort again
		return reconstructedCalls.filter((call): call is LlmCall => call !== null).sort((a, b) => b.requestTime - a.requestTime);
	}

	async delete(llmCallId: string): Promise<void> {
		// Query for all documents (main and chunks) associated with the llmCallId
		// We use the llmCallId field which should be present on both main and chunk docs.
		const querySnapshot = await this.db.collection('LlmCall').where('llmCallId', '==', llmCallId).get();

		if (querySnapshot.empty) {
			logger.warn(`No documents found for LlmCall ID: ${llmCallId} during delete operation.`);
			// Check if the main document exists by its ID just in case llmCallId wasn't set correctly
			const mainDocRef = this.db.doc(`LlmCall/${llmCallId}`);
			const mainDocSnap = await mainDocRef.get();
			if (mainDocSnap.exists) {
				logger.warn(`Found main document by ID ${llmCallId} but query by llmCallId failed. Deleting main doc only.`);
				await mainDocRef.delete();
			}
			return;
		}

		// Use a batch write to delete all found documents atomically
		const batch = this.db.batch();
		querySnapshot.docs.forEach((doc) => {
			batch.delete(doc.ref);
		});

		try {
			await batch.commit();
			logger.info(`Successfully deleted ${querySnapshot.size} documents (LlmCall and associated chunks) for ID: ${llmCallId}`);
		} catch (e) {
			logger.error(e, `Error deleting LlmCall documents for ID: ${llmCallId}`);
			throw e;
		}
	}
}
