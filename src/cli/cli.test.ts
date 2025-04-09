import { existsSync } from 'node:fs';
import { unlinkSync } from 'node:fs';
import { expect } from 'chai';
import { systemDir } from '../appVars';
import { parseUserCliArgs, saveAgentId } from './cli';

describe('parseProcessArgs', () => {
	beforeEach(() => {
		if (existsSync(`${systemDir()}/cli/test.lastRun`)) unlinkSync(`${systemDir()}/cli/test.lastRun`);
		// if (existsSync('.typedai/cli/test')) unlinkSync('.typedai/cli/test');
	});

	it('should parse -r flag correctly and set resumeAgentId if the state file exists', () => {
		saveAgentId('test', 'id');
		const result = parseUserCliArgs('test', ['-r', 'some', 'initial', 'prompt']);
		expect(result.resumeAgentId).to.equal('id');
		expect(result.initialPrompt).to.equal('some initial prompt');
	});

	it('should handle no -r flag', () => {
		const result = parseUserCliArgs('test', ['some', 'initial', 'prompt']);
		expect(result.resumeAgentId).to.be.undefined;
		expect(result.initialPrompt).to.equal('some initial prompt');
	});

	it('should ignore -r if no state file exists', () => {
		const result = parseUserCliArgs('test', ['-r', 'some', 'initial', 'prompt']);
		expect(result.resumeAgentId).to.be.undefined;
		expect(result.initialPrompt).to.equal('some initial prompt');
	});

	it('should handle multiple -r flags', () => {
		const result = parseUserCliArgs('test', ['-r', '-r', 'some', 'initial', 'prompt']);
		expect(result.initialPrompt).to.equal('some initial prompt');
	});

	it('should handle empty args', () => {
		const result = parseUserCliArgs('test', []);
		expect(result.resumeAgentId).to.be.undefined;
		expect(result.initialPrompt).to.be.empty;
	});
});
