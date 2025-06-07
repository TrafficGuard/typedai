import { Firestore } from '@google-cloud/firestore';
import { envVar } from '#utils/env-var';

let db: Firestore;

export function firestoreDb(): Firestore {
	const isEmulator = !!process.env.FIRESTORE_EMULATOR_HOST;
	db ??= new Firestore({
		projectId: isEmulator ? 'demo-typedai' : envVar('GCLOUD_PROJECT'),
		// When using the emulator, always target the '(default)' database,
		// as this is what testEnv.clearFirestore() typically clears.
		// Otherwise, respect the DATABASE_NAME environment variable.
		databaseId: isEmulator ? '(default)' : process.env.DATABASE_NAME,
		ignoreUndefinedProperties: true,
	});
	return db;
}
