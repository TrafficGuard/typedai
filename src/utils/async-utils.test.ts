import { expect } from 'chai';
import sinon from 'sinon';
import { batch, resolvablePromise, sleep } from './async-utils';

describe('async-utils', () => {
	describe('sleep', () => {
		it('should resolve after the specified number of milliseconds', async () => {
			const start = Date.now();
			await sleep(100);
			const end = Date.now();
			expect(end - start).to.be.gte(99);
		});
	});

	describe('resolvablePromise', () => {
		it('should resolve with the provided value', async () => {
			const promise = resolvablePromise<number>();
			promise.resolveValue(10);
			expect(await promise).to.equal(10);
		});
	});

	describe('batch', () => {
		it('should execute promises in batches', async () => {
			const promises: Array<Promise<number>> = [];
			for (let i = 0; i < 100; i++) {
				promises.push(Promise.resolve(i));
			}
			const results = await batch(promises, 10);
			expect(results).to.deep.equal([
				0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39,
				40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 51, 52, 53, 54, 55, 56, 57, 58, 59, 60, 61, 62, 63, 64, 65, 66, 67, 68, 69, 70, 71, 72, 73, 74, 75, 76, 77,
				78, 79, 80, 81, 82, 83, 84, 85, 86, 87, 88, 89, 90, 91, 92, 93, 94, 95, 96, 97, 98, 99,
			]);
		});
	});
});
