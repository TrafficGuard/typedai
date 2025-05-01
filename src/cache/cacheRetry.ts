import { appContext } from '#app/applicationContext';
import { FUNC_SEP } from '#functionSchema/functions';
import { logger } from '#o11y/logger';
import type { CacheScope } from './functionCacheService';

interface CacheRetryOptions {
	retries: number;
	backOffMs: number;
	ttlSeconds?: number;
	/** Version of type of the data returned/cached. If you modify the method so that the cached values are incompatible, then increment the version.  */
	version: number;
	/** Cache scope. If no value is provided then the function call results won't be cached. */
	scope?: CacheScope;
}

const DEFAULTS = { retries: 5, backOffMs: 250, version: 1 };

function optionsWithDefaults(opts: Partial<CacheRetryOptions>): CacheRetryOptions {
	return { ...DEFAULTS, ...opts };
}

export class RetryableError extends Error {
	constructor(originalError: Error) {
		super();
		this.name = originalError.name;
		this.message = originalError.message;
		this.stack = originalError.stack;
	}
}

/**
 * Decorator for adding caching and retries to a class method
 * @param options
 */
export function cacheRetry(options: Partial<CacheRetryOptions> = DEFAULTS) {
	return function cacheRetryDecorator(originalMethod: any, context: ClassMethodDecoratorContext) {
		const methodName = String(context.name);

		async function replacementMethod(this: any, ...args: any[]) {
			const cacheRetryOptions = optionsWithDefaults(options);

			const cacheService = appContext().functionCacheService;

			if (cacheRetryOptions.scope) {
				const cachedValue = await cacheService.getValue(cacheRetryOptions.scope, this.constructor.name, methodName, args);

				if (cachedValue !== undefined) {
					logger.debug(`Cached return for ${this.constructor.name}${FUNC_SEP}${methodName}`);
					return cachedValue;
				}
			}

			for (let attempt = 1; attempt <= cacheRetryOptions.retries; attempt++) {
				if (attempt > 1) logger.debug(`${this.constructor.name}${FUNC_SEP}${methodName} retry ${attempt - 1}`);
				try {
					let result = originalMethod.apply(this, args);
					if (typeof result?.then === 'function') result = await result;
					// convert undefined to null as we use undefined to indicate there's no cached value
					if (result === undefined) result = null;
					if (cacheRetryOptions.scope) {
						await cacheService.setValue(cacheRetryOptions.scope, this.constructor.name, methodName, args, result);
					}
					return result;
				} catch (error) {
					if (!(error instanceof RetryableError)) throw error;
					// NOT retryable ===============
					// if (error.message?.includes('Cannot read properties of undefined')) {
					// 	throw error;
					// }

					logger.debug(`Retry decorator attempt #${attempt} error ${error.message}`);
					if (attempt < cacheRetryOptions.retries) {
						await new Promise((resolve) => setTimeout(resolve, cacheRetryOptions.backOffMs * (attempt * attempt)));
					} else {
						throw error;
					}
				}
			}
		}

		return replacementMethod;
	};
}
