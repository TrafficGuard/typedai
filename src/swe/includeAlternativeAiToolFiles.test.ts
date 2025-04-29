import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { expect } from 'chai';
import sinon from 'sinon';
import { includeAlternativeAiToolFiles } from './includeAlternativeAiToolFiles';

describe.skip('includeAlternativeAiToolFiles', () => {
	before(() => {
		// validate that the CONVENTION.md files exists where we expect
		if (!fs.existsSync(join(process.cwd(), 'CONVENTIONS.md'))) throw new Error('CONVENTIONS.md file not found');
		if (!fs.existsSync(join(process.cwd(), 'src/CONVENTIONS.md'))) throw new Error('src/CONVENTIONS.md file not found');
		if (!fs.existsSync(join(process.cwd(), 'frontend/CONVENTIONS.md'))) throw new Error('frontend/CONVENTIONS.md file not found');
	});

	it('should add convention files from parent directories', async () => {
		const fileSelection = ['src/index.ts'];
		await includeAlternativeAiToolFiles(['src/index.ts']);
		console.log(fileSelection);
		expect(fileSelection).to.include(join(process.cwd(), 'CONVENTIONS.md'));
		expect(fileSelection).to.include(join(process.cwd(), 'src/CONVENTIONS.md'));
	});
});
