import * as fs from 'node:fs/promises';
import axios from 'axios';
import { expect } from 'chai';
import { agentContext, agentContextStorage, createContext } from '#agent/agentContextLocalStorage';
import { initInMemoryApplicationContext } from '#app/applicationContext';
import { mockLLMs } from '#llm/services/mock-llm';
import { logger } from '#o11y/logger';
import { setupConditionalLoggerOutput } from '#test/testUtils';
import { currentUser } from '#user/userContext';
import { RetryableError, cacheRetry } from '../../cache/cacheRetry';
import { FirestoreCacheService } from './firestoreFunctionCacheService';

const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST;

// https://cloud.google.com/datastore/docs/emulator#reset_emulator_data
const instance = axios.create({
	baseURL: `http://${emulatorHost}/`,
});

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

describe('FirestoreFunctionCacheService', () => {
	setupConditionalLoggerOutput();
	let cacheService: FirestoreCacheService;

	beforeEach(async () => {
		cacheService = new FirestoreCacheService();
		const ctx = initInMemoryApplicationContext();
		ctx.functionCacheService = cacheService;
		try {
			const response = await instance.post('reset');
			// Axios throws an error for responses outside the 2xx range, so the following check is optional
			// and generally not needed unless you configure axios to not throw on certain status codes.
			if (response.status !== 200) {
				logger.error('Failed to reset emulator data:', response.status, response.statusText);
			}
		} catch (error) {
			// Axios encapsulates the response error as error.response
			logger.error(error.response ?? error, 'Error resetting emulator data:');
		}
	});

	describe('FirestoreFunctionCacheService', () => {
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
			const cacheService = new FirestoreCacheService();
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
	});
});
