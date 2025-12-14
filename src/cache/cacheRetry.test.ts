import { expect } from 'chai';
import { setupConditionalLoggerOutput } from '#test/testUtils';
import { cacheRetry } from './cacheRetry';

describe.skip('@cache decorator', () => {
	setupConditionalLoggerOutput();
	// Mock cacheService for testing
	const mockCacheService = {
		get: async (key: string) => undefined,
		set: async (key: string, value: any, ttl: number) => {},
	};

	class TestClass {
		@cacheRetry({ retries: 2, backOffMs: 10, ttlSeconds: 60 })
		async testMethod(arg1: number, arg2: string): Promise<string> {
			return `${arg1}-${arg2}`;
		}
	}

	it('should cache the result of the decorated method', async () => {
		const testInstance = new TestClass();
		const result1 = await testInstance.testMethod(1, 'a');
		const result2 = await testInstance.testMethod(1, 'a');

		expect(result1).to.equal('1-a');
		expect(result2).to.equal('1-a'); // Should be cached
	});

	it('should handle cache misses and call the original method', async () => {
		const testInstance = new TestClass();
		const result = await testInstance.testMethod(2, 'b');

		expect(result).to.equal('2-b');
	});

	it('should retry on errors and eventually throw if retries are exhausted', async () => {
		mockCacheService.get = async () => {
			throw new Error('Cache error');
		};

		const testInstance = new TestClass();

		try {
			await testInstance.testMethod(3, 'c');
			expect.fail('Should have thrown an error');
		} catch (error) {
			expect(error.message).to.equal('Cache error');
		}
	});

	// Add more tests for edge cases, varying options, etc.
});
