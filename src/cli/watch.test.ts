import { expect } from 'chai';
import { extractInstructionBlock } from './watch';

describe('extractInstructionBlock', () => {
	it('extracts single-line instruction block', () => {
		const content = ['const x = 1;', '@@@ Replace x with y @@', 'console.log(x);'].join('\n');

		const result = extractInstructionBlock(content);
		expect(result).to.equal('Replace x with y');
	});

	it('extracts multi-line instruction block', () => {
		const content = [
			'function foo() {',
			'  // start instructions',
			'@@@',
			'Rename function foo to bar',
			'Update all references',
			'Ensure types are correct',
			'@@',
			'  // end instructions',
			'}',
		].join('\n');

		const result = extractInstructionBlock(content);
		expect(result).to.equal(['Rename function foo to bar', 'Update all references', 'Ensure types are correct'].join('\n'));
	});

	it('returns null when no instruction block is present', () => {
		const content = 'console.log("no instructions here");';
		const result = extractInstructionBlock(content);
		expect(result).to.equal(null);
	});
});
