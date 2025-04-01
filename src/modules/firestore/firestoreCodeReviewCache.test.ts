import { Firestore } from '@google-cloud/firestore'; // Keep Timestamp if used by other parts, not strictly needed for cache tests now
import { expect } from 'chai';
import { firestoreDb } from '#firestore/firestore'; // Adjust path
import { FirestoreCodeReviewService, MergeRequestFingerprintCache } from '#firestore/firestoreCodeReviewService';
import { resetFirestoreEmulator } from '#firestore/resetFirestoreEmulator'; // Adjust path
import { EMPTY_CACHE } from '#swe/codeReview/codeReviewModel'; // Adjust path

// Helper for delaying execution (useful if needed for future tests, though not for current logic)
// const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

describe('FirestoreCodeReviewService (Set Cache Methods)', () => {
	let service: FirestoreCodeReviewService;
	let db: Firestore;

	// --- Test Data ---
	const PROJECT_ID_NUM = 123;
	const PROJECT_ID_STR = 'group/project-name';
	const MR_IID_1 = 101;
	const MR_IID_2 = 102;
	const FINGERPRINT_1 = 'fp_sha256_abcdef123456';
	const FINGERPRINT_2 = 'fp_sha256_fedcba654321';
	const FINGERPRINT_3 = 'fp_sha256_aaabbbcccddd';

	// Helper to get the expected doc ID
	const getMRCacheDocId = (projectId: string | number, mrIid: number): string => {
		const safeProjectId = typeof projectId === 'string' ? projectId.replace(/[^a-zA-Z0-9_-]/g, '_') : projectId;
		return `proj_${safeProjectId}_mr_${mrIid}`;
	};

	beforeEach(async () => {
		db = firestoreDb(); // Get Firestore instance connected to emulator
		service = new FirestoreCodeReviewService(); // Assumes service uses firestoreDb()
		await resetFirestoreEmulator(); // Reset data before each test
	});

	describe('getMergeRequestReviewCache', () => {
		it('should return the default empty cache object if the document does not exist', async () => {
			const cache = await service.getMergeRequestReviewCache(PROJECT_ID_NUM, MR_IID_1);
			// Use deep equal for comparison against the default structure
			expect(cache).to.deep.equal(EMPTY_CACHE()); // Call the function
			expect(cache.fingerprints).to.be.instanceOf(Set); // Extra check
		});

		it('should return the cache object with fingerprints Set if the document exists and is valid', async () => {
			// Manually create a document with data (fingerprints as ARRAY)
			const docId = getMRCacheDocId(PROJECT_ID_NUM, MR_IID_1);
			const nowMillis = Date.now();
			// Data as it would be stored in Firestore
			const storedData = {
				lastUpdated: nowMillis,
				fingerprints: [FINGERPRINT_1, FINGERPRINT_2], // Stored as Array
			};
			await db.collection('MergeRequestReviewCache').doc(docId).set(storedData);

			// Get via service
			const cache = await service.getMergeRequestReviewCache(PROJECT_ID_NUM, MR_IID_1);

			// Assert structure and content returned by the service
			expect(cache).to.be.an('object');
			expect(cache.lastUpdated).to.equal(nowMillis);
			expect(cache.fingerprints).to.be.instanceOf(Set); // Should be converted to Set
			expect(cache.fingerprints.size).to.equal(2);
			expect(cache.fingerprints.has(FINGERPRINT_1)).to.be.true;
			expect(cache.fingerprints.has(FINGERPRINT_2)).to.be.true;
		});

		it('should return the default empty cache object if fingerprints field is not an array in Firestore', async () => {
			const docId = getMRCacheDocId(PROJECT_ID_NUM, MR_IID_1);
			// Store invalid data
			await db.collection('MergeRequestReviewCache').doc(docId).set({
				lastUpdated: Date.now(),
				fingerprints: 'not_an_array', // Invalid type for reading
			});
			const cache = await service.getMergeRequestReviewCache(PROJECT_ID_NUM, MR_IID_1);
			// Expect the default empty object
			expect(cache).to.deep.equal(EMPTY_CACHE());
		});

		it('should return the default empty cache object if lastUpdated field is missing or not a number in Firestore', async () => {
			const docId = getMRCacheDocId(PROJECT_ID_NUM, MR_IID_1);
			// Store invalid data
			await db
				.collection('MergeRequestReviewCache')
				.doc(docId)
				.set({
					// lastUpdated: missing
					fingerprints: [FINGERPRINT_1],
				});
			const cache = await service.getMergeRequestReviewCache(PROJECT_ID_NUM, MR_IID_1);
			// Expect the default empty object
			expect(cache).to.deep.equal(EMPTY_CACHE());
		});

		it('should handle an empty fingerprints array correctly', async () => {
			const docId = getMRCacheDocId(PROJECT_ID_NUM, MR_IID_1);
			const nowMillis = Date.now();
			const storedData = {
				lastUpdated: nowMillis,
				fingerprints: [], // Empty Array stored
			};
			await db.collection('MergeRequestReviewCache').doc(docId).set(storedData);

			const cache = await service.getMergeRequestReviewCache(PROJECT_ID_NUM, MR_IID_1);

			expect(cache.lastUpdated).to.equal(nowMillis);
			expect(cache.fingerprints).to.be.instanceOf(Set);
			expect(cache.fingerprints.size).to.equal(0);
		});
	});

	describe('updateMergeRequestReviewCache', () => {
		it('should create a new document with fingerprints as Array and updated lastUpdated', async () => {
			const originalMillis = Date.now() - 10000; // An older timestamp
			// Prepare object with a Set to pass to the service
			const dataToSave: MergeRequestFingerprintCache = {
				lastUpdated: originalMillis, // This value will be ignored/overwritten by the service
				fingerprints: new Set([FINGERPRINT_1, FINGERPRINT_2]),
			};
			const callTime = Date.now(); // Time right before the service call

			// Call the service method
			await service.updateMergeRequestReviewCache(PROJECT_ID_NUM, MR_IID_1, dataToSave);

			// Verify directly in Firestore
			const docId = getMRCacheDocId(PROJECT_ID_NUM, MR_IID_1);
			const docSnap = await db.collection('MergeRequestReviewCache').doc(docId).get();
			expect(docSnap.exists, 'Document should be created').to.be.true;
			const savedData = docSnap.data();

			// Check fingerprints (should be stored as Array)
			expect(savedData?.fingerprints, 'fingerprints field should be an array').to.be.an('array');
			// Use deep members for array comparison regardless of order
			expect(savedData?.fingerprints).to.have.deep.members([FINGERPRINT_1, FINGERPRINT_2]);
			expect(savedData?.fingerprints.length).to.equal(2);

			// Check lastUpdated timestamp (should be updated by the service)
			expect(savedData?.lastUpdated, 'lastUpdated field should be a number').to.be.a('number');
			expect(savedData?.lastUpdated).to.be.closeTo(callTime, 5000); // Check if recent
			expect(savedData?.lastUpdated).to.be.greaterThan(originalMillis); // Check it was definitely updated
		});

		it('should overwrite an existing document with fingerprints as Array and updated lastUpdated', async () => {
			// Setup initial state in Firestore
			const docId = getMRCacheDocId(PROJECT_ID_STR, MR_IID_1); // Use string project ID
			const oldMillis = Date.now() - 60000;
			await db
				.collection('MergeRequestReviewCache')
				.doc(docId)
				.set({
					lastUpdated: oldMillis,
					fingerprints: [FINGERPRINT_1], // Initial state as Array with FP1
				});

			// Data to save (passing a Set with only FP2)
			const newData: MergeRequestFingerprintCache = {
				lastUpdated: oldMillis, // Old timestamp, will be updated by service
				fingerprints: new Set([FINGERPRINT_2]), // Only FP2 now
			};
			const callTime = Date.now();

			// Call service to update
			await service.updateMergeRequestReviewCache(PROJECT_ID_STR, MR_IID_1, newData);

			// Verify final state in Firestore
			const docSnap = await db.collection('MergeRequestReviewCache').doc(docId).get();
			const savedData = docSnap.data();

			// Check fingerprints (should be overwritten array containing only FP2)
			expect(savedData?.fingerprints).to.be.an('array');
			expect(savedData?.fingerprints).to.deep.equal([FINGERPRINT_2]); // Check exact content and order (since it's single element)

			// Check lastUpdated timestamp (should be updated)
			expect(savedData?.lastUpdated).to.be.a('number');
			expect(savedData?.lastUpdated).to.be.closeTo(callTime, 5000);
			expect(savedData?.lastUpdated).to.be.greaterThan(oldMillis);
		});

		it('should save an empty fingerprints Array if the input Set is empty', async () => {
			const originalMillis = Date.now() - 10000;
			// Prepare object with an empty Set
			const dataToSave: MergeRequestFingerprintCache = {
				lastUpdated: originalMillis, // Will be overwritten
				fingerprints: new Set<string>(), // Empty Set
			};
			const callTime = Date.now();

			await service.updateMergeRequestReviewCache(PROJECT_ID_NUM, MR_IID_1, dataToSave);

			// Verify directly in Firestore
			const docId = getMRCacheDocId(PROJECT_ID_NUM, MR_IID_1);
			const docSnap = await db.collection('MergeRequestReviewCache').doc(docId).get();
			const savedData = docSnap.data();

			// Check fingerprints (should be stored as empty Array)
			expect(savedData?.fingerprints).to.be.an('array').that.is.empty;

			// Check lastUpdated timestamp (should still be updated)
			expect(savedData?.lastUpdated).to.be.a('number');
			expect(savedData?.lastUpdated).to.be.closeTo(callTime, 5000);
		});

		it('should handle different MRs in separate documents correctly', async () => {
			const data1: MergeRequestFingerprintCache = { lastUpdated: 0, fingerprints: new Set([FINGERPRINT_1]) };
			const data2: MergeRequestFingerprintCache = { lastUpdated: 0, fingerprints: new Set([FINGERPRINT_2]) };
			const callTime = Date.now();

			// Update both MRs
			await service.updateMergeRequestReviewCache(PROJECT_ID_NUM, MR_IID_1, data1);
			await service.updateMergeRequestReviewCache(PROJECT_ID_NUM, MR_IID_2, data2);

			// Verify MR1
			const docSnap1 = await db.collection('MergeRequestReviewCache').doc(getMRCacheDocId(PROJECT_ID_NUM, MR_IID_1)).get();
			expect(docSnap1.data()?.fingerprints).to.deep.equal([FINGERPRINT_1]);
			expect(docSnap1.data()?.lastUpdated).to.be.closeTo(callTime, 5000);

			// Verify MR2
			const docSnap2 = await db.collection('MergeRequestReviewCache').doc(getMRCacheDocId(PROJECT_ID_NUM, MR_IID_2)).get();
			expect(docSnap2.data()?.fingerprints).to.deep.equal([FINGERPRINT_2]);
			expect(docSnap2.data()?.lastUpdated).to.be.closeTo(callTime, 5000);
		});
	});
});
