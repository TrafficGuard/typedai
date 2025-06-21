import { expect } from 'chai';
import { setupConditionalLoggerOutput } from '#test/testUtils';
import { ResponseProcessor } from './ResponseProcessor';

describe('ResponseProcessor', () => {
	setupConditionalLoggerOutput();

	it('should be defined', () => {
		expect(new ResponseProcessor(['', ''], 'diff')).to.exist;
	});
});
