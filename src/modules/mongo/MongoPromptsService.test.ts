import { MongoClient } from 'mongodb';
import { runPromptsServiceTests } from '#prompts/promptsService.test';
import { MongoPromptsService } from './MongoPromptsService';

describe('MongoPromptsService', () => {
	// const TEST_MONGO_URI = process.env.MONGO_URI_TEST || 'mongodb://localhost:27017';
	// const TEST_DB_NAME = process.env.MONGO_DB_NAME_TEST || 'typedai_test_db_prompts';

	const beforeEachHook = async () => {
		// Ensure MongoClient is imported if not already: import { MongoClient } from 'mongodb';
		const client = new MongoClient(process.env.MONGO_URI_TEST || 'mongodb://localhost:27017');
		const dbName = process.env.MONGO_DB_NAME_TEST || 'typedai_test_db_prompts';
		try {
			await client.connect();
			const db = client.db(dbName);
			await db.collection('prompts').deleteMany({});
			await db.collection('promptRevisions').deleteMany({}); // Ensure this matches the service's collection name
		} catch (error: any) {
			console.error(`Error during MongoDB test cleanup in DB ${dbName}:`, error);
			// Optionally rethrow or handle if critical for test suite stability
		} finally {
			await client.close();
		}
	};

	runPromptsServiceTests(() => new MongoPromptsService(), beforeEachHook);
});
