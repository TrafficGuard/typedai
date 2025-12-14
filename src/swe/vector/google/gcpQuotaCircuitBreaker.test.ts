import { expect } from 'chai';
import { afterEach, beforeEach, describe, it } from 'mocha';
import { setupConditionalLoggerOutput } from '#test/testUtils';
import { CircuitState, GcpQuotaCircuitBreaker } from './gcpQuotaCircuitBreaker';
import {
	FakeTimer,
	MockLogger,
	createAlwaysSucceeds,
	createFailNTimesThenSucceed,
	createNonQuotaError,
	createQuotaError,
	waitForAsync,
} from './gcpQuotaCircuitBreaker.testHelpers';

async function triggerExecution<T>(breaker: GcpQuotaCircuitBreaker, fn: () => Promise<T>, swallowErrors = true): Promise<void> {
	const promise = breaker.execute(fn);
	if (swallowErrors) {
		promise.catch(() => {});
	}
	await waitForAsync();
}

async function triggerRecovery(breaker: GcpQuotaCircuitBreaker): Promise<void> {
	const recovery = (breaker as any).testServiceRecovery;
	if (typeof recovery !== 'function') throw new Error('testServiceRecovery not accessible');
	await recovery.call(breaker);
	await waitForAsync(5);
}

describe('GcpQuotaCircuitBreaker', () => {
	setupConditionalLoggerOutput();

	let circuitBreaker: GcpQuotaCircuitBreaker;
	let fakeTimer: FakeTimer;
	let mockLogger: MockLogger;

	beforeEach(() => {
		fakeTimer = new FakeTimer();
		mockLogger = new MockLogger();
		circuitBreaker = new GcpQuotaCircuitBreaker({
			retryIntervalMs: 5000,
			failureThreshold: 1,
			successThreshold: 1,
			timer: fakeTimer,
			logger: mockLogger,
		});
	});

	afterEach(() => {
		circuitBreaker.reset();
		fakeTimer.reset();
		mockLogger.reset();
	});

	describe('Initialization', () => {
		it('should start in CLOSED state', () => {
			expect(circuitBreaker.getState()).to.equal(CircuitState.CLOSED);
		});

		it('should have empty queue', () => {
			expect(circuitBreaker.getQueueDepth()).to.equal(0);
		});

		it('should accept custom configuration', () => {
			const cb = new GcpQuotaCircuitBreaker({
				retryIntervalMs: 10000,
				failureThreshold: 3,
				successThreshold: 2,
				timer: fakeTimer,
				logger: mockLogger,
			});
			expect(cb.getState()).to.equal(CircuitState.CLOSED);
		});
	});

	describe('Error Detection', () => {
		it('should detect gRPC code 8 as quota error', () => {
			const error = { code: 8, message: 'RESOURCE_EXHAUSTED' };
			expect(circuitBreaker.isQuotaError(error)).to.be.true;
		});

		it('should detect HTTP 429 status as quota error', () => {
			const error = { status: 429, message: 'Too Many Requests' };
			expect(circuitBreaker.isQuotaError(error)).to.be.true;
		});

		it('should detect HTTP 429 statusCode as quota error', () => {
			const error = { statusCode: 429, message: 'Too Many Requests' };
			expect(circuitBreaker.isQuotaError(error)).to.be.true;
		});

		it('should detect "RESOURCE_EXHAUSTED" message as quota error', () => {
			const error = new Error('8 RESOURCE_EXHAUSTED: Quota exceeded');
			expect(circuitBreaker.isQuotaError(error)).to.be.true;
		});

		it('should detect "Quota exceeded" message as quota error', () => {
			const error = new Error('Quota exceeded for quota metric');
			expect(circuitBreaker.isQuotaError(error)).to.be.true;
		});

		it('should detect "quota" keyword as quota error', () => {
			const error = new Error('Hit quota limit');
			expect(circuitBreaker.isQuotaError(error)).to.be.true;
		});

		it('should detect "rate limit" message as quota error', () => {
			const error = new Error('Rate limit exceeded');
			expect(circuitBreaker.isQuotaError(error)).to.be.true;
		});

		it('should NOT detect non-quota errors', () => {
			const networkError = { code: 14, message: 'Network error' };
			expect(circuitBreaker.isQuotaError(networkError)).to.be.false;
		});

		it('should NOT detect validation errors', () => {
			const validationError = new Error('Validation failed');
			expect(circuitBreaker.isQuotaError(validationError)).to.be.false;
		});

		it('should detect Vercel AI SDK AI_APICallError with 429 as quota error', () => {
			const error = createQuotaError('ai_api_call');
			expect(circuitBreaker.isQuotaError(error)).to.be.true;
		});

		it('should detect Vercel AI SDK AI_RetryError with nested quota errors', () => {
			const error = createQuotaError('ai_retry');
			expect(circuitBreaker.isQuotaError(error)).to.be.true;
		});

		it('should NOT detect AI_APICallError with non-429 status', () => {
			const error = Object.assign(new Error('Bad Request'), { name: 'AI_APICallError', statusCode: 400 });
			expect(circuitBreaker.isQuotaError(error)).to.be.false;
		});

		it('should NOT detect AI_RetryError without nested quota errors', () => {
			const error = Object.assign(new Error('Maximum retries exceeded'), {
				name: 'AI_RetryError',
				reason: 'maxRetriesExceeded',
				errors: [Object.assign(new Error('Network error'), { name: 'AI_APICallError', statusCode: 500 })],
			});
			expect(circuitBreaker.isQuotaError(error)).to.be.false;
		});
	});

	describe('State Transitions: CLOSED -> OPEN', () => {
		it('should open circuit on quota error', async () => {
			const fn = createFailNTimesThenSucceed(1);

			// Execute - will fail with quota error
			await triggerExecution(circuitBreaker, fn);

			// Circuit should open immediately
			expect(circuitBreaker.getState()).to.equal(CircuitState.OPEN);

			// Should have logged warning
			expect(mockLogger.warnCalls.length).to.be.greaterThan(0);
			expect(JSON.stringify(mockLogger.warnCalls)).to.include('quota');

			// Timer should be started
			expect(fakeTimer.getActiveTimers()).to.equal(1);
		});

		it('should queue subsequent requests when OPEN', async () => {
			const fn = createFailNTimesThenSucceed(1);

			// First request opens circuit
			await triggerExecution(circuitBreaker, fn);
			expect(circuitBreaker.getState()).to.equal(CircuitState.OPEN);

			// Second request gets queued
			const promise2 = circuitBreaker.execute(createAlwaysSucceeds());
			expect(circuitBreaker.getQueueDepth()).to.equal(2);

			// Third request also queued
			const promise3 = circuitBreaker.execute(createAlwaysSucceeds());
			expect(circuitBreaker.getQueueDepth()).to.equal(3);
		});

		it('should NOT open circuit on non-quota errors', async () => {
			const fn = async () => {
				throw createNonQuotaError();
			};

			try {
				await circuitBreaker.execute(fn);
			} catch (error) {
				// Expected
			}

			// Circuit should remain CLOSED
			expect(circuitBreaker.getState()).to.equal(CircuitState.CLOSED);
		});

		it('should respect failure threshold', async () => {
			const cb = new GcpQuotaCircuitBreaker({
				retryIntervalMs: 5000,
				failureThreshold: 3,
				timer: fakeTimer,
				logger: mockLogger,
			});

			const fn = async () => {
				throw createQuotaError();
			};

			// First failure - circuit stays closed
			try {
				await triggerExecution(cb, fn);
			} catch (e) {}
			expect(cb.getState()).to.equal(CircuitState.CLOSED);

			// Second failure - circuit stays closed
			try {
				await triggerExecution(cb, fn);
			} catch (e) {}
			expect(cb.getState()).to.equal(CircuitState.CLOSED);

			// Third failure - circuit opens
			try {
				await triggerExecution(cb, fn);
			} catch (e) {}
			expect(cb.getState()).to.equal(CircuitState.OPEN);
		});
	});

	describe('State Transitions: OPEN -> HALF_OPEN -> CLOSED', () => {
		it('should transition to HALF_OPEN when testing recovery', async () => {
			const fn = createFailNTimesThenSucceed(1);

			// Open circuit
			await triggerExecution(circuitBreaker, fn);
			expect(circuitBreaker.getState()).to.equal(CircuitState.OPEN);

			// Trigger retry timer
			await fakeTimer.tick();

			// Should transition through HALF_OPEN to CLOSED
			expect(circuitBreaker.getState()).to.equal(CircuitState.CLOSED);
		});

		it('should process all queued requests on recovery', async () => {
			const fn = createFailNTimesThenSucceed(1);

			// Open circuit with first request
			const promise1 = circuitBreaker.execute(fn);
			await waitForAsync();
			expect(circuitBreaker.getState()).to.equal(CircuitState.OPEN);

			// Queue more requests
			const promise2 = circuitBreaker.execute(createAlwaysSucceeds());
			const promise3 = circuitBreaker.execute(createAlwaysSucceeds());

			expect(circuitBreaker.getQueueDepth()).to.equal(3);

			// Trigger recovery
			await triggerRecovery(circuitBreaker);

			// All requests should resolve
			const results = await Promise.allSettled([promise1, promise2, promise3]);
			expect(results.every((r) => r.status === 'fulfilled')).to.be.true;

			// Queue should be empty
			await waitForAsync(5);
			expect(circuitBreaker.getQueueDepth()).to.equal(0);

			// Circuit should be closed
			expect(circuitBreaker.getState()).to.equal(CircuitState.CLOSED);
		});

		it('should stay OPEN if test request fails with quota error', async () => {
			let callCount = 0;
			const fn = async () => {
				callCount++;
				throw createQuotaError(); // Always fails
			};

			// Open circuit
			await triggerExecution(circuitBreaker, fn);
			expect(circuitBreaker.getState()).to.equal(CircuitState.OPEN);

			// First retry - still fails
			await fakeTimer.tick();
			expect(circuitBreaker.getState()).to.equal(CircuitState.OPEN);

			// Second retry - still fails
			await fakeTimer.tick();
			expect(circuitBreaker.getState()).to.equal(CircuitState.OPEN);

			expect(callCount).to.be.greaterThan(2);
		});
	});

	describe('Queue Management', () => {
		it('should maintain FIFO order', async () => {
			const results: string[] = [];
			const fn1 = async () => {
				results.push('first');
				return 'first';
			};
			const fn2 = async () => {
				results.push('second');
				return 'second';
			};
			const fn3 = async () => {
				results.push('third');
				return 'third';
			};

			// Open circuit with first request that fails
			const failFn = createFailNTimesThenSucceed(1);
			const openPromise = circuitBreaker.execute(failFn);
			openPromise.catch(() => {});
			await waitForAsync();
			expect(circuitBreaker.getState()).to.equal(CircuitState.OPEN);

			// Queue requests
			const promise1 = circuitBreaker.execute(fn1);
			const promise2 = circuitBreaker.execute(fn2);
			const promise3 = circuitBreaker.execute(fn3);

			// Trigger recovery
			await triggerRecovery(circuitBreaker);

			// Wait for async processing
			const promiseResults = await Promise.allSettled([promise1, promise2, promise3]);
			expect(promiseResults.every((r) => r.status === 'fulfilled')).to.be.true;

			// Should execute in order
			expect(results).to.deep.equal(['first', 'second', 'third']);
		});

		it('should track queue depth correctly', async () => {
			const fn = async () => 'success';

			// Open circuit
			const openPromise = circuitBreaker.execute(createFailNTimesThenSucceed(1));
			openPromise.catch(() => {});
			await waitForAsync();
			expect(circuitBreaker.getState()).to.equal(CircuitState.OPEN);

			// Add to queue
			circuitBreaker.execute(fn);
			expect(circuitBreaker.getQueueDepth()).to.equal(2);

			circuitBreaker.execute(fn);
			expect(circuitBreaker.getQueueDepth()).to.equal(3);

			circuitBreaker.execute(fn);
			expect(circuitBreaker.getQueueDepth()).to.equal(4);

			// Trigger recovery
			await triggerRecovery(circuitBreaker);
			await waitForAsync(5);

			// Queue should be empty
			expect(circuitBreaker.getQueueDepth()).to.equal(0);
		});
	});

	describe('Timer Management', () => {
		it('should start timer when circuit opens', async () => {
			expect(fakeTimer.getActiveTimers()).to.equal(0);

			// Open circuit
			await triggerExecution(circuitBreaker, createFailNTimesThenSucceed(1));
			expect(circuitBreaker.getState()).to.equal(CircuitState.OPEN);

			// Timer should be active
			expect(fakeTimer.getActiveTimers()).to.equal(1);
		});

		it('should stop timer when circuit closes', async () => {
			// Open circuit
			const openPromise = circuitBreaker.execute(createFailNTimesThenSucceed(1));
			openPromise.catch(() => {});
			await waitForAsync();
			expect(fakeTimer.getActiveTimers()).to.equal(1);

			// Trigger recovery
			await triggerRecovery(circuitBreaker);

			// Timer should be stopped
			expect(fakeTimer.getActiveTimers()).to.equal(0);
		});

		it('should clean up timer on reset', async () => {
			// Open circuit
			await triggerExecution(circuitBreaker, createFailNTimesThenSucceed(10)); // Will keep failing
			expect(fakeTimer.getActiveTimers()).to.equal(1);

			// Reset
			circuitBreaker.reset();

			// Timer should be stopped
			expect(fakeTimer.getActiveTimers()).to.equal(0);
			expect(circuitBreaker.getState()).to.equal(CircuitState.CLOSED);
		});
	});

	describe('Internal State', () => {
		it('should track consecutive failures', async () => {
			const cb = new GcpQuotaCircuitBreaker({
				failureThreshold: 3,
				timer: fakeTimer,
				logger: mockLogger,
			});

			const fn = async () => {
				throw createQuotaError();
			};

			// First failure
			try {
				await triggerExecution(cb, fn);
			} catch (e) {}
			expect(cb.getInternalState().consecutiveFailures).to.equal(1);

			// Second failure
			try {
				await triggerExecution(cb, fn);
			} catch (e) {}
			expect(cb.getInternalState().consecutiveFailures).to.equal(2);
		});

		it('should reset failure counter on success', async () => {
			const cb = new GcpQuotaCircuitBreaker({
				failureThreshold: 3,
				timer: fakeTimer,
				logger: mockLogger,
			});

			const failFn = async () => {
				throw createQuotaError();
			};
			const successFn = async () => 'success';

			// Failure
			try {
				await triggerExecution(cb, failFn);
			} catch (e) {}
			expect(cb.getInternalState().consecutiveFailures).to.equal(1);

			// Success
			await cb.execute(successFn);
			await waitForAsync();
			expect(cb.getInternalState().consecutiveFailures).to.equal(0);
		});

		it('should provide queue length in internal state', async () => {
			// Open circuit
			await triggerExecution(circuitBreaker, createFailNTimesThenSucceed(1));

			// Add to queue
			circuitBreaker.execute(createAlwaysSucceeds());
			circuitBreaker.execute(createAlwaysSucceeds());

			const state = circuitBreaker.getInternalState();
			expect(state.queueLength).to.equal(3);
		});
	});

	describe('Logging', () => {
		it('should log when circuit opens', async () => {
			await triggerExecution(circuitBreaker, createFailNTimesThenSucceed(1));

			expect(mockLogger.warnCalls.length).to.be.greaterThan(0);
			const warnMessages = mockLogger.warnCalls.map((call) => JSON.stringify(call));
			expect(warnMessages.some((msg) => msg.includes('OPENING'))).to.be.true;
		});

		it('should log when circuit closes', async () => {
			await triggerExecution(circuitBreaker, createFailNTimesThenSucceed(1));
			await fakeTimer.tick();
			await waitForAsync(5);

			expect(mockLogger.infoCalls.length).to.be.greaterThan(0);
			const infoMessages = mockLogger.infoCalls.map((call) => JSON.stringify(call));
			expect(infoMessages.some((msg) => msg.includes('CLOSING') || msg.includes('recovered'))).to.be.true;
		});

		it('should log queue growth', async () => {
			// Open circuit
			await triggerExecution(circuitBreaker, createFailNTimesThenSucceed(1));

			// Add enough requests to trigger queue growth log (every 10)
			for (let i = 0; i < 20; i++) {
				circuitBreaker.execute(createAlwaysSucceeds());
			}

			// Should log queue growth
			const infoMessages = mockLogger.infoCalls.map((call) => JSON.stringify(call));
			expect(infoMessages.some((msg) => msg.includes('queue growing') || msg.includes('queueDepth'))).to.be.true;
		});
	});

	describe('Integration Tests', () => {
		it('should handle full workflow: CLOSED -> OPEN -> HALF_OPEN -> CLOSED', async () => {
			const fn = createFailNTimesThenSucceed(1);

			// Initially CLOSED
			expect(circuitBreaker.getState()).to.equal(CircuitState.CLOSED);

			// Fails and opens circuit
			const promise = circuitBreaker.execute(fn);
			await waitForAsync();
			expect(circuitBreaker.getState()).to.equal(CircuitState.OPEN);

			// Queue more requests
			const promise2 = circuitBreaker.execute(createAlwaysSucceeds());
			expect(circuitBreaker.getQueueDepth()).to.equal(2);

			// Trigger recovery
			await triggerRecovery(circuitBreaker);
			await waitForAsync(5);

			// Should close and process queue
			expect(circuitBreaker.getState()).to.equal(CircuitState.CLOSED);

			// All promises should resolve
			const results = await Promise.allSettled([promise, promise2]);
			expect(results.every((r) => r.status === 'fulfilled')).to.be.true;
		});

		it('should handle multiple open/close cycles', async () => {
			for (let cycle = 0; cycle < 3; cycle++) {
				// Open circuit
				await triggerExecution(circuitBreaker, createFailNTimesThenSucceed(1));
				expect(circuitBreaker.getState()).to.equal(CircuitState.OPEN);

				// Trigger recovery
				await fakeTimer.tick();
				await waitForAsync(5);
				expect(circuitBreaker.getState()).to.equal(CircuitState.CLOSED);
			}

			// Should still work after multiple cycles
			const result = await circuitBreaker.execute(createAlwaysSucceeds());
			expect(result).to.include('success');
		});
	});
});
