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

	// Recursively delete user sub-collections to avoid orphan documents
	const db = firestoreDb();
	const usersSnap = await db.collection(USERS_COLLECTION).get();

	for (const userDoc of usersSnap.docs) {
		const batch = db.batch();

		// Delete codeTasks sub-collection
		const codeTasksSnap = await userDoc.ref.collection('codeTasks').get();
		codeTasksSnap.forEach((doc) => batch.delete(doc.ref));

		// Delete codeTaskPresets sub-collection
		const presetsSnap = await userDoc.ref.collection('codeTaskPresets').get();
		presetsSnap.forEach((doc) => batch.delete(doc.ref));

		// Finally delete the user doc itself
		batch.delete(userDoc.ref);

		await batch.commit();
	}
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
