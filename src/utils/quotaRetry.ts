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
 * Check if error is a rate limit / quota error
 */
export function isQuotaError(e: any): boolean {
	// gRPC code 8 is RESOURCE_EXHAUSTED
	if (e.code === 8) return true;
	// HTTP 429 is Too Many Requests
	if (e.code === 429 || e.status === 429 || e.statusCode === 429) return true;
	// Internal server error (sometimes transient)
	if (e.code === 500) return true;
	// OpenAI specific rate limit error code (can be on error or nested error object)
	if (e.code === 'rate_limit_exceeded' || e.error?.code === 'rate_limit_exceeded') return true;
	// Vercel AI SDK wraps errors
	if (e.name === 'AI_APICallError' && e.statusCode === 429) return true;
	// Check nested error in AI_RetryError
	if (e.name === 'AI_RetryError' && Array.isArray(e.errors)) {
		if (e.errors.some((nested: any) => isQuotaError(nested))) return true;
	}
	// Check error message for rate limit keywords (check both top-level and nested message)
	const message = (e.message || e.error?.message || '').toLowerCase();
	if (message.includes('rate limit') || message.includes('rate_limit') || message.includes('quota exceeded') || message.includes('resource_exhausted')) {
		return true;
	}
	// Special case: no assistant message (sometimes happens with overloaded APIs)
	if (e.message === 'No assistant message found') return true;

	return false;
}

/**
 * Parse retry delay from error message.
 * Looks for patterns like "Please try again in 345ms" or "retry after 1.5s"
 * Returns delay in milliseconds, or undefined if not found.
 */
export function parseRetryDelay(e: any): number | undefined {
	const message = e.message || e.error?.message || '';

	// Pattern: "Please try again in XXXms" or "try again in XXX ms"
	const msMatch = message.match(/try again in (\d+(?:\.\d+)?)\s*ms/i);
	if (msMatch) {
		return Math.ceil(Number.parseFloat(msMatch[1]));
	}

	// Pattern: "try again in X.Xs" or "retry after Xs"
	const secMatch = message.match(/(?:try again|retry after) (\d+(?:\.\d+)?)\s*s(?:ec(?:ond)?s?)?/i);
	if (secMatch) {
		return Math.ceil(Number.parseFloat(secMatch[1]) * 1000);
	}

	// Check for Retry-After header (in seconds)
	if (e.headers?.['retry-after']) {
		const retryAfter = Number.parseInt(e.headers['retry-after'], 10);
		if (!Number.isNaN(retryAfter)) {
			return retryAfter * 1000;
		}
	}

	return undefined;
}

/**
 * Decorator for retrying a method on quota errors (gRPC code 8 or HTTP 429).
 * Uses exponential backoff, or respects "retry after" hints from the error message.
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
					if (isQuotaError(e)) {
						if (attempt < retries) {
							// Try to parse delay from error message first
							const parsedDelay = parseRetryDelay(e);
							// Use parsed delay (with small buffer) or fall back to exponential backoff
							const backoff = parsedDelay ? parsedDelay + 100 : initialBackoffMs * 2 ** (attempt - 1);
							logger.warn(
								{ code: e.code, message: e.message, methodName, attempt, backoff, parsedDelay },
								`Rate limit/quota exceeded, retrying in ${backoff}ms...`,
							);
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
