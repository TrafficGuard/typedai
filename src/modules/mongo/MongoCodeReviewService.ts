import { Buffer } from 'node:buffer';
import { type Collection, type Db, ObjectId } from 'mongodb';
import type { CodeReviewConfig } from '#shared/codeReview/codeReview.model';
import type { CodeReviewService } from '#swe/codeReview/codeReviewService';
import { type CodeReviewFingerprintCache, EMPTY_CACHE } from '#swe/codeReview/codeReviewTaskModel';

const CODE_REVIEW_CONFIGS_COLLECTION = 'codeReviewConfigs';

export class MongoCodeReviewService implements CodeReviewService {
	private static readonly MAX_FIELD_SIZE_BYTES = 1 * 1024 * 1024; // 1MB
	private static readonly MERGE_REQUEST_REVIEW_CACHE_COLLECTION = 'mergeRequestReviewCache';

	private readonly codeReviewConfigsCollection: Collection<any>;
	private readonly mergeRequestReviewCacheCollection: Collection<any>;

	constructor(private db: Db) {
		this.codeReviewConfigsCollection = this.db.collection<any>(CODE_REVIEW_CONFIGS_COLLECTION);
		this.mergeRequestReviewCacheCollection = this.db.collection<any>(MongoCodeReviewService.MERGE_REQUEST_REVIEW_CACHE_COLLECTION);
	}

	async getCodeReviewConfig(id: string): Promise<CodeReviewConfig | null> {
		try {
			let objectId: ObjectId;
			try {
				objectId = new ObjectId(id);
			} catch (e) {
				// Consistent with MongoChatService.loadChat, throw an error for invalid ID format.
				// The outer catch block will log this error.
				throw new Error(`Invalid ID format for CodeReviewConfig: "${id}"`);
			}

			const doc = await this.codeReviewConfigsCollection.findOne({ _id: objectId });

			if (!doc) {
				return null;
			}

			// Map MongoDB document to CodeReviewConfig object
			// The 'doc' is of type 'any' or 'Document' from MongoDB driver.
			// Explicitly cast to access properties, or ensure proper typing if possible.
			const dbDoc = doc as any;

			const config: CodeReviewConfig = {
				id: dbDoc._id.toString(),
				title: dbDoc.title ?? '',
				enabled: dbDoc.enabled ?? false,
				description: dbDoc.description ?? '',
				fileExtensions: {
					include: dbDoc.fileExtensions?.include ?? [],
				},
				requires: {
					text: dbDoc.requires?.text ?? [],
				},
				tags: dbDoc.tags ?? [],
				projectPaths: dbDoc.projectPaths ?? [],
				examples: dbDoc.examples ?? [], // examples is IExample[]
			};
			return config;
		} catch (error) {
			// Log any errors and re-throw them.
			// Using console.error as per requirement and consistency with MongoChatService.
			console.error(`MongoCodeReviewService.getCodeReviewConfig: Error fetching config for id "${id}":`, error);
			throw error;
		}
	}

	async listCodeReviewConfigs(): Promise<CodeReviewConfig[]> {
		try {
			const mongoDocs = await this.codeReviewConfigsCollection.find({}).toArray();

			if (!mongoDocs || mongoDocs.length === 0) {
				return [];
			}

			return mongoDocs.map((doc: any) => {
				// Map MongoDB document to CodeReviewConfig object
				// Same mapping logic as in getCodeReviewConfig
				const dbDoc = doc as any;
				const config: CodeReviewConfig = {
					id: dbDoc._id.toString(),
					title: dbDoc.title ?? '',
					enabled: dbDoc.enabled ?? false,
					description: dbDoc.description ?? '',
					fileExtensions: {
						include: dbDoc.fileExtensions?.include ?? [],
					},
					requires: {
						text: dbDoc.requires?.text ?? [],
					},
					tags: dbDoc.tags ?? [],
					projectPaths: dbDoc.projectPaths ?? [],
					examples: dbDoc.examples ?? [],
				};
				return config;
			});
		} catch (error) {
			// Log any errors and re-throw them.
			console.error('MongoCodeReviewService.listCodeReviewConfigs: Error listing configs:', error);
			throw error;
		}
	}

	async createCodeReviewConfig(config: Omit<CodeReviewConfig, 'id'>): Promise<string> {
		try {
			const newObjectId = new ObjectId();

			// Create a deep copy of the config to avoid modifying the original
			// CodeReviewConfig and IExample consist of primitives, arrays, and simple objects,
			// so JSON.parse(JSON.stringify()) is a safe and simple way to deep clone.
			const processedConfig = JSON.parse(JSON.stringify(config));

			if (processedConfig.examples && Array.isArray(processedConfig.examples)) {
				for (let i = 0; i < processedConfig.examples.length; i++) {
					const example = processedConfig.examples[i];

					// Check example.code
					if (typeof example.code === 'string' && Buffer.byteLength(example.code, 'utf8') > MongoCodeReviewService.MAX_FIELD_SIZE_BYTES) {
						example.code = `gcs_placeholder://${newObjectId.toString()}/examples/${i}/code`;
						console.warn(
							`MOCK EXTERNALIZATION: CodeReviewConfig example code at index ${i} for new config ${newObjectId.toString()} was marked for GCS. Actual GCS upload needed.`,
						);
					}

					// Check example.reviewComment
					if (typeof example.reviewComment === 'string' && Buffer.byteLength(example.reviewComment, 'utf8') > MongoCodeReviewService.MAX_FIELD_SIZE_BYTES) {
						example.reviewComment = `gcs_placeholder://${newObjectId.toString()}/examples/${i}/reviewComment`;
						console.warn(
							`MOCK EXTERNALIZATION: CodeReviewConfig example reviewComment at index ${i} for new config ${newObjectId.toString()} was marked for GCS. Actual GCS upload needed.`,
						);
					}
				}
			}

			const docToInsert = {
				_id: newObjectId,
				...processedConfig,
			};

			await this.codeReviewConfigsCollection.insertOne(docToInsert);

			// insertOne throws an error on failure, which will be caught by the catch block.
			// If result.insertedId is needed for other checks, it's available here.
			// For this implementation, successfully reaching this point means insertion was acknowledged.

			return newObjectId.toString();
		} catch (error) {
			console.error('MongoCodeReviewService.createCodeReviewConfig: Error creating config:', error);
			throw error;
		}
	}

	async updateCodeReviewConfig(id: string, updates: Partial<CodeReviewConfig>): Promise<void> {
		try {
			let objectId: ObjectId;
			try {
				objectId = new ObjectId(id);
			} catch (e) {
				// If ObjectId conversion fails, throw an error.
				// This will be caught by the outer try...catch block.
				throw new Error(`Invalid ID format for CodeReviewConfig: "${id}"`);
			}

			// Create a deep copy of the updates object to avoid modifying the original
			// and to ensure all nested properties are processed.
			const processedUpdates = JSON.parse(JSON.stringify(updates));

			// Handle large 'examples' data if present in processedUpdates
			if (processedUpdates.examples && Array.isArray(processedUpdates.examples)) {
				for (let i = 0; i < processedUpdates.examples.length; i++) {
					const example = processedUpdates.examples[i];

					// Check example.code size
					if (typeof example.code === 'string' && Buffer.byteLength(example.code, 'utf8') > MongoCodeReviewService.MAX_FIELD_SIZE_BYTES) {
						example.code = `gcs_placeholder://${id}/examples/${i}/code`;
						console.warn(
							`MOCK EXTERNALIZATION: CodeReviewConfig example code at index ${i} for config ${id} was marked for GCS during update. Actual GCS upload needed.`,
						);
					}

					// Check example.reviewComment size
					if (typeof example.reviewComment === 'string' && Buffer.byteLength(example.reviewComment, 'utf8') > MongoCodeReviewService.MAX_FIELD_SIZE_BYTES) {
						example.reviewComment = `gcs_placeholder://${id}/examples/${i}/reviewComment`;
						console.warn(
							`MOCK EXTERNALIZATION: CodeReviewConfig example reviewComment at index ${i} for config ${id} was marked for GCS during update. Actual GCS upload needed.`,
						);
					}
				}
			}

			// Sanitize updates: remove the 'id' property from processedUpdates if it exists.
			// This prevents attempting to modify the immutable '_id' field in MongoDB.
			// The 'id' field in CodeReviewConfig corresponds to '_id' in the database.
			if ('id' in processedUpdates) {
				processedUpdates.id = undefined;
			}

			// Perform the update operation in MongoDB
			const result = await this.codeReviewConfigsCollection.updateOne(
				{ _id: objectId }, // Filter by the document's ObjectId
				{ $set: processedUpdates }, // Use $set to update only the specified fields
			);

			// Check if any document was matched and updated
			if (result.matchedCount === 0) {
				throw new Error(`CodeReviewConfig with id "${id}" not found for update.`);
			}
			// A successful updateOne operation (where a document is found and modified)
			// will have result.modifiedCount > 0 (or result.upsertedCount > 0 if upserting).
			// result.matchedCount === 0 is sufficient to indicate the document wasn't found.
		} catch (error) {
			// Log any errors that occur during the update process
			console.error(`MongoCodeReviewService.updateCodeReviewConfig: Error updating config "${id}":`, error);
			// Rethrow the error to be handled by the caller
			throw error;
		}
	}

	async deleteCodeReviewConfig(id: string): Promise<void> {
		try {
			// Input Validation
			if (!id) {
				throw new Error('ID must be provided for CodeReviewConfig deletion.');
			}

			// ID Conversion
			let objectIdToDelete: ObjectId;
			try {
				objectIdToDelete = new ObjectId(id);
			} catch (e) {
				// This specific error for ID format will be caught by the outer catch block.
				throw new Error(`Invalid ID format for CodeReviewConfig: "${id}"`);
			}

			// Fetch Document for GCS Check
			// The document fetched from MongoDB might not strictly conform to CodeReviewConfig
			// if fields are missing, so treat it as `any` for flexibility here.
			const docToDelete = await this.codeReviewConfigsCollection.findOne({ _id: objectIdToDelete });

			if (!docToDelete) {
				throw new Error(`CodeReviewConfig with id "${id}" not found.`);
			}

			// Mock GCS Cleanup Logging
			let hasExternalParts = false;
			// Accessing 'examples' which might be an array of IExample-like objects.
			// Cast docToDelete to 'any' to safely access properties that might exist.
			const examples = (docToDelete as any).examples;
			if (examples && Array.isArray(examples)) {
				for (const example of examples) {
					// Assuming example objects have 'code' and 'reviewComment' properties.
					const exampleCode = (example as any).code;
					const exampleReviewComment = (example as any).reviewComment;

					if (
						(typeof exampleCode === 'string' && exampleCode.startsWith('gcs_placeholder://')) ||
						(typeof exampleReviewComment === 'string' && exampleReviewComment.startsWith('gcs_placeholder://'))
					) {
						hasExternalParts = true;
						break;
					}
				}
			}

			if (hasExternalParts) {
				console.info(
					`CodeReviewConfig ${id} (ObjectId: ${objectIdToDelete.toHexString()}) contained mock GCS references. In a real system, associated GCS assets would also need to be deleted.`,
				);
			}

			// Delete from MongoDB
			const deleteResult = await this.codeReviewConfigsCollection.deleteOne({ _id: objectIdToDelete });

			if (deleteResult.deletedCount === 0) {
				// This case implies the document was found initially but couldn't be deleted,
				// or was deleted by another process between the findOne and deleteOne operations.
				throw new Error(
					`CodeReviewConfig with id "${id}" (ObjectId: ${objectIdToDelete.toHexString()}) reported 0 deleted, though found earlier. This might indicate a race condition or an issue.`,
				);
			}

			// Logging on successful deletion
			console.log(`CodeReviewConfig ${id} (ObjectId: ${objectIdToDelete.toHexString()}) deleted successfully.`);
		} catch (error) {
			// Overall Error Handling
			// Log the error with context and re-throw it to be handled by the caller.
			console.error(`MongoCodeReviewService.deleteCodeReviewConfig: Error deleting config "${id}":`, error);
			throw error;
		}
	}

	private _getMRCacheDocId(projectId: string | number, mrIid: number): string {
		const safeProjectId = typeof projectId === 'string' ? projectId.replace(/[^a-zA-Z0-9_-]/g, '_') : projectId;
		return `proj_${safeProjectId}_mr_${mrIid}`;
	}

	async getMergeRequestReviewCache(projectId: string | number, mrIid: number): Promise<CodeReviewFingerprintCache> {
		try {
			const mrDocId = this._getMRCacheDocId(projectId, mrIid);
			console.debug(`MongoCodeReviewService: Loading merge request review cache object for docId: ${mrDocId}`);

			// In MongoDB, the document ID is stored in the _id field.
			// We are using the generated string mrDocId as the _id.
			const doc = await this.mergeRequestReviewCacheCollection.findOne({ _id: mrDocId });

			if (!doc) {
				console.debug(`MongoCodeReviewService: MR cache document not found for docId: ${mrDocId}, returning default empty cache.`);
				return EMPTY_CACHE();
			}

			// In MongoDB, findOne returns the document directly, which is the data itself.
			const data = doc;

			// Validate structure: lastUpdated is number, fingerprints is ARRAY
			if (data && typeof data.lastUpdated === 'number' && Array.isArray(data.fingerprints)) {
				console.debug(
					`MongoCodeReviewService: MR cache object loaded for docId: ${mrDocId}. Last updated: ${new Date(
						data.lastUpdated,
					).toISOString()}, Count: ${data.fingerprints.length}`,
				);
				// Convert stored array back to a Set
				const fingerprintSet = new Set<string>(data.fingerprints);
				const hashes = data.hashes
					? new Map<string, Set<string>>(Object.entries(data.hashes).map(([key, value]) => [key, new Set(value as string[])]))
					: new Map<string, Set<string>>();
				return {
					lastUpdated: data.lastUpdated,
					fingerprints: fingerprintSet,
					hashes,
				};
			}
			console.warn(
				`MongoCodeReviewService: MR cache document for docId: ${mrDocId} exists but has invalid format. Expected lastUpdated: number, fingerprints: array. Data: ${JSON.stringify(
					data,
				)}. Returning default empty cache.`,
			);
			return EMPTY_CACHE();
		} catch (error) {
			// Attempt to get mrDocId for logging, it might not be available if _getMRCacheDocId itself failed, though unlikely here.
			let mrDocIdForError = 'unknown';
			try {
				mrDocIdForError = this._getMRCacheDocId(projectId, mrIid);
			} catch {
				// Ignore error during error handling for docId retrieval
			}
			console.error(`MongoCodeReviewService.getMergeRequestReviewCache: Error getting cache for docId "${mrDocIdForError}":`, error);
			return EMPTY_CACHE(); // Return empty cache on error as per Firestore's behavior
		}
	}

	async updateMergeRequestReviewCache(projectId: string | number, mrIid: number, cacheObject: CodeReviewFingerprintCache): Promise<void> {
		const mrDocId = this._getMRCacheDocId(projectId, mrIid);
		const nowMillis = Date.now();

		console.debug(`MongoCodeReviewService.updateMergeRequestReviewCache: Updating cache for docId: ${mrDocId}`, {
			projectId,
			mrIid,
			fingerprintCount: cacheObject.fingerprints.size,
			hashKeysCount: cacheObject.hashes?.size ?? 0,
		});

		try {
			// Convert Set<string> to Array<string> for fingerprints
			const fingerprintsArray = Array.from(cacheObject.fingerprints);

			// Convert Map<string, Set<string>> to Record<string, string[]> for hashes
			const hashesObject: Record<string, string[]> = {};
			if (cacheObject.hashes && cacheObject.hashes.size > 0) {
				for (const [key, valueSet] of cacheObject.hashes.entries()) {
					hashesObject[key] = Array.from(valueSet);
				}
			}

			// Prepare the object to be saved to MongoDB
			const dataToSet = {
				lastUpdated: nowMillis,
				fingerprints: fingerprintsArray,
				hashes: hashesObject, // Store as an object
			};

			console.debug(`MongoCodeReviewService.updateMergeRequestReviewCache: Data to set for docId ${mrDocId}:`, {
				lastUpdated: new Date(dataToSet.lastUpdated).toISOString(),
				fingerprintsCount: dataToSet.fingerprints.length,
				hashesKeys: Object.keys(dataToSet.hashes).length,
			});

			// Use updateOne with upsert: true to create the document if it doesn't exist,
			// or update it if it does. This is similar to Firestore's set() behavior.
			const result = await this.mergeRequestReviewCacheCollection.updateOne(
				{ _id: mrDocId }, // Filter by document ID
				{ $set: dataToSet }, // Data to set/update
				{ upsert: true }, // Option to insert if not found
			);

			if (result.upsertedCount > 0) {
				console.log(`MongoCodeReviewService.updateMergeRequestReviewCache: Cache created successfully for docId: ${mrDocId}`);
			} else if (result.modifiedCount > 0) {
				console.log(`MongoCodeReviewService.updateMergeRequestReviewCache: Cache updated successfully for docId: ${mrDocId}`);
			} else if (result.matchedCount > 0 && result.modifiedCount === 0) {
				console.log(`MongoCodeReviewService.updateMergeRequestReviewCache: Cache for docId: ${mrDocId} matched but was not modified (data likely the same).`);
			} else {
				// This case should ideally not be reached if upsert is true and there's no error.
				// If matchedCount is 0 and upsertedCount is 0, it might indicate an issue.
				console.warn(
					`MongoCodeReviewService.updateMergeRequestReviewCache: Cache update operation for docId ${mrDocId} resulted in no changes. Matched: ${result.matchedCount}, Modified: ${result.modifiedCount}, Upserted: ${result.upsertedId}`,
				);
			}
		} catch (error) {
			console.error(`MongoCodeReviewService.updateMergeRequestReviewCache: Error updating cache for docId "${mrDocId}":`, error);
			// Optionally, re-throw the error if the caller needs to handle it,
			// or handle it gracefully here depending on application requirements.
			// For consistency with getMergeRequestReviewCache which returns EMPTY_CACHE on error,
			// this method (returning void) will just log the error.
			// If specific error handling is needed by callers, consider re-throwing.
			throw error; // Re-throwing to allow callers to handle if necessary
		}
	}
}
