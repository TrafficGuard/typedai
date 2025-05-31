import { MongoClient } from 'mongodb';
import { runPromptsServiceTests } from '#prompts/promptsService.test';
import { MongoPromptsService } from './MongoPromptsService';

describe('MongoPromptsService', () => {
	// const TEST_MONGO_URI = process.env.MONGO_URI_TEST || 'mongodb://localhost:27017';
	// const TEST_DB_NAME = process.env.MONGO_DB_NAME_TEST || 'typedai_test_db_prompts';

	const beforeEachHook = async () => {
		const client = new MongoClient(process.env.MONGO_URI_TEST || 'mongodb://localhost:27017');
		try {
			await client.connect();
			const db = client.db(process.env.MONGO_DB_NAME_TEST || 'typedai_test_db_prompts');
			await db.collection('prompts').deleteMany({}); // Clear the collection
		} catch (error: any) {
			console.error('Error during MongoDB test cleanup:', error);
			// Optionally rethrow or handle if critical, but for tests, logging might be enough
		} finally {
			await client.close();
		}
	};

	runPromptsServiceTests(() => new MongoPromptsService(), beforeEachHook);
});
import { MongoClient } from 'mongodb';
import { runPromptsServiceTests } from '#prompts/promptsService.test';
import { MongoPromptsService } from './MongoPromptsService';

describe('MongoPromptsService', () => {
	// const TEST_MONGO_URI = process.env.MONGO_URI_TEST || 'mongodb://localhost:27017';
	// const TEST_DB_NAME = process.env.MONGO_DB_NAME_TEST || 'typedai_test_db_prompts';

	const beforeEachHook = async () => {
		const client = new MongoClient(process.env.MONGO_URI_TEST || 'mongodb://localhost:27017');
		try {
			await client.connect();
			const db = client.db(process.env.MONGO_DB_NAME_TEST || 'typedai_test_db_prompts');
			await db.collection('prompts').deleteMany({}); // Clear the collection
		} catch (error: any) {
			console.error('Error during MongoDB test cleanup:', error);
			// Optionally rethrow or handle if critical, but for tests, logging might be enough
		} finally {
			await client.close();
		}
	};

	runPromptsServiceTests(() => new MongoPromptsService(), beforeEachHook);
});
