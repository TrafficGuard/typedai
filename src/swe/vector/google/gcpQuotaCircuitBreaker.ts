import pino from 'pino';

/**
 * Timer interface for dependency injection (enables testing with fake timers)
 */
export interface TimerInterface {
	setInterval(callback: () => void, ms: number): NodeJS.Timeout;
	clearInterval(timer: NodeJS.Timeout): void;
}

/**
 * Logger interface for dependency injection (enables testing with mock logger)
 */
export interface LoggerInterface {
	info(msg: string | object, ...args: any[]): void;
	warn(msg: string | object, ...args: any[]): void;
	error(msg: string | object, ...args: any[]): void;
	debug(msg: string | object, ...args: any[]): void;
}

/**
 * Default timer implementation using Node.js global timers
 */
class DefaultTimer implements TimerInterface {
	setInterval(callback: () => void, ms: number): NodeJS.Timeout {
		return setInterval(callback, ms);
	}

	clearInterval(timer: NodeJS.Timeout): void {
		clearInterval(timer);
	}
}

/**
 * Pino logger adapter implementing LoggerInterface
 */
class PinoLoggerAdapter implements LoggerInterface {
	private logger: pino.Logger;

	constructor(serviceName?: string) {
		this.logger = pino({ name: serviceName || 'GcpQuotaCircuitBreaker' });
	}

	info(msg: string | object, ...args: any[]): void {
		this.logger.info(msg, ...args);
	}

	warn(msg: string | object, ...args: any[]): void {
		this.logger.warn(msg, ...args);
	}

	error(msg: string | object, ...args: any[]): void {
		this.logger.error(msg, ...args);
	}

	debug(msg: string | object, ...args: any[]): void {
		this.logger.debug(msg, ...args);
	}
}

/**
 * Circuit breaker states
 */
export enum CircuitState {
	/** Normal operation - requests proceed immediately */
	CLOSED = 'CLOSED',
	/** Circuit open - all requests queued, testing with periodic retries */
	OPEN = 'OPEN',
	/** Testing if service recovered - single test request in progress */
	HALF_OPEN = 'HALF_OPEN',
}

/**
 * Queued request waiting for circuit to close
 */
interface QueuedRequest<T> {
	execute: () => Promise<T>;
	resolve: (value: T) => void;
	reject: (error: Error) => void;
}

/**
 * Configuration for circuit breaker
 */
export interface CircuitBreakerConfig {
	/** Service name for logging (e.g., "Discovery Engine", "Vertex AI Embeddings") */
	serviceName?: string;
	/** Interval in milliseconds between retry attempts when circuit is OPEN (default: 5000ms) */
	retryIntervalMs?: number;
	/** Number of consecutive failures to open circuit (default: 1) */
	failureThreshold?: number;
	/** Number of consecutive successes to close circuit (default: 1) */
	successThreshold?: number;
	/** Custom timer implementation (for testing) */
	timer?: TimerInterface;
	/** Custom logger implementation (for testing) */
	logger?: LoggerInterface;
}

/**
 * Circuit Breaker for Google Cloud Platform API calls (Discovery Engine, Vertex AI, etc.)
 *
 * Implements circuit breaker pattern to handle quota exhaustion:
 * - CLOSED: Normal operation, requests proceed
 * - OPEN: Quota exhausted, queue all requests, test first request every 5s
 * - HALF_OPEN: Testing if service recovered
 *
 * When first quota error occurs:
 * 1. Open circuit immediately
 * 2. Queue all subsequent requests
 * 3. Every 5 seconds, try first request in queue
 * 4. On success: close circuit and process entire queue
 * 5. On failure: wait another 5 seconds
 */
export class GcpQuotaCircuitBreaker {
	private state: CircuitState = CircuitState.CLOSED;
	private queue: QueuedRequest<any>[] = [];
	private retryIntervalMs: number;
	private failureThreshold: number;
	private successThreshold: number;
	private consecutiveFailures = 0;
	private consecutiveSuccesses = 0;
	private retryTimer?: NodeJS.Timeout;
	private isProcessingQueue = false;
	private timer: TimerInterface;
	private logger: LoggerInterface;
	private serviceName: string;

	constructor(config: CircuitBreakerConfig = {}) {
		this.serviceName = config.serviceName || 'GCP Service';
		this.retryIntervalMs = config.retryIntervalMs || 5000;
		this.failureThreshold = config.failureThreshold || 1;
		this.successThreshold = config.successThreshold || 1;
		this.timer = config.timer || new DefaultTimer();
		this.logger = config.logger || new PinoLoggerAdapter(config.serviceName);
	}

	/**
	 * Get current circuit state
	 */
	getState(): CircuitState {
		return this.state;
	}

	/**
	 * Get number of queued requests
	 */
	getQueueDepth(): number {
		return this.queue.length;
	}

	/**
	 * Execute a function through the circuit breaker
	 * @param fn Function to execute
	 * @returns Promise that resolves with function result
	 */
	async execute<T>(fn: () => Promise<T>): Promise<T> {
		if (this.state === CircuitState.CLOSED) {
			// Normal operation - execute immediately
			try {
				const result = await fn();
				this.onSuccess();
				return result;
			} catch (error) {
				if (this.isQuotaError(error)) {
					this.onQuotaError();
					// Queue this request for retry
					return this.enqueue(fn);
				}
				throw error;
			}
		}

		if (this.state === CircuitState.OPEN || this.state === CircuitState.HALF_OPEN) {
			// Circuit open - queue request
			return this.enqueue(fn);
		}

		// Should never reach here
		return fn();
	}

	/**
	 * Check if error is a quota exhaustion error
	 * Handles GCP errors, HTTP errors, and Vercel AI SDK errors
	 * Public for testing purposes
	 */
	public isQuotaError(error: any): boolean {
		// gRPC code 8 = RESOURCE_EXHAUSTED
		if (error.code === 8) {
			return true;
		}

		// HTTP 429 = Too Many Requests
		if (error.status === 429 || error.statusCode === 429) {
			return true;
		}

		// Vercel AI SDK: AI_APICallError with statusCode
		if (error.name === 'AI_APICallError' && error.statusCode === 429) {
			return true;
		}

		// Vercel AI SDK: AI_RetryError with nested quota errors
		if (error.name === 'AI_RetryError' && Array.isArray(error.errors)) {
			// Recursively check nested errors
			if (error.errors.some((e: any) => this.isQuotaError(e))) {
				return true;
			}
		}

		// Check error message for quota-related keywords
		const message = (error.message || '').toLowerCase();
		if (message.includes('resource_exhausted') || message.includes('quota exceeded') || message.includes('quota') || message.includes('rate limit')) {
			return true;
		}

		return false;
	}

	/**
	 * Handle quota error - open circuit
	 */
	private onQuotaError(): void {
		this.consecutiveFailures++;
		this.consecutiveSuccesses = 0;

		if (this.consecutiveFailures >= this.failureThreshold && this.state === CircuitState.CLOSED) {
			this.openCircuit();
		}
	}

	/**
	 * Handle successful request
	 */
	private onSuccess(): void {
		this.consecutiveSuccesses++;
		this.consecutiveFailures = 0;

		if (this.state === CircuitState.HALF_OPEN && this.consecutiveSuccesses >= this.successThreshold) {
			this.closeCircuit();
		}
	}

	/**
	 * Open the circuit - start queuing requests and periodic retry
	 */
	private openCircuit(): void {
		if (this.state === CircuitState.OPEN) {
			return; // Already open
		}

		this.logger.warn(`Circuit breaker OPENING - quota limit hit, pausing ${this.serviceName} requests`);
		this.logger.warn(
			`⚠️  ${this.serviceName} quota limit hit - pausing requests. Will retry every ${this.retryIntervalMs / 1000} seconds until service recovers`,
		);

		this.state = CircuitState.OPEN;
		this.startPeriodicRetry();
	}

	/**
	 * Close the circuit - resume normal operation
	 */
	private closeCircuit(): void {
		if (this.state === CircuitState.CLOSED) {
			return; // Already closed
		}

		const deferQueueProcessing = this.isProcessingQueue;

		this.logger.info('Circuit breaker CLOSING - service recovered, resuming normal operation');
		this.logger.info(`✅ ${this.serviceName} service recovered - resuming requests`);

		this.state = CircuitState.CLOSED;
		this.stopPeriodicRetry();

		if (deferQueueProcessing) {
			queueMicrotask(() => this.processQueue());
			return;
		}

		void this.processQueue();
	}

	/**
	 * Transition to half-open state for testing
	 */
	private halfOpenCircuit(): void {
		if (this.state !== CircuitState.OPEN) {
			return;
		}

		this.logger.debug('Circuit breaker HALF-OPEN - testing service recovery');
		this.state = CircuitState.HALF_OPEN;
	}

	/**
	 * Start periodic retry timer
	 */
	private startPeriodicRetry(): void {
		if (this.retryTimer) {
			return; // Already running
		}

		this.retryTimer = this.timer.setInterval(() => {
			this.testServiceRecovery();
		}, this.retryIntervalMs);
	}

	/**
	 * Stop periodic retry timer
	 */
	private stopPeriodicRetry(): void {
		if (this.retryTimer) {
			this.timer.clearInterval(this.retryTimer);
			this.retryTimer = undefined;
		}
	}

	/**
	 * Test if service has recovered by trying first request in queue
	 */
	private async testServiceRecovery(): Promise<void> {
		if (this.queue.length === 0) {
			// No requests to test - close circuit
			this.closeCircuit();
			return;
		}

		if (this.isProcessingQueue) {
			// Already testing
			return;
		}

		this.halfOpenCircuit();
		this.isProcessingQueue = true;

		const testRequest = this.queue[0];

		try {
			this.logger.debug({ queueDepth: this.queue.length }, 'Testing service recovery with first queued request');
			const result = await testRequest.execute();

			// Success! Service recovered
			this.onSuccess();
			this.queue.shift(); // Remove test request from queue
			testRequest.resolve(result);

			// Close circuit and process remaining queue
			this.closeCircuit();
		} catch (error) {
			if (this.isQuotaError(error)) {
				// Still hitting quota - keep circuit open
				this.logger.debug('Service recovery test failed - quota still exhausted');
				this.state = CircuitState.OPEN;
			} else {
				// Different error - reject the request and try next one
				this.logger.warn({ error }, 'Service recovery test failed with non-quota error');
				this.queue.shift(); // Remove failed request
				testRequest.reject(error as Error);

				// Try next request in queue
				if (this.queue.length > 0) {
					this.state = CircuitState.OPEN;
					// Will retry on next interval
				} else {
					// No more requests - close circuit
					this.closeCircuit();
				}
			}
		} finally {
			this.isProcessingQueue = false;
		}
	}

	/**
	 * Add request to queue
	 */
	private enqueue<T>(fn: () => Promise<T>): Promise<T> {
		return new Promise<T>((resolve, reject) => {
			this.queue.push({
				execute: fn,
				resolve,
				reject,
			});

			if (this.queue.length % 10 === 0) {
				this.logger.info({ queueDepth: this.queue.length }, 'Circuit breaker queue growing');
			}
		});
	}

	/**
	 * Process all queued requests
	 */
	private async processQueue(): Promise<void> {
		if (this.isProcessingQueue) {
			return;
		}

		this.isProcessingQueue = true;
		this.logger.info({ queueDepth: this.queue.length }, 'Processing queued requests');

		while (this.queue.length > 0 && this.state === CircuitState.CLOSED) {
			const request = this.queue.shift()!;

			try {
				const result = await request.execute();
				request.resolve(result);
			} catch (error) {
				if (this.isQuotaError(error)) {
					// Hit quota again - reopen circuit
					this.onQuotaError();
					// Put request back at front of queue
					this.queue.unshift(request);
					break;
				}
				// Non-quota error - reject and continue
				request.reject(error as Error);
			}
		}

		this.isProcessingQueue = false;
	}

	/**
	 * Reset circuit breaker state (for testing)
	 */
	reset(): void {
		this.state = CircuitState.CLOSED;
		this.consecutiveFailures = 0;
		this.consecutiveSuccesses = 0;
		this.queue = [];
		this.stopPeriodicRetry();
	}

	/**
	 * Get internal state for testing purposes
	 * @internal
	 */
	getInternalState() {
		return {
			consecutiveFailures: this.consecutiveFailures,
			consecutiveSuccesses: this.consecutiveSuccesses,
			isProcessingQueue: this.isProcessingQueue,
			hasRetryTimer: this.retryTimer !== undefined,
			queueLength: this.queue.length,
		};
	}
}
