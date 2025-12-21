/**
 * Test helpers for circuit breaker unit tests
 */

import type { LoggerInterface, TimerInterface } from './rateLimitCircuitBreaker';

/**
 * Fake timer for testing - allows manual control of time
 */
export class FakeTimer implements TimerInterface {
	private callbacks: Map<NodeJS.Timeout, () => void> = new Map();
	private nextId = 1;

	setInterval(callback: () => void, ms: number): NodeJS.Timeout {
		const id = this.nextId++ as any as NodeJS.Timeout;
		this.callbacks.set(id, callback);
		return id;
	}

	clearInterval(timer: NodeJS.Timeout): void {
		this.callbacks.delete(timer);
	}

	/**
	 * Execute all timer callbacks once (simulates timer tick)
	 */
	async tick(): Promise<void> {
		const callbacks = Array.from(this.callbacks.values());
		for (const callback of callbacks) {
			callback();
		}
		// Allow promises to resolve
		await new Promise((resolve) => setImmediate(resolve));
	}

	/**
	 * Execute a specific timer callback
	 */
	tickOnce(timerId: NodeJS.Timeout): void {
		const callback = this.callbacks.get(timerId);
		if (callback) {
			callback();
		}
	}

	/**
	 * Get number of active timers
	 */
	getActiveTimers(): number {
		return this.callbacks.size;
	}

	/**
	 * Clear all timers
	 */
	reset(): void {
		this.callbacks.clear();
	}
}

/**
 * Mock logger for testing - captures all log calls
 */
export class MockLogger implements LoggerInterface {
	public infoCalls: any[][] = [];
	public warnCalls: any[][] = [];
	public errorCalls: any[][] = [];
	public debugCalls: any[][] = [];

	info(msg: string | object, ...args: any[]): void {
		this.infoCalls.push([msg, ...args]);
	}

	warn(msg: string | object, ...args: any[]): void {
		this.warnCalls.push([msg, ...args]);
	}

	error(msg: string | object, ...args: any[]): void {
		this.errorCalls.push([msg, ...args]);
	}

	debug(msg: string | object, ...args: any[]): void {
		this.debugCalls.push([msg, ...args]);
	}

	/**
	 * Reset all captured calls
	 */
	reset(): void {
		this.infoCalls = [];
		this.warnCalls = [];
		this.errorCalls = [];
		this.debugCalls = [];
	}

	/**
	 * Get total number of log calls
	 */
	getTotalCalls(): number {
		return this.infoCalls.length + this.warnCalls.length + this.errorCalls.length + this.debugCalls.length;
	}
}

/**
 * Helper to create rate limit / quota errors
 */
export function createRateLimitError(type: 'grpc' | 'http429' | 'message' | 'ai_api_call' | 'ai_retry' = 'grpc'): Error {
	switch (type) {
		case 'grpc':
			return Object.assign(new Error('RESOURCE_EXHAUSTED'), { code: 8 });
		case 'http429':
			return Object.assign(new Error('Too Many Requests'), { status: 429 });
		case 'message':
			return new Error('Quota exceeded for quota metric');
		case 'ai_api_call':
			return Object.assign(new Error('Too Many Requests'), { name: 'AI_APICallError', statusCode: 429 });
		case 'ai_retry':
			return Object.assign(new Error('Maximum retries exceeded'), {
				name: 'AI_RetryError',
				reason: 'maxRetriesExceeded',
				errors: [Object.assign(new Error('Too Many Requests'), { name: 'AI_APICallError', statusCode: 429 })],
			});
		default:
			return Object.assign(new Error('RESOURCE_EXHAUSTED'), { code: 8 });
	}
}

/**
 * Helper to create non-rate-limit errors
 */
export function createNonRateLimitError(type: 'network' | 'validation' | 'generic' = 'generic'): Error {
	switch (type) {
		case 'network':
			return Object.assign(new Error('Network error'), { code: 14 });
		case 'validation':
			return new Error('Validation failed');
		default:
			return new Error('Generic error');
	}
}

/**
 * Helper to wait for async operations
 */
export async function waitForAsync(ms = 0): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Helper to create a function that fails N times then succeeds
 */
export function createFailNTimesThenSucceed(failCount: number, errorFactory: () => Error = createRateLimitError) {
	let callCount = 0;
	return async () => {
		callCount++;
		if (callCount <= failCount) {
			throw errorFactory();
		}
		return `success-${callCount}`;
	};
}

/**
 * Helper to create a function that always fails
 */
export function createAlwaysFails(errorFactory: () => Error = createRateLimitError) {
	let callCount = 0;
	return async () => {
		callCount++;
		throw errorFactory();
	};
}

/**
 * Helper to create a function that always succeeds
 */
export function createAlwaysSucceeds() {
	let callCount = 0;
	return async () => {
		callCount++;
		return `success-${callCount}`;
	};
}
