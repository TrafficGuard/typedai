import { type Db, MongoClient } from 'mongodb';
import { expect } from 'chai';
import { agentContext, agentContextStorage, createContext } from '#agent/agentContextLocalStorage';
import { initInMemoryApplicationContext } from '#app/applicationContext';
import { cacheRetry } from '#cache/cacheRetry'; // Assuming cacheRetry decorator uses the FunctionCacheService from app context
import type { CacheScope } from '#cache/functionCacheService';
import { mockLLMs } from '#llm/services/mock-llm';
import { MongoFunctionCacheService } from '#mongo/MongoFunctionCacheService';
import { logger } from '#o11y/logger'; // For potential logging, though less critical than in Firestore emulator reset
import { setupConditionalLoggerOutput } from '#test/testUtils';
import { currentUser } from '#user/userContext'; // Assuming currentUser() is available and provides user ID

// Define a TestClass similar to the one in firestoreFunctionCache.test.ts
// This class is used to test the @cacheRetry decorator's integration with the cache service.
class TestClass {
	// Method with global scope caching
	@cacheRetry({ scope: 'global' })
	async fooGlobal(num1: number, num2: number): Promise<string> {
		return (num1 + num2).toString();
	}

	// Method with user scope caching
	@cacheRetry({ scope: 'user' })
	async barUser(num1: number, num2: number): Promise<any> {
		return { num1, num2 };
	}

	// Method with agent scope caching
	@cacheRetry({ scope: 'agent' })
	async bazAgent(num1: number, num2: number): Promise<[number, number]> {
		return [num1, num2];
	}

	// Method that might throw, to test retry logic (if cacheRetry handles it, though not explicitly tested here)
	@cacheRetry({ scope: 'global' })
	async methodThatMightError(succeed: boolean): Promise<string> {
		if (!succeed) {
			throw new Error('Simulated error');
		}
		return 'success';
	}
}

describe('MongoFunctionCacheService', () => {
	setupConditionalLoggerOutput();

	let client: MongoClient;
	let db: Db;
	let cacheService: MongoFunctionCacheService;

	const MONGODB_URI = process.env.TEST_MONGO_URI || 'mongodb://localhost:27017';
	const TEST_DB_NAME = `test_typedai_func_cache_${Date.now()}`;
	const CACHE_COLLECTION_NAME = 'functionCacheEntries';

	before(async () => {
		client = new MongoClient(MONGODB_URI);
		await client.connect();
		db = client.db(TEST_DB_NAME);
	});

	after(async () => {
		if (db) {
			await db.dropDatabase();
		}
		if (client) {
			await client.close();
		}
	});

	beforeEach(async () => {
		// Clear the cache collection before each test
		if (db) {
			try {
				await db.collection(CACHE_COLLECTION_NAME).deleteMany({});
			} catch (error) {
				// Collection might not exist on first run, which is fine
				if ((error as any).codeName !== 'NamespaceNotFound') {
					logger.error(error, `Error clearing collection ${CACHE_COLLECTION_NAME}`);
					throw error;
				}
			}
		}

		cacheService = new MongoFunctionCacheService(db);

		// Set up ApplicationContext with the current cache service instance
		// This is crucial for the @cacheRetry decorator tests
		const appContext = initInMemoryApplicationContext();
		appContext.functionCacheService = cacheService;
	});

	it('should retrieve a value that exists in the cache', async () => {
		// Assumes MongoFunctionCacheService.setValue will correctly store the value
		// and MongoFunctionCacheService.getValue will retrieve it.
		// These tests will initially fail as the service methods are stubs.
		await cacheService.setValue('global', 'TestClass', 'foo', [1, 2], '3');
		const value = await cacheService.getValue('global', 'TestClass', 'foo', [1, 2]);
		expect(value).to.equal('3');
	});

	it('should return undefined for a value that does not exist in the cache', async () => {
		const value = await cacheService.getValue('global', 'TestClass', 'nonExistent', [1, 2]);
		expect(value).to.be.undefined;
	});

	it('should return undefined for a value that has expired', async () => {
		// This test assumes MongoFunctionCacheService.setValue accepts an optional ttlMs parameter
		// and that MongoDB TTL indexes are (or will be) configured for the collection.
		await (cacheService as any).setValue('global', 'TestClass', 'fooExpired', [1, 2], '3', 1); // 1 ms expiration
		await new Promise((resolve) => setTimeout(resolve, 50)); // Wait for TTL to expire (adjust time if needed for real Mongo TTL)
		const value = await cacheService.getValue('global', 'TestClass', 'fooExpired', [1, 2]);
		expect(value).to.be.undefined;
	});

	it('should set a value in the cache', async () => {
		await cacheService.setValue('global', 'TestClass', 'fooSet', [1, 2], '3');
		const value = await cacheService.getValue('global', 'TestClass', 'fooSet', [1, 2]);
		expect(value).to.equal('3');
	});

	it('should set a value with an expiration time', async () => {
		// Assumes ttlMs parameter in setValue
		await (cacheService as any).setValue('global', 'TestClass', 'fooSetWithTTL', [1, 2], '3', 1000); // 1 second expiration
		const value = await cacheService.getValue('global', 'TestClass', 'fooSetWithTTL', [1, 2]);
		expect(value).to.equal('3');
		// Further check after expiration would be good if feasible and reliable in test environment
	});

	it('should overwrite an existing value in the cache', async () => {
		await cacheService.setValue('global', 'TestClass', 'fooOverwrite', [1, 2], '3');
		await cacheService.setValue('global', 'TestClass', 'fooOverwrite', [1, 2], '4');
		const value = await cacheService.getValue('global', 'TestClass', 'fooOverwrite', [1, 2]);
		expect(value).to.equal('4');
	});

	it('should cache the result of a method using @cacheRetry decorator (global scope)', async () => {
		const testInstance = new TestClass();
		const result = await testInstance.fooGlobal(1, 2);
		expect(result).to.equal('3');

		// Verify directly from cacheService
		const cachedValue = await cacheService.getValue('global', 'TestClass', 'fooGlobal', [1, 2]);
		expect(cachedValue).to.equal('3');
	});

	it('should cache the result of a method using @cacheRetry decorator (user scope)', async () => {
		// Assumes currentUser() context is available and provides a consistent ID for the test
		const testInstance = new TestClass();
		const result = await testInstance.barUser(3, 4);
		expect(result).to.deep.equal({ num1: 3, num2: 4 });

		const userId = currentUser().id; // Make sure currentUser() is properly set up for tests
		const cachedValue = await cacheService.getValue('user', 'TestClass', 'barUser', [3, 4]);
		expect(cachedValue).to.deep.equal({ num1: 3, num2: 4 });
	});

	it('should cache the result of a method using @cacheRetry decorator (agent scope)', async () => {
		const agentId = 'test-agent-id-cache-decorator';
		const agentContextInstance = createContext({
			agentId: agentId,
			type: 'workflow',
			subtype: 'test',
			agentName: 'TestAgent',
			initialPrompt: '',
			llms: mockLLMs(),
		});

		await agentContextStorage.run(agentContextInstance, async () => {
			const testInstance = new TestClass();
			const result = await testInstance.bazAgent(5, 6);
			expect(result).to.deep.equal([5, 6]);

			const cachedValue = await cacheService.getValue('agent', 'TestClass', 'bazAgent', [5, 6]);
			expect(cachedValue).to.deep.equal([5, 6]);
		});
	});

	it('should clear all cache entries for a specific agent', async () => {
		const agentIdToClear = 'agent-to-clear-123';
		const otherAgentId = 'other-agent-456';

		const agentContextToClear = createContext({
			agentId: agentIdToClear, type: 'workflow', subtype: 'test', agentName: 'ClearAgent', initialPrompt: '', llms: mockLLMs(),
		});
		const otherAgentContext = createContext({
			agentId: otherAgentId, type: 'workflow', subtype: 'test', agentName: 'OtherAgent', initialPrompt: '', llms: mockLLMs(),
		});

		// Set items for agentToClear using decorator and direct setValue
		await agentContextStorage.run(agentContextToClear, async () => {
			await new TestClass().bazAgent(1, 2); // Cached as [agentIdToClear, TestClass, bazAgent, [1,2]]
		});
		// For this test, let's assume the service's setValue for agent scope can take an agentId or uses context.
		// The current FunctionCacheService interface doesn't specify passing agentId to setValue.
		// The firestore test uses `agentContext().agentId` inside `setValue` implicitly.
		// Let's assume our `setValue` for agent scope will also use `agentContext().agentId`.
		await agentContextStorage.run(agentContextToClear, async () => {
			await cacheService.setValue('agent', 'DirectSetClass', 'directMethod', [9,0], 'directAgentValue');
		});


		// Set item for anotherAgent
		await agentContextStorage.run(otherAgentContext, async () => {
			await new TestClass().bazAgent(10, 20); // Cached as [otherAgentId, TestClass, bazAgent, [10,20]]
		});

		// Set a global item
		await cacheService.setValue('global', 'GlobalClass', 'globalMethod', [], 'globalValue');

		const clearedCount = await cacheService.clearAgentCache(agentIdToClear);
		expect(clearedCount).to.equal(2); // bazAgent and directMethod for agentIdToClear

		// Verify items for agentIdToClear are gone
		let value1, value2;
		await agentContextStorage.run(agentContextToClear, async () => {
			value1 = await cacheService.getValue('agent', 'TestClass', 'bazAgent', [1, 2]);
			value2 = await cacheService.getValue('agent', 'DirectSetClass', 'directMethod', [9,0]);
		});
		expect(value1).to.be.undefined;
		expect(value2).to.be.undefined;


		// Verify item for otherAgent still exists
		let otherValue;
		await agentContextStorage.run(otherAgentContext, async () => {
			otherValue = await cacheService.getValue('agent', 'TestClass', 'bazAgent', [10, 20]);
		});
		expect(otherValue).to.deep.equal([10, 20]);


		// Verify global item still exists
		const globalValueRetrieved = await cacheService.getValue('global', 'GlobalClass', 'globalMethod', []);
		expect(globalValueRetrieved).to.equal('globalValue');
	});

	it('should clear all cache entries for a specific user', async () => {
		const userIdToClear = currentUser().id; // Or a fixed test user ID
		// const otherUserId = 'other-user-789'; // Not used as switching user context is complex for this test

		// Set items for userIdToClear (decorator and direct)
		// Assumes currentUser() context is set to userIdToClear for these calls
		await new TestClass().barUser(1, 2); // Uses currentUser()
		await cacheService.setValue('user', 'AnotherClass', 'someMethod', [3, 4], 'userValue1'); // Uses currentUser()

		// Set a global item
		await cacheService.setValue('global', 'GlobalClass', 'globalMethodUserTest', [], 'globalValueUser');

		const clearedCount = await cacheService.clearUserCache(userIdToClear);
		expect(clearedCount).to.equal(2); // barUser and someMethod for userIdToClear

		// Verify items for userIdToClear are gone
		const value1 = await cacheService.getValue('user', 'TestClass', 'barUser', [1, 2]);
		const value2 = await cacheService.getValue('user', 'AnotherClass', 'someMethod', [3, 4]);
		expect(value1).to.be.undefined;
		expect(value2).to.be.undefined;

		// Verify global item still exists
		const globalValueRetrieved = await cacheService.getValue('global', 'GlobalClass', 'globalMethodUserTest', []);
		expect(globalValueRetrieved).to.equal('globalValueUser');
	});
});
