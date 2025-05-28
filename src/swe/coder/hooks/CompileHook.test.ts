import { expect } from 'chai';
import * as sinon from 'sinon';
import { logger } from '#o11y/logger';
import { setupConditionalLoggerOutput } from '#test/testUtils';
import * as execModule from '#utils/exec';
import type { EditSession } from '../EditSession';
import { newSession } from '../EditSession';
import { CompileHook } from './CompileHook';

describe('CompileHook', () => {
	setupConditionalLoggerOutput();
	let execCommandStub: sinon.SinonStub;
	let session: EditSession;

	beforeEach(() => {
		execCommandStub = sinon.stub(execModule, 'execCommand');
		session = newSession('/test/dir', 'user request');
	});

	afterEach(() => {
		sinon.restore();
	});

	it('should return ok:true if compile command is not provided', async () => {
		const hook = new CompileHook(undefined); // No compile command
		const result = await hook.run(session);
		expect(result.ok).to.be.true;
		expect(result.message).to.equal('No compile command configured.');
		sinon.assert.notCalled(execCommandStub);
	});

	it('should return ok:true if compile command succeeds (exit code 0)', async () => {
		const compileCmd = 'npm run build';
		execCommandStub.withArgs(compileCmd, { cwd: session.workingDir }).resolves({ exitCode: 0, stdout: 'Build successful', stderr: '' });

		const hook = new CompileHook(compileCmd);
		const result = await hook.run(session);

		expect(result.ok).to.be.true;
		expect(result.message).to.be.undefined;
		sinon.assert.calledOnceWithExactly(execCommandStub, compileCmd, { cwd: session.workingDir });
	});

	it('should return ok:false with stderr message if compile command fails (non-zero exit code)', async () => {
		const compileCmd = 'npm run build';
		const stderrMessage = 'Compilation failed: Error X';
		const stdoutMessage = 'Some output before failure';
		execCommandStub.withArgs(compileCmd, { cwd: session.workingDir }).resolves({ exitCode: 1, stdout: stdoutMessage, stderr: stderrMessage });

		const hook = new CompileHook(compileCmd);
		const result = await hook.run(session);

		expect(result.ok).to.be.false;
		const expectedMessage = `Stderr:\n${stderrMessage}\n\nStdout:\n${stdoutMessage}`;
		expect(result.message).to.equal(expectedMessage); // Not truncated in this case
		sinon.assert.calledOnceWithExactly(execCommandStub, compileCmd, { cwd: session.workingDir });
	});

	it('should truncate the message if it exceeds 4000 characters', async () => {
		const compileCmd = 'npm run build';
		const longStderr = 'a'.repeat(5000);
		execCommandStub.withArgs(compileCmd, { cwd: session.workingDir }).resolves({ exitCode: 1, stdout: '', stderr: longStderr });

		const hook = new CompileHook(compileCmd);
		const result = await hook.run(session);

		expect(result.ok).to.be.false;
		const expectedMessage = `Stderr:\n${longStderr}\n\nStdout:\n`;
		expect(result.message).to.equal(expectedMessage.slice(0, 4000));
		expect(result.message?.length).to.equal(4000);
	});

	it('should return ok:false if execCommand throws an error', async () => {
		const compileCmd = 'npm run build';
		const errorMessage = 'Command not found';
		execCommandStub.withArgs(compileCmd, { cwd: session.workingDir }).rejects(new Error(errorMessage));

		const hook = new CompileHook(compileCmd);
		const result = await hook.run(session);

		expect(result.ok).to.be.false;
		expect(result.message).to.equal(`Error executing compile command: ${errorMessage}`);
		sinon.assert.calledOnceWithExactly(execCommandStub, compileCmd, { cwd: session.workingDir });
	});
});
