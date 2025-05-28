import { expect } from 'chai';
import { ModuleAliasRule } from './ModuleAliasRule';
import type { EditBlock } from '../applySearchReplace';
import { setupConditionalLoggerOutput } from '#test/testUtils';

describe('ModuleAliasRule', () => {
	setupConditionalLoggerOutput();
	const rule = new ModuleAliasRule();

	const createEditBlock = (filePath: string): EditBlock => ({
		filePath,
		originalText: 'original',
		updatedText: 'updated',
	});

	it('should return an issue if filePath starts with #', () => {
		const block = createEditBlock('#module/file.ts');
		const issue = rule.check(block, []);
		expect(issue).to.deep.equal({
			file: '#module/file.ts',
			reason: `File path "#module/file.ts" should not begin with '#'. It seems like you're writing to a module alias. You need to write to a real file path.`,
		});
	});

	it('should return an issue if filePath starts with @', () => {
		const block = createEditBlock('@scope/file.ts');
		const issue = rule.check(block, []);
		expect(issue).to.deep.equal({
			file: '@scope/file.ts',
			reason: `File path "@scope/file.ts" should not begin with '@'. It seems like you're writing to a module alias. You need to write to a real file path.`,
		});
	});

	it('should return null if filePath is valid', () => {
		const block = createEditBlock('src/module/file.ts');
		expect(rule.check(block, [])).to.be.null;
	});

	it('should return null for empty filePath (other rules might catch this)', () => {
		const block = createEditBlock('');
		expect(rule.check(block, [])).to.be.null;
	});
});
