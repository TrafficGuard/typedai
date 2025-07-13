import { existsSync, unlinkSync } from 'node:fs';
import { expect } from 'chai';
import { systemDir } from '#app/appDirs';
import { setupConditionalLoggerOutput } from '#test/testUtils';
// Import the error type and the modified function
import { CliArgumentError, parseUserCliArgs, saveAgentId } from './cli';

describe('parseUserCliArgs', () => {
	setupConditionalLoggerOutput();
	const stateFilePath = `${systemDir()}/cli/test.lastRun`;

	beforeEach(() => {
		safeUnlink(stateFilePath);
	});

	afterEach(() => {
		safeUnlink(stateFilePath);
	});

	function safeUnlink(file: string): void {
		try {
			if (existsSync(file)) unlinkSync(file);
			// existsSync may occasionally return a stale result when mock-fs is active,
			// so swallow ENOENT that appears between the check and the unlink
		} catch (err: any) {
			if (err.code !== 'ENOENT') throw err;
		}
	}

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

	// Test was: 'should ignore -r if no state file exists'
	it('should throw error if -r used and no state file exists', () => {
		// Use expect(...).to.throw() to assert the specific error is thrown
		expect(() => parseUserCliArgs('test', ['-r', 'some', 'initial', 'prompt'])).to.throw(CliArgumentError, 'No agentId to resume');
	});

	// Test was: 'should handle multiple -r flags'
	it('should throw error if multiple -r flags used and no state file exists', () => {
		expect(() => parseUserCliArgs('test', ['-r', '-r', 'some', 'initial', 'prompt'])).to.throw(CliArgumentError, 'No agentId to resume');
	});

	it('should handle multiple -r flags (and resume if state file exists)', () => {
		saveAgentId('test', 'id');
		const result = parseUserCliArgs('test', ['-r', '-r', 'some', 'initial', 'prompt']);
		expect(result.resumeAgentId).to.equal('id');
		expect(result.initialPrompt).to.equal('some initial prompt');
	});

	it('should handle empty args', () => {
		const result = parseUserCliArgs('test', []);
		expect(result.resumeAgentId).to.be.undefined;
		expect(result.initialPrompt).to.be.empty;
	});
});
