import { expect } from 'chai';
import { setupConditionalLoggerOutput } from '#test/testUtils';
import type { EditBlock } from '../coderTypes';
import { PathExistsRule } from './pathExistsRule';

describe('PathExistsRule', () => {
	setupConditionalLoggerOutput();
	const rule = new PathExistsRule();

	const createEditBlock = (filePath: string, originalText: string): EditBlock => ({
		filePath,
		originalText,
		updatedText: 'some updated text',
	});

	it('should return null if file exists', async () => {
		const block = createEditBlock('existing.ts', 'some original text');
		const repoFiles = ['existing.ts', 'other.ts'];
		expect(await rule.check(block, repoFiles)).to.be.null;
	});

	it('should return null if file does not exist and originalText is empty', async () => {
		const block = createEditBlock('new.ts', '');
		const repoFiles = ['existing.ts'];
		expect(await rule.check(block, repoFiles)).to.be.null;
	});

	it('should return null if file does not exist and originalText is whitespace', async () => {
		const block = createEditBlock('new.ts', '   \n   ');
		const repoFiles = ['existing.ts'];
		expect(await rule.check(block, repoFiles)).to.be.null;
	});

	it('should return an issue if file does not exist and originalText is not empty', async () => {
		const block = createEditBlock('new.ts', 'some original text');
		const repoFiles = ['existing.ts'];
		const issue = await rule.check(block, repoFiles);
		expect(issue).to.deep.equal({
			file: 'new.ts',
			reason: 'File does not exist, but the SEARCH block is not empty. To create a new file, the SEARCH block must be empty.',
		});
	});
});
