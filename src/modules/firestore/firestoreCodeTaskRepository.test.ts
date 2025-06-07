import { type RulesTestEnvironment, initializeTestEnvironment } from '@firebase/rules-unit-testing';
import sinon from 'sinon';
import { runCodeTaskRepositoryTests } from '#codeTask/codeTaskRepository.test';
import { logger } from '#o11y/logger';
import { setupConditionalLoggerOutput } from '#test/testUtils';
import { firestoreDb } from './firestore'; // To potentially clear data
import { FirestoreCodeTaskRepository } from './firestoreCodeTaskRepository';
import {USERS_COLLECTION} from "#firestore/firestoreUserService";

let testEnv: RulesTestEnvironment;

const setupFirestore = async () => {
	try {
		testEnv = await initializeTestEnvironment({
			projectId: 'demo-typedai', // Use a dummy project ID
			firestore: {
				host: process.env.FIRESTORE_EMULATOR_HOST?.split(':')[0] || '127.0.0.1',
				port: Number.parseInt(process.env.FIRESTORE_EMULATOR_HOST?.split(':')[1] || '8243', 10),
			},
		});
	} catch (error) {
		logger.error(error, 'Failed to initialize Firebase test environment. Is the emulator running?');
		throw error;
	}
};

const teardownFirestore = async () => {
	await testEnv?.cleanup();
};

const clearFirestoreData = async () => {
	// Clear top-level collections first
	await testEnv?.clearFirestore();

	// testEnv.clearFirestore() should handle all data, including subcollections.
	// The manual deletion loop that was here is usually redundant if testEnv.clearFirestore()
	// is effective and the Firestore instance used by the repository is correctly
	// pointed to the emulator.
	// If tests still fail due to persistent data after this change,
	// it strongly suggests that firestoreDb() might not be providing the emulated
	// Firestore instance that testEnv manages, or there's a deeper issue with
	// how the emulator or test environment is being handled.
};

describe.only('FirestoreCodeTaskRepository', () => {
	setupConditionalLoggerOutput();
	// Setup and teardown the emulator environment once for the suite
	before(async () => {
		await setupFirestore();
	});
	after(async () => {
		await teardownFirestore();
	});

	// Run the shared tests, providing the factory and hooks
	runCodeTaskRepositoryTests(
		() => new FirestoreCodeTaskRepository(),
		async () => {
			await clearFirestoreData();
		},
		async () => {},
	);

	// Additional tests must only be added in the shared CodeTaskRepository tests at src/codeTask/codeTaskRepository.test.ts
});
