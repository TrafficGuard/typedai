import { DocumentSnapshot, FieldValue, Firestore, Timestamp } from '@google-cloud/firestore';
import { logger } from '#o11y/logger';
import { CodeReviewConfig, EMPTY_CACHE } from '#swe/codeReview/codeReviewModel';
import { CodeReviewService } from '#swe/codeReview/codeReviewService';
import { firestoreDb } from './firestore';

/**
 * Represents the structure of the entire Firestore document
 * used for caching clean code reviews for a Merge Request.
 */
export type MergeRequestFingerprintCache = {
	/** Unix timestamp (milliseconds) of the last update */
	lastUpdated: number;
	/** Set containing the unique fingerprint hashes marked as clean */
	fingerprints: Set<string>;
};

export interface ReviewCacheLoaderSaver {
	/** Loads the entire fingerprint cache map for a given Merge Request. */
	getMergeRequestReviewCache(projectId: string | number, mrIid: number): Promise<MergeRequestFingerprintCache>;

	/** Saves/updates the entire fingerprint cache map for a given Merge Request. */
	updateMergeRequestReviewCache(projectId: string | number, mrIid: number, fingerprintsToSave: MergeRequestFingerprintCache): Promise<void>;

	/** Optional: Method to clean up expired fingerprints within an MR document */
	cleanupExpiredFingerprints(projectId: string | number, mrIid: number): Promise<void>;
}

export class FirestoreCodeReviewService implements CodeReviewService {
	private db: Firestore = firestoreDb();
	private mrReviewCacheCollectionName = 'MergeRequestReviewCache';

	async getCodeReviewConfig(id: string): Promise<CodeReviewConfig | null> {
		try {
			const docRef = this.db.doc(`CodeReviewConfig/${id}`);
			const docSnap: DocumentSnapshot = await docRef.get();
			if (!docSnap.exists) {
				return null;
			}
			return { id: docSnap.id, ...docSnap.data() } as CodeReviewConfig;
		} catch (error) {
			logger.error(error, 'Error getting code review config');
			throw error;
		}
	}

	async listCodeReviewConfigs(): Promise<CodeReviewConfig[]> {
		try {
			const querySnapshot = await this.db.collection('CodeReviewConfig').get();
			return querySnapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }) as CodeReviewConfig);
		} catch (error) {
			logger.error(error, 'Error listing code review configs');
			throw error;
		}
	}

	async createCodeReviewConfig(config: Omit<CodeReviewConfig, 'id'>): Promise<string> {
		try {
			const docRef = await this.db.collection('CodeReviewConfig').add(config);
			return docRef.id;
		} catch (error) {
			logger.error(error, 'Error creating code review config');
			throw error;
		}
	}

	async updateCodeReviewConfig(id: string, config: Partial<CodeReviewConfig>): Promise<void> {
		try {
			const docRef = this.db.doc(`CodeReviewConfig/${id}`);
			await docRef.update(config);
		} catch (error) {
			logger.error(error, 'Error updating code review config');
			throw error;
		}
	}

	async deleteCodeReviewConfig(id: string): Promise<void> {
		try {
			const docRef = this.db.doc(`CodeReviewConfig/${id}`);
			await docRef.delete();
		} catch (error) {
			logger.error(error, 'Error deleting code review config');
			throw error;
		}
	}

	// --- Helper to generate MR Document ID ---
	private getMRCacheDocId(projectId: string | number, mrIid: number): string {
		const safeProjectId = typeof projectId === 'string' ? projectId.replace(/[^a-zA-Z0-9_-]/g, '_') : projectId;
		return `proj_${safeProjectId}_mr_${mrIid}`;
	}

	/**
	 * Retrieves the entire cache object for a specific Merge Request.
	 * Converts the stored 'fingerprints' array back into a Set.
	 * @returns The cache object with fingerprints as a Set, or a default empty cache object.
	 */
	async getMergeRequestReviewCache(projectId: string | number, mrIid: number): Promise<MergeRequestFingerprintCache> {
		const mrDocId = this.getMRCacheDocId(projectId, mrIid);
		logger.debug({ mrDocId }, 'Loading merge request review cache object');
		try {
			const docRef = this.db.collection(this.mrReviewCacheCollectionName).doc(mrDocId);
			const docSnap = await docRef.get();

			if (!docSnap.exists) {
				logger.debug({ mrDocId }, 'MR cache document not found, returning default empty cache.');
				return EMPTY_CACHE(); // Use function to get fresh empty object
			}

			const data = docSnap.data();

			// Validate structure: lastUpdated is number, fingerprints is ARRAY
			if (data && typeof data.lastUpdated === 'number' && Array.isArray(data.fingerprints)) {
				logger.debug({ mrDocId, lastUpdated: new Date(data.lastUpdated).toISOString(), count: data.fingerprints.length }, 'MR cache object loaded.');
				// Convert stored array back to a Set
				const fingerprintSet = new Set<string>(data.fingerprints);
				return {
					lastUpdated: data.lastUpdated,
					fingerprints: fingerprintSet,
				};
			}
			logger.warn(
				{ mrDocId, data },
				'MR cache document exists but has invalid format (expected lastUpdated: number, fingerprints: array), returning default empty cache.',
			);
			return EMPTY_CACHE(); // Use function
		} catch (error) {
			logger.error(error, { mrDocId }, 'Error getting merge request review cache, returning default empty cache.');
			return EMPTY_CACHE(); // Use function
		}
	}

	/**
	 * Saves the entire provided cache object to the MR cache document,
	 * first converting the 'fingerprints' Set to an Array and updating 'lastUpdated'.
	 * @param cacheObject The cache object containing the fingerprints Set.
	 */
	async updateMergeRequestReviewCache(projectId: string | number, mrIid: number, cacheObject: MergeRequestFingerprintCache): Promise<void> {
		const mrDocId = this.getMRCacheDocId(projectId, mrIid);
		const nowMillis = Date.now();

		// Convert Set to Array for Firestore storage
		const fingerprintsArray = Array.from(cacheObject.fingerprints);

		// Prepare the object to be saved to Firestore
		const dataToSet = {
			lastUpdated: nowMillis, // Update timestamp
			fingerprints: fingerprintsArray, // Save as Array
		};

		logger.debug(
			{ mrDocId, fingerprintCount: fingerprintsArray.length, lastUpdated: new Date(nowMillis).toISOString() },
			'Saving merge request review cache object (fingerprints as array)',
		);
		try {
			const docRef = this.db.collection(this.mrReviewCacheCollectionName).doc(mrDocId);
			// Use set() to overwrite the document with the new structure
			await docRef.set(dataToSet);
			logger.debug({ mrDocId }, 'Merge request review cache object saved successfully.');
		} catch (error) {
			logger.error(error, { mrDocId }, 'Error saving merge request review cache object');
		}
	}
}
