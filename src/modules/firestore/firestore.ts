import { Firestore } from '@google-cloud/firestore';
import { envVar } from '#utils/env-var';

let db: Firestore;

export function firestoreDb(): Firestore {
	db ??= new Firestore({
		projectId: process.env.FIRESTORE_EMULATOR_HOST ? 'demo-typedai' : envVar('GCLOUD_PROJECT'),
		databaseId: process.env.FIRESTORE_DATABASE,
		ignoreUndefinedProperties: true,
	});
	return db;
}
