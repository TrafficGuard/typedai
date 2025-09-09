export async function sleep(millis: number): Promise<void> {
	return new Promise((resolve) => {
		setTimeout(() => resolve(void null), millis);
	});
}

/**
 * Represents the result structure containing categorized outcomes.
 * T = Input type
 * R = Resolved value type of the promise
 */
export interface SettledWithInputResult<T, R> {
	/** Array of fulfilled promises. */
	fulfilled: R[];
	/** Array of pairs: [originalInput, resolvedValue] for fulfilled promises. */
	fulfilledInputs: [T, R][];
	/** Array of {input, reason} for rejected promises. */
	rejected: { input: T; reason: any }[]; // Using unknown is generally safer than any for errors
}

/**
 * Executes an async function for each item in an input array, waits for all to settle
 * using Promise.allSettled, and returns the results categorized into fulfilled and
 * rejected, maintaining the association with the original input item via index matching.
 *
 * @template T The type of the input items.
 * @template R The type of the value the async function's promise resolves to.
 * @param inputs An array of input items.
 * @param asyncFn An async function that takes an input item and returns a Promise<R>.
 * @returns A Promise resolving to an object with 'fulfilled' and 'rejected' arrays.
 */
export async function settleAllWithInput<T, R>(inputs: T[], asyncFn: (input: T) => Promise<R>): Promise<SettledWithInputResult<T, R>> {
	// Create an array of promises by applying the async function to each input.
	// The order of this array matches the order of the `inputs` array.
	const promises = inputs.map((input) => asyncFn(input));

	// Wait for all promises to settle using Promise.allSettled.
	// The `settledResults` array will contain result objects in the *same order*
	// as the `promises` (and thus the `inputs`) array.
	const settledResults = await Promise.allSettled(promises);

	// Initialize the structure to hold categorized results.
	const categorizedResults: SettledWithInputResult<T, R> = {
		fulfilled: [],
		fulfilledInputs: [],
		rejected: [],
	};

	// Iterate through the settled results, using the index to link back to the original input.
	settledResults.forEach((result, index) => {
		const originalInput = inputs[index];

		if (result.status === 'fulfilled') {
			// TypeScript knows `result.value` is of type R here.
			categorizedResults.fulfilledInputs.push([originalInput, result.value]);
			categorizedResults.fulfilled.push(result.value);
		} else {
			// status === 'rejected'
			categorizedResults.rejected.push({ input: originalInput, reason: result.reason });
		}
	});

	return categorizedResults;
}

/**
 * Gets all the fulfilled promises from an array of settled promises.
 * @param promises
 */
export async function allSettledAndFulFilled<T>(promises: Promise<T>[]): Promise<T[]> {
	const settled = await Promise.allSettled(promises);
	return getFulfilled(settled);
}

export function getFulfilled<T>(settledResults: PromiseSettledResult<T>[]): T[] {
	const rejects = settledResults.filter((result) => result.status === 'rejected').map((result) => (result as PromiseRejectedResult).reason);
	console.log(rejects);
	return settledResults.filter((result) => result.status === 'fulfilled').map((result) => (result as PromiseFulfilledResult<T>).value);
}

export interface ResolvablePromise<T> extends Promise<T> {
	resolveValue: (value: T) => void;
}
export function resolvablePromise<T>(): ResolvablePromise<T> {
	let resolver: (value: T) => void;
	const promise: any = new Promise((resolve) => {
		resolver = resolve;
	});
	promise.resolveValue = (value: T) => {
		resolver(value);
	};
	return promise;
}

// export class Mutex {
// 	private lock: ResolvablePromise<void> | null = null;

// 	async run<T>(func: () => Promise<T>): Promise<T> {
// 		while (this.lock) {
// 			await this.lock;
// 		}

// 		this.lock = resolvablePromise();
// 		try {
// 			return func();
// 		} finally {
// 			this.lock.resolveValue();
// 			this.lock = null;
// 		}
// 	}
// }

// export function mutex(originalMethod: any, context: ClassMethodDecoratorContext): any {
// 	context.addInitializer(function () {
// 		this[context.name] = this[context.name].bind(this);
// 	});
// 	return function replacementMethod(this: any, ...args: any[]) {
// 		return this.mutex.run(async () => {
// 			return originalMethod.call(this, ...args);
// 		});
// 	};
// }

/**
 * Executes a list of promises in batches
 */
export async function batch<T>(promises: Promise<T>[], batchSize: number): Promise<T[]> {
	const results: T[] = [];
	for (let i = 0; i < promises.length; i += batchSize) {
		const end = Math.min(i + batchSize, promises.length);
		const batch = promises.slice(i, end);
		results.push(...(await Promise.all(batch)));
	}
	return results;
}
