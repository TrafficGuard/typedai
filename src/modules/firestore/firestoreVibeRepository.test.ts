import { type RulesTestEnvironment, initializeTestEnvironment } from '@firebase/rules-unit-testing';
import sinon from 'sinon';
import { logger } from '#o11y/logger';
import { runVibeRepositoryTests } from '#vibe/vibeRepository.test';
import { firestoreDb } from './firestore'; // To potentially clear data
import { FirestoreVibeRepository } from './firestoreVibeRepository';

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
	await testEnv?.clearFirestore();
};

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
		() => new FirestoreVibeRepository(),
		async () => {
			await clearFirestoreData();
		},
		async () => {},
	);

	// Additional tests must only be added in the shared VibeRepository tests at src/vibe/vibeRepository.test.ts
});
