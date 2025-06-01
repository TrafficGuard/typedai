import { MongoClient, type Db } from 'mongodb';
import { runCodeReviewServiceTests } from '../../swe/codeReview/codeReviewService.test';
import { MongoCodeReviewService } from './MongoCodeReviewService';
import { setupConditionalLoggerOutput } from '../../test/testUtils';

describe('MongoCodeReviewService', () => {
	setupConditionalLoggerOutput();

	let client: MongoClient;
	let db: Db;

	const MONGODB_URI = process.env.TEST_MONGO_URI || 'mongodb://localhost:27017';
	const TEST_DB_NAME = `test_typedai_codereviewservice_${Date.now()}`;

	beforeAll(async () => {
		client = new MongoClient(MONGODB_URI);
		await client.connect();
		db = client.db(TEST_DB_NAME);
	});

	afterAll(async () => {
		if (db) {
			await db.dropDatabase();
		}
		if (client) {
			await client.close();
		}
	});

	const createService = () => {
		if (!db) {
			throw new Error('MongoDB db instance not initialized. Ensure MongoDB is running and accessible.');
		}
		return new MongoCodeReviewService(db);
	};

	const resetMongoCollections = async () => {
		if (db) {
			try {
				// These collection names are assumed based on the service's responsibilities.
				// Adjust if the actual implementation uses different names.
				await db.collection('codeReviewConfigs').deleteMany({});
				await db.collection('mergeRequestReviewCaches').deleteMany({});
			} catch (error) {
				// Log error but don't necessarily fail the test setup here,
				// as the service might not have created collections yet.
				// The tests themselves will fail if operations on non-existent/problematic collections occur.
				console.warn('Warning during resetMongoCollections (collections might not exist yet):', error);
			}
		}
	};

	runCodeReviewServiceTests(createService, {
		beforeEach: resetMongoCollections,
		afterEach: resetMongoCollections,
	});
});
