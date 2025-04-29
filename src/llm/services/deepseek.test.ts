import { expect } from 'chai';
import { describe, it } from 'mocha';
import { isTimeBetween1630And0030 } from '#llm/services/deepseek';

describe('isTimeBetween1630And0030', () => {
	it('should return false for 16:29:59 UTC', () => {
		const date = new Date('2023-05-20T16:29:59Z');
		expect(isTimeBetween1630And0030(date)).to.be.false;
	});

	it('should return true for 16:30:00 UTC', () => {
		const date = new Date('2023-05-20T16:30:00Z');
		expect(isTimeBetween1630And0030(date)).to.be.true;
	});

	it('should return true for 23:59:59 UTC', () => {
		const date = new Date('2023-05-20T23:59:59Z');
		expect(isTimeBetween1630And0030(date)).to.be.true;
	});

	it('should return true for 00:00:00 UTC', () => {
		const date = new Date('2023-05-21T00:00:00Z');
		expect(isTimeBetween1630And0030(date)).to.be.true;
	});

	it('should return true for 00:29:59 UTC', () => {
		const date = new Date('2023-05-21T00:29:59Z');
		expect(isTimeBetween1630And0030(date)).to.be.true;
	});

	it('should return false for 00:30:00 UTC', () => {
		const date = new Date('2023-05-21T00:30:00Z');
		expect(isTimeBetween1630And0030(date)).to.be.false;
	});

	it('should return false for 16:29:59 UTC (next day)', () => {
		const date = new Date('2023-05-21T16:29:59Z');
		expect(isTimeBetween1630And0030(date)).to.be.false;
	});

	it('should return true for a time within the range', () => {
		const date = new Date('2023-05-20T20:00:00Z');
		expect(isTimeBetween1630And0030(date)).to.be.true;
	});

	it('should return false for a time outside the range', () => {
		const date = new Date('2023-05-21T10:00:00Z');
		expect(isTimeBetween1630And0030(date)).to.be.false;
	});
});
