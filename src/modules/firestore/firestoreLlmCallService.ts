import { Buffer } from 'node:buffer';
import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs/promises';
import { join } from 'node:path';
import type { DocumentData, DocumentSnapshot, Firestore } from '@google-cloud/firestore';
import { agentStorageDir } from '#app/appDirs';
import type { CreateLlmRequest } from '#llm/llmCallService/llmCall';
import type { LlmCallService } from '#llm/llmCallService/llmCallService';
import { logger } from '#o11y/logger';
import type { FilePartExt, ImagePartExt, LlmMessage } from '#shared/model/llm.model';
import type { LlmCall, LlmRequest } from '#shared/model/llmCall.model';
import { currentUser } from '#user/userContext';
import { firestoreDb } from './firestore';

// Firestore document size limit (slightly under 1 MiB)
const MAX_DOC_SIZE = 1_000_000;
// Threshold for externalizing message part data (e.g., 500KB)
const EXTERNAL_DATA_THRESHOLD = 500_000;
// Subdirectory within agent storage for message data
const MSG_DATA_SUBDIR = 'msgData';
// Prefix for references to externally stored data
const AGENT_REF_PREFIX = 'agentfs://';

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
	 * Iterates through messages, identifies large data parts (images/files),
	 * saves them to the agent's filesystem storage, and replaces the data
	 * with an agent-specific reference string.
	 * @param messages Original array of messages.
	 * @param agentId The ID of the agent owning these messages.
	 * @returns An object containing the processed messages and a list of created external file paths.
	 * @throws If agentId is missing or file operations fail.
	 */
	private async _externalizeLargeMessageParts(
		messages: ReadonlyArray<LlmMessage>,
		agentId: string,
	): Promise<{ processedMessages: LlmMessage[]; externalRefs: string[] }> {
		if (!agentId) return { processedMessages: [...messages], externalRefs: [] };

		const processedMessages: LlmMessage[] = JSON.parse(JSON.stringify(messages)); // Deep copy
		const externalRefs: string[] = [];
		const msgDataPath = join(agentStorageDir(agentId), MSG_DATA_SUBDIR);

		try {
			await fs.mkdir(msgDataPath, { recursive: true }); // Ensure directory exists

			for (const message of processedMessages) {
				if (!Array.isArray(message.content)) continue;

				for (let i = 0; i < message.content.length; i++) {
					// --- Handle Image/File Parts ---
					const part = message.content[i] as ImagePartExt | FilePartExt;
					if (part.type !== 'image' && part.type !== 'file') continue;
					const dataField: keyof Pick<FilePartExt, 'data'> | keyof Pick<ImagePartExt, 'image'> = part.type === 'image' ? 'image' : 'data';
					const data = (part as ImagePartExt | FilePartExt)[dataField];

					if (part.externalURL) {
						// Already been saved to external storage
						part[dataField] = null;
						continue;
					}

					// Check if data is not already a URL or reference and is large enough
					// if (data && typeof data !== 'string') {
					// 	console.log('Saving object that shouold be string ==============');
					// 	for (const [k, v] of Object.entries(structuredClone(data))) {
					// 		if (typeof v === 'string' && v.length > 1000) data[k] = v.substring(0, 1000);
					// 		else if (Array.isArray(v) && v.length > 1000) data[k] = v.slice(0, 1000);
					// 		console.log(`${k}:${v}`);
					// 	}
					// }
					if (data && !(data instanceof URL) && typeof data !== 'string' && Buffer.byteLength(data as Uint8Array) > EXTERNAL_DATA_THRESHOLD) {
						const uniqueId = randomUUID();
						const filePath = join(msgDataPath, uniqueId);
						await fs.writeFile(filePath, data as Uint8Array);
						externalRefs.push(filePath);
						// Replace data with reference string
						(part as any)[dataField] = `${AGENT_REF_PREFIX}${uniqueId}`;
						// Ensure the original part in the array is updated
						message.content[i] = part;
					} else if (typeof data === 'string' && data.startsWith('data:') && Buffer.byteLength(data) > EXTERNAL_DATA_THRESHOLD) {
						// Handle large base64 strings
						const uniqueId = randomUUID();
						const filePath = join(msgDataPath, uniqueId);
						// Extract base64 data (need to handle mime type if necessary, but Buffer.from handles it)
						const buffer = Buffer.from(data.substring(data.indexOf(',') + 1), 'base64');
						await fs.writeFile(filePath, buffer);
						externalRefs.push(filePath);
						(part as any)[dataField] = `${AGENT_REF_PREFIX}${uniqueId}`;
						message.content[i] = part;
					}
				}
			}
			return { processedMessages, externalRefs };
		} catch (error) {
			logger.error(error, `Error externalizing message parts for agent ${agentId}. Cleaning up created files.`);
			// Attempt cleanup on error
			for (const refPath of externalRefs) {
				try {
					await fs.unlink(refPath);
				} catch (cleanupError) {
					logger.warn(cleanupError, `Failed to cleanup external file: ${refPath}`);
				}
			}
			throw error;
		}
	}

	/**
	 * Iterates through messages, identifies external references (agentfs://...),
	 * loads the corresponding data from the agent's filesystem storage,
	 * and replaces the reference string with the actual data (Buffer).
	 * @param messages Array of messages potentially containing references.
	 * @param agentId The ID of the agent owning these messages.
	 * @returns The array of messages with references replaced by data.
	 */
	private async _hydrateMessageParts(messages: LlmMessage[], agentId: string): Promise<LlmMessage[]> {
		if (!agentId) return messages;

		const agentStoragePath = agentStorageDir(agentId);
		const msgDataPath = join(agentStoragePath, MSG_DATA_SUBDIR);

		for (const message of messages) {
			if (!Array.isArray(message.content)) continue;

			for (let i = 0; i < message.content.length; i++) {
				const part = message.content[i];
				if (!part.externalURL) continue;
				if (part.type !== 'image' && part.type !== 'file') continue;

				const dataField: keyof Pick<FilePartExt, 'data'> | keyof Pick<ImagePartExt, 'image'> = part.type === 'image' ? 'image' : 'data';
				const data = (part as ImagePartExt | FilePartExt)[dataField];

				const externalFileName = data.substring(AGENT_REF_PREFIX.length);
				const externalFilePath = join(msgDataPath, externalFileName);
				part[dataField] = await fs.readFile(externalFilePath);
			}
		}
		return messages;
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
		const agentId = dataToSave.agentId;
		let processedMessages: LlmMessage[];
		let externalRefs: string[] = []; // Keep track of refs created in this call

		if (agentId) {
			// Only externalize if agentId is present
			try {
				const result = await this._externalizeLargeMessageParts(messages, agentId);
				processedMessages = result.processedMessages;
				externalRefs = result.externalRefs; // Store refs for potential cleanup if Firestore save fails
			} catch (e) {
				// fs.writeFile('llmCall.json', JSON.stringify(messages)).catch(console.error)
				logger.error(e, `Failed to externalize data for LlmCall ${llmCallId}. Aborting save.`);
				// externalizeLargeMessageParts already handles cleanup of its own files on error
				throw e;
			}
		} else {
			processedMessages = [...messages]; // Use original messages if no agentId
		}

		// Estimate size using processedMessages
		const estimatedSize = this.estimateSize({ ...dataToSave, messages: processedMessages });

		if (estimatedSize < MAX_DOC_SIZE) {
			// --- Single Document Case ---
			const llmCallDocRef = this.db.doc(`LlmCall/${llmCallId}`);
			// Use processedMessages here
			const finalData = { ...dataToSave, messages: processedMessages, chunkCount: 0 };
			try {
				await llmCallDocRef.set(finalData, { merge });
			} catch (e) {
				logger.info(finalData, `Failed LlmCall save (single doc, merge=${merge}) [finalData]`);
				logger.error(e, `Error saving single LlmCall (merge=${merge}) ${llmCallId}: ${e.message}`);
				// Attempt cleanup of external files if save failed
				if (externalRefs.length > 0) {
					logger.info(`Attempting to clean up ${externalRefs.length} external files due to Firestore save failure.`);
					for (const refPath of externalRefs) {
						try {
							await fs.unlink(refPath);
						} catch (cleanupError) {
							logger.warn(cleanupError, `Failed to cleanup external file during Firestore error handling: ${refPath}`);
						}
					}
				}
				throw e;
			}
		} else {
			logger.debug(`LlmCall ${llmCallId} estimated size ${estimatedSize} exceeds limit ${MAX_DOC_SIZE}. Chunking messages.`);

			// Check if any single message (after potential externalization), when wrapped in a chunk document, exceeds the limit
			for (const message of processedMessages) {
				// Use processedMessages
				const estimatedChunkWithMessageSize = this.estimateSize({ llmCallId, chunkIndex: 1, messages: [message] });
				if (estimatedChunkWithMessageSize > MAX_DOC_SIZE) {
					logger.error(
						`Single message estimated size within chunk (${estimatedChunkWithMessageSize} bytes) exceeds limit (${MAX_DOC_SIZE} bytes) for LlmCall ${llmCallId}. Message content size: ${this.estimateSize(
							message.content,
						)} bytes.`,
					);
					// await fs.writeFile('llmCall.json', JSON.stringify(messages)).catch(console.error);
					// Note: This error might still occur if a text part is extremely large, as externalization only targets image/file parts.
					throw new Error(
						`Single message in LlmCall ${llmCallId} for ${dataToSave.description}, Response:${merge}, causes chunk document to exceed maximum size limit of ${MAX_DOC_SIZE} bytes.`,
					);
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

			// Iterate over processedMessages for chunking
			for (const message of processedMessages) {
				const messageSize = this.estimateSize(message);
				// Use currentChunkMessages which contains parts of processedMessages
				const potentialChunkSize = this.estimateSize({ llmCallId, chunkIndex: currentChunkIndex, messages: [...currentChunkMessages, message] });

				if (potentialChunkSize >= MAX_DOC_SIZE && currentChunkMessages.length > 0) {
					// Use currentChunkMessages for chunkData
					const chunkData = { llmCallId, chunkIndex: currentChunkIndex, messages: currentChunkMessages };
					const chunkDocRef = this.db.doc(`LlmCall/${llmCallId}-${currentChunkIndex}`);
					batch.set(chunkDocRef, chunkData); // Chunks are always new, so no merge needed
					mainDocData.chunkCount++;
					logger.debug(`Adding chunk ${currentChunkIndex} for LlmCall ${llmCallId} with ${currentChunkMessages.length} messages.`);

					currentChunkIndex++;
					currentChunkMessages = [message]; // Start new chunk with current message
					// Recalculate size for the new chunk starting with this message
					currentChunkSize = this.estimateSize({ llmCallId, chunkIndex: currentChunkIndex, messages: currentChunkMessages });
				} else {
					currentChunkMessages.push(message);
					currentChunkSize = potentialChunkSize; // Update size with the added message
				}
			}

			// Handle the last chunk
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
				// Attempt cleanup of external files if batch commit failed
				if (externalRefs.length > 0) {
					logger.info(`Attempting to clean up ${externalRefs.length} external files due to Firestore batch commit failure.`);
					for (const refPath of externalRefs) {
						try {
							await fs.unlink(refPath);
						} catch (cleanupError) {
							logger.warn(cleanupError, `Failed to cleanup external file during Firestore error handling: ${refPath}`);
						}
					}
				}
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
			// logger.debug({ messages: messagesToSave }, 'Messages being saved by saveRequest');
			// Optionally stringify with custom replacer for Buffers if needed
			logger.debug(
				`Messages being saved: ${JSON.stringify(
					messagesToSave,
					(key, value) => {
						if (value && value.type === 'Buffer' && Array.isArray(value.data)) {
							return `<Buffer length=${value.data.length}>`;
						}
						return value;
					},
					2,
				)}`,
			);
		} catch (e) {
			logger.warn(e, 'Error logging messages in saveRequest');
		}
		try {
			// Use the helper to save, passing messages separately. merge=false for new request.
			await this._saveOrUpdateLlmCall(id, dataToSave, messagesToSave, false);
		} catch (e) {
			logger.error(e, `Error saving LLMCall request via _saveOrUpdateLlmCall: ${e.message}`);
			throw e; // Re-throw after logging context
		}

		// Return the LlmRequest interface, including the generated id and original messages
		// Note: messagesToSave here still contains the original data before externalization,
		// which might be large in memory but is what the caller expects.
		// The data saved to Firestore has references instead of large blobs.
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
		const agentId = mainData.agentId; // Get agentId for hydration

		let combinedMessages: LlmMessage[] = [];

		if (chunkCount === 0) {
			// Not chunked or messages fit in main doc
			combinedMessages = mainData.messages ?? [];
		} else {
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

			chunksSnapshot.docs.forEach((doc) => {
				const chunkData = doc.data();
				if (chunkData.messages && Array.isArray(chunkData.messages)) {
					combinedMessages.push(...chunkData.messages); // Collect messages from chunks
				} else {
					logger.warn(`Chunk document ${doc.id} for LlmCall ${llmCallId} is missing or has invalid 'messages' array.`);
				}
			});
		}

		// Hydrate messages if agentId is available
		if (agentId) {
			try {
				combinedMessages = await this._hydrateMessageParts(combinedMessages, agentId);
			} catch (e) {
				logger.error(e, `Error hydrating message parts for LlmCall ${llmCallId}`);
				// Proceed with potentially unhydrated messages
			}
		} else if (combinedMessages.some((m) => JSON.stringify(m.content).includes(AGENT_REF_PREFIX))) {
			logger.warn(`LlmCall ${llmCallId} contains external references but no agentId was found. Cannot hydrate message data.`);
		}

		// Combine main data (without its original messages field which might be absent or incomplete) and the potentially hydrated messages
		const combinedData = { ...mainData, messages: combinedMessages };
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
			// This path likely won't delete external files as we can't reliably get agentId.
			const mainDocRef = this.db.doc(`LlmCall/${llmCallId}`);
			const mainDocSnap = await mainDocRef.get();
			if (mainDocSnap.exists) {
				logger.warn(`Found main document by ID ${llmCallId} but query by llmCallId failed. Deleting main doc only. External files may be orphaned.`);
				await mainDocRef.delete();
			}
			return;
		}

		let agentId: string | undefined;
		const externalRefsToDelete: string[] = [];

		// Find agentId from the main doc and collect all references from all docs
		querySnapshot.docs.forEach((doc) => {
			const data = doc.data();
			// Identify main doc (no chunkIndex or chunkIndex 0) to get agentId
			if (!data.chunkIndex || data.chunkIndex === 0) {
				agentId = data.agentId; // Assume main doc has the agentId
			}
			// Collect references from messages in this document (main or chunk)
			if (data.messages && Array.isArray(data.messages)) {
				data.messages.forEach((message: LlmMessage) => {
					if (Array.isArray(message.content)) {
						message.content.forEach((part) => {
							if (part.type === 'image' || part.type === 'file') {
								const dataField = part.type === 'image' ? 'image' : 'file';
								const ref = (part as any)[dataField];
								if (typeof ref === 'string' && ref.startsWith(AGENT_REF_PREFIX)) {
									externalRefsToDelete.push(ref);
								}
							}
							// --- Check Text Parts ---
							else if (part.type === 'text' && typeof part.text === 'string' && part.text.startsWith(AGENT_REF_PREFIX)) {
								// Check if the text field itself contains a reference
								externalRefsToDelete.push(part.text);
							}
						});
					}
				});
			}
		});

		// Delete external files if agentId and refs were found
		if (agentId && externalRefsToDelete.length > 0) {
			logger.info(`Found ${externalRefsToDelete.length} potential external files to delete for LlmCall ${llmCallId}`);
			let agentMsgDataPath: string;
			try {
				// Ensure agentId is valid for path construction
				agentMsgDataPath = join(agentStorageDir(agentId), MSG_DATA_SUBDIR);
			} catch (e) {
				logger.error(e, `Cannot determine storage path for agent ${agentId}. Skipping external file deletion.`);
				agentId = undefined; // Prevent deletion attempt
			}

			if (agentId) {
				// Check again in case getAgentStoragePath threw
				for (const ref of externalRefsToDelete) {
					const uniqueId = ref.substring(AGENT_REF_PREFIX.length);
					const filePath = join(agentMsgDataPath, uniqueId);
					try {
						await fs.unlink(filePath);
						logger.debug(`Deleted external file: ${filePath}`);
					} catch (error: any) {
						// Log error if file not found (ENOENT) or other permission issues, but continue
						if (error.code !== 'ENOENT') {
							logger.warn(error, `Failed to delete external file: ${filePath}`);
						} else {
							logger.debug(`External file not found (already deleted?): ${filePath}`);
						}
					}
				}
			}
		} else if (externalRefsToDelete.length > 0) {
			logger.warn(`Found external references for LlmCall ${llmCallId} but could not determine agentId. External files will not be deleted.`);
		}

		// Use a batch write to delete all found Firestore documents atomically
		const batch = this.db.batch();
		querySnapshot.docs.forEach((doc) => {
			batch.delete(doc.ref);
		});

		try {
			await batch.commit();
			logger.info(`Successfully deleted ${querySnapshot.size} Firestore documents (LlmCall and associated chunks) for ID: ${llmCallId}`);
		} catch (e) {
			logger.error(e, `Error deleting LlmCall Firestore documents for ID: ${llmCallId}`);
			throw e;
		}
	}
}
