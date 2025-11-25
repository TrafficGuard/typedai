import { expect } from 'chai';
import { agentContext, agentContextStorage, createContext } from '#agent/agentContextLocalStorage';
import { initInMemoryApplicationContext } from '#app/applicationContext';
import { mockLLMs } from '#llm/services/mock-llm';
import { setupConditionalLoggerOutput } from '#test/testUtils';
import { currentUser } from '#user/userContext';
import { cacheRetry } from '../../cache/cacheRetry';
import { db } from './db';
import { PostgresFunctionCacheService } from './postgresFunctionCacheService';
import { ensureFunctionCacheTableExists } from './schemaUtils';

class TestClass {
	@cacheRetry({ scope: 'global' })
	fooGlobal(num1: number, num2: number): Promise<string> {
		return Promise.resolve((num1 + num2).toString());
	}

	@cacheRetry({ scope: 'user' })
	barUser(num1: number, num2: number): Promise<any> {
		return Promise.resolve({ num1, num2 });
	}

	@cacheRetry({ scope: 'agent' })
	bazAgent(num1: number, num2: number): Promise<[number, number]> {
		return Promise.resolve([num1, num2]);
	}
}

describe('PostgresFunctionCacheService', () => {
	setupConditionalLoggerOutput();
	let cacheService: PostgresFunctionCacheService;

	beforeEach(async () => {
		await ensureFunctionCacheTableExists(db);
		await db.deleteFrom('function_cache').execute();
		cacheService = new PostgresFunctionCacheService();
		const ctx = initInMemoryApplicationContext();
		ctx.functionCacheService = cacheService;
	});

	describe('PostgresFunctionCacheService', () => {
		it('should retrieve a value that exists in the cache', async () => {
			await cacheService.setValue('global', 'TestClass', 'foo', [1, 2], '3');
			const value = await cacheService.getValue('global', 'TestClass', 'foo', [1, 2]);
			expect(value).to.equal('3');
		});

		it('should return undefined for a value that does not exist in the cache', async () => {
			const value = await cacheService.getValue('global', 'TestClass', 'foo', [1, 2]);
			expect(value).to.be.undefined;
		});

		it('should return undefined for a value that has expired', async () => {
			await cacheService.setValue('global', 'TestClass', 'foo', [1, 2], '3', 1); // 1 ms expiration
			await new Promise((resolve) => setTimeout(resolve, 10)); // wait for expiration
			const value = await cacheService.getValue('global', 'TestClass', 'foo', [1, 2]);
			expect(value).to.be.undefined;
		});

		it('should set a value in the cache', async () => {
			await cacheService.setValue('global', 'TestClass', 'foo', [1, 2], '3');
			const value = await cacheService.getValue('global', 'TestClass', 'foo', [1, 2]);
			expect(value).to.equal('3');
		});

		it('should set a value with an expiration time', async () => {
			await cacheService.setValue('global', 'TestClass', 'foo', [1, 2], '3', 1000); // 1 second expiration
			const value = await cacheService.getValue('global', 'TestClass', 'foo', [1, 2]);
			expect(value).to.equal('3');
		});

		it('should overwrite an existing value in the cache', async () => {
			await cacheService.setValue('global', 'TestClass', 'foo', [1, 2], '3');
			await cacheService.setValue('global', 'TestClass', 'foo', [1, 2], '4');
			const value = await cacheService.getValue('global', 'TestClass', 'foo', [1, 2]);
			expect(value).to.equal('4');
		});

		it('should cache the result of a method using cacheRetry decorator', async () => {
			const testClass = new TestClass();
			const result = await testClass.fooGlobal(1, 2);
			expect(result).to.equal('3');
			const cachedValue = await cacheService.getValue('global', 'TestClass', 'fooGlobal', [1, 2]);
			expect(cachedValue).to.equal('3');
		});

		it('should clear all cache entries for a specific agent', async () => {
			agentContextStorage.enterWith(
				createContext({
					type: 'workflow',
					subtype: 'test',
					agentName: '',
					initialPrompt: '',
					llms: mockLLMs(),
				}),
			);
			// Set one via the decorator, and one via the cacheService API
			await new TestClass().bazAgent(1, 2);
			await cacheService.setValue('agent', 'TestClass', 'foo', [3, 4], '3');
			const clearedCount = await cacheService.clearAgentCache(agentContext()!.agentId);
			expect(clearedCount).to.equal(2);
			const value1 = await cacheService.getValue('agent', 'TestClass', 'bazAgent', [1, 2]);
			const value2 = await cacheService.getValue('agent', 'TestClass', 'foo', [3, 4]);
			expect(value1).to.be.undefined;
			expect(value2).to.be.undefined;
		});

		it('should clear all cache entries for a specific user', async () => {
			await cacheService.setValue('user', 'TestClass', 'foo', [1, 2], '3');
			await cacheService.setValue('user', 'TestClass', 'foo', [3, 4], '7');
			const clearedCount = await cacheService.clearUserCache(currentUser().id);
			expect(clearedCount).to.equal(2);
			const value1 = await cacheService.getValue('user', 'TestClass', 'foo', [1, 2]);
			const value2 = await cacheService.getValue('user', 'TestClass', 'foo', [3, 4]);
			expect(value1).to.be.undefined;
			expect(value2).to.be.undefined;
		});

		it('should handle different cache scopes independently', async () => {
			await cacheService.setValue('global', 'TestClass', 'foo', [1, 2], 'global-value');
			await cacheService.setValue('user', 'TestClass', 'foo', [1, 2], 'user-value');

			const globalValue = await cacheService.getValue('global', 'TestClass', 'foo', [1, 2]);
			const userValue = await cacheService.getValue('user', 'TestClass', 'foo', [1, 2]);

			expect(globalValue).to.equal('global-value');
			expect(userValue).to.equal('user-value');
		});

		it('should handle complex object values', async () => {
			const complexObject = { nested: { data: [1, 2, 3], meta: 'test' }, count: 42 };
			await cacheService.setValue('global', 'TestClass', 'complex', [], complexObject);
			const value = await cacheService.getValue('global', 'TestClass', 'complex', []);
			expect(value).to.deep.equal(complexObject);
		});
	});
});
