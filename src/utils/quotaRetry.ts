import { logger } from '#o11y/logger';
import { sleep } from '#utils/async-utils';

interface QuotaRetryOptions {
	retries: number;
	initialBackoffMs: number;
}

const DEFAULTS: QuotaRetryOptions = { retries: 20, initialBackoffMs: 5000 };

function optionsWithDefaults(opts: Partial<QuotaRetryOptions>): QuotaRetryOptions {
	return { ...DEFAULTS, ...opts };
}

/**
 * Decorator for retrying a method on quota errors (gRPC code 8 or HTTP 429).
 * Uses exponential backoff.
 * @param options
 */
export function quotaRetry(options: Partial<QuotaRetryOptions> = {}) {
	return function quotaRetryDecorator(originalMethod: any, context: ClassMethodDecoratorContext): (this: any, ...args: any[]) => Promise<any> {
		const methodName = String(context.name);

		async function replacementMethod(this: any, ...args: any[]) {
			const { retries, initialBackoffMs } = optionsWithDefaults(options);

			for (let attempt = 1; attempt <= retries; attempt++) {
				try {
					let result = originalMethod.apply(this, args);
					if (typeof result?.then === 'function') {
						result = await result;
					}
					return result;
				} catch (e: any) {
					// gRPC code 8 is RESOURCE_EXHAUSTED, HTTP 429 is Too Many Requests
					if (e.code === 8 || e.code === 429) {
						if (attempt < retries) {
							const backoff = initialBackoffMs * 2 ** (attempt - 1);
							logger.warn({ code: e.code, message: e.message, methodName, attempt, backoff }, 'Quota exceeded, will retry...');
							await sleep(backoff);
							continue;
						}
					}
					throw e;
				}
			}
		}

		return replacementMethod;
	};
}
