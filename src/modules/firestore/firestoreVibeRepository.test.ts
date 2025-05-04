import { type RulesTestEnvironment, initializeTestEnvironment } from '@firebase/rules-unit-testing';
import sinon from 'sinon';
import { logger } from '#o11y/logger';
// Removed User import
// Removed userContext import
import { runVibeRepositoryTests } from '#vibe/vibeRepository.test';
import { firestoreDb } from './firestore'; // To potentially clear data
import { FirestoreVibeRepository } from './firestoreVibeRepository';

// Removed mock user constants

let testEnv: RulesTestEnvironment;
// Removed currentUserStub variable

const setupFirestore = async () => {
	try {
		testEnv = await initializeTestEnvironment({
			projectId: 'demo-typedai', // Use a dummy project ID
			firestore: {
				host: process.env.FIRESTORE_EMULATOR_HOST?.split(':')[0] || '127.0.0.1',
				port: Number.parseInt(process.env.FIRESTORE_EMULATOR_HOST?.split(':')[1] || '8243', 10),
				// rules: readFileSync('firestore.rules', 'utf8'), // Add rules if needed
			},
		});
		// No stubbing needed here anymore
	} catch (error) {
		logger.error(error, 'Failed to initialize Firebase test environment. Is the emulator running?');
		throw error; // Re-throw after logging
	}
};

const teardownFirestore = async () => {
	// No stub teardown needed
	if (testEnv) {
		await testEnv.cleanup();
	}
};

const clearFirestoreData = async () => {
	if (testEnv) {
		await testEnv.clearFirestore();
	}
	// Alternative: Direct deletion if clearFirestore is insufficient/slow
	// try {
	// 	const db = firestoreDb();
	// 	const users = ['test-user-repo-tests', 'other-user-repo-tests']; // Add any other users used in tests
	// 	for (const userId of users) {
	// 		const collections = ['vibeSessions', 'vibePresets'];
	// 		for (const coll of collections) {
	// 			const snapshot = await db.collection('users').doc(userId).collection(coll).get();
	// 			const batch = db.batch();
	// 			snapshot.docs.forEach(doc => batch.delete(doc.ref));
	// 			await batch.commit();
	// 		}
	// 	}
	// } catch (error) {
	// 	logger.error(error, "Error clearing Firestore data directly.");
	// }
};

// Configure and run the shared tests
describe('FirestoreVibeRepository', () => {
	// Setup and teardown the emulator environment once for the suite
	before(async () => {
		await setupFirestore();
	});

	after(async () => {
		await teardownFirestore();
	});

	// Run the shared tests, providing the factory and hooks
	runVibeRepositoryTests(
		() => new FirestoreVibeRepository(), // Factory to create the Firestore implementation
		async () => {
			// beforeEachHook
			// Before each test in the shared suite, clear data
			await clearFirestoreData();
			// No stub management needed here anymore
		},
		async () => {
			// afterEachHook
			// No specific cleanup needed here
		},
		// Removed currentUserStub, testUser, otherUser arguments
	);

	// Add Firestore-specific tests here if needed
	// e.g., testing timestamp conversion, specific error handling
});
