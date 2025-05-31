import { MongoClient, type Db } from 'mongodb';
import { runPromptsServiceTests } from '#prompts/promptsService.test';
import { MongoPromptsService } from './MongoPromptsService';

describe('MongoPromptsService', () => {
	let client: MongoClient;
	let db: Db;

	const beforeEachHook = async () => {
		client = new MongoClient(process.env.MONGO_URI_TEST || 'mongodb://localhost:27017');
		const dbName = process.env.MONGO_DB_NAME_TEST || 'typedai_test_db_prompts';
		try {
			await client.connect();
			db = client.db(dbName);
			await db.collection('prompts').deleteMany({});
			await db.collection('promptRevisions').deleteMany({});
		} catch (error: any) {
			console.error(`Error during MongoDB test cleanup in DB ${dbName}:`, error);
			if (client && client.topology && client.topology.isConnected()) {
				await client.close();
			}
			throw error; 
		}
	};

	const afterEachHook = async () => {
		if (client && client.topology && client.topology.isConnected()) {
			await client.close();
		}
	};

	runPromptsServiceTests(() => new MongoPromptsService(db), beforeEachHook, afterEachHook);
});
