import { expect } from 'chai';
import sinon from 'sinon';
import { setupConditionalLoggerOutput } from '#test/testUtils';
import * as execModule from '#utils/exec';
import type { ExecResult } from '#utils/exec';
import { ClaudeCode } from './claudeCode';

describe.skip('ClaudeCode', () => {
	setupConditionalLoggerOutput();

	let sandbox: sinon.SinonSandbox;
	let execCommandStub: sinon.SinonStub;
	let claudeCode: ClaudeCode;

	beforeEach(() => {
		sandbox = sinon.createSandbox();
		execCommandStub = sandbox.stub(execModule, 'execCommand');
		claudeCode = new ClaudeCode('Claude Code', 'claude-code', 200_000, () => ({ inputCost: 0, outputCost: 0, totalCost: 0 }));
	});

	afterEach(() => {
		sandbox.restore();
	});

	describe('#generateText', () => {
		it('should successfully generate text with user prompt only', async () => {
			const mockResponse = {
				type: 'result',
				subtype: 'success',
				result: 'Generated response text',
				total_cost_usd: 0.003,
				duration_ms: 1234,
				duration_api_ms: 800,
				num_turns: 6,
				session_id: 'abc123',
				is_error: false,
			};

			execCommandStub.resolves({
				stdout: JSON.stringify(mockResponse),
				stderr: '',
				exitCode: 0,
			} as ExecResult);

			const result = await claudeCode.generateText('Test user prompt');

			expect(result).to.equal('Generated response text');
			expect(execCommandStub).to.have.been.calledOnce;

			const commandArg = execCommandStub.firstCall.args[0];
			expect(commandArg).to.include('claude -p');
			expect(commandArg).to.include('--output-format json');
		});

		it('should successfully generate text with system and user prompts', async () => {
			const mockResponse = {
				type: 'result',
				subtype: 'success',
				result: 'Response with system prompt',
				total_cost_usd: 0.002,
				duration_ms: 900,
				num_turns: 4,
				session_id: 'xyz789',
				is_error: false,
			};

			execCommandStub.resolves({
				stdout: JSON.stringify(mockResponse),
				stderr: '',
				exitCode: 0,
			} as ExecResult);

			const result = await claudeCode.generateText('System instructions', 'User query');

			expect(result).to.equal('Response with system prompt');

			const commandArg = execCommandStub.firstCall.args[0];
			expect(commandArg).to.include('--append-system-prompt');
		});

		it('should handle CLI execution failure', async () => {
			execCommandStub.resolves({
				stdout: '',
				stderr: 'Command not found: claude',
				exitCode: 127,
			} as ExecResult);

			await expect(claudeCode.generateText('Test prompt')).to.be.rejectedWith('Claude Code CLI execution failed');
		});

		it('should handle malformed JSON response', async () => {
			execCommandStub.resolves({
				stdout: 'Not valid JSON',
				stderr: '',
				exitCode: 0,
			} as ExecResult);

			await expect(claudeCode.generateText('Test prompt')).to.be.rejectedWith('Failed to parse Claude Code response');
		});

		it('should handle error response from Claude Code', async () => {
			const mockErrorResponse = {
				type: 'result',
				subtype: 'error',
				result: 'Something went wrong',
				total_cost_usd: 0.001,
				duration_ms: 500,
				num_turns: 1,
				session_id: 'err123',
				is_error: true,
			};

			execCommandStub.resolves({
				stdout: JSON.stringify(mockErrorResponse),
				stderr: '',
				exitCode: 0,
			} as ExecResult);

			await expect(claudeCode.generateText('Test prompt')).to.be.rejectedWith('Claude Code error: Something went wrong');
		});

		it('should properly escape shell arguments with single quotes', async () => {
			const mockResponse = {
				type: 'result',
				subtype: 'success',
				result: 'Response',
				total_cost_usd: 0.001,
				duration_ms: 500,
				num_turns: 1,
				session_id: 'test',
				is_error: false,
			};

			execCommandStub.resolves({
				stdout: JSON.stringify(mockResponse),
				stderr: '',
				exitCode: 0,
			} as ExecResult);

			await claudeCode.generateText("Prompt with 'single quotes'");

			const commandArg = execCommandStub.firstCall.args[0];
			// The escaping should convert ' to '\''
			expect(commandArg).to.include("'Prompt with '\\''single quotes'\\'''");
		});
	});

	describe('#isConfigured', () => {
		it('should return true', () => {
			expect(claudeCode.isConfigured()).to.be.true;
		});
	});

	describe('#getId', () => {
		it('should return correct service:model format', () => {
			expect(claudeCode.getId()).to.equal('claude-code:claude-code');
		});
	});

	describe('#getDisplayName', () => {
		it('should return the display name', () => {
			expect(claudeCode.getDisplayName()).to.equal('Claude Code');
		});
	});
});
