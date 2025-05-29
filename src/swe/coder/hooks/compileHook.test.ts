import * as path from 'node:path';
import { expect } from 'chai';
import * as sinon from 'sinon';
import { FileSystemService } from '#functions/storage/fileSystemService';
import { logger } from '#o11y/logger';
import type { IFileSystemService } from '#shared/services/fileSystemService';
import { setupConditionalLoggerOutput } from '#test/testUtils';
import * as execModule from '#utils/exec';
import type { EditSession } from '../editSession';
import { newSession } from '../editSession';
import { CompileHook } from './compileHook';

describe('CompileHook', () => {
	setupConditionalLoggerOutput();
	let execCommandStub: sinon.SinonStub;
	let session: EditSession;
	let mockFsService: sinon.SinonStubbedInstance<IFileSystemService>;

	beforeEach(() => {
		execCommandStub = sinon.stub(execModule, 'execCommand');
		session = newSession('/test/dir', 'user request');
		// Create a stubbed instance of IFileSystemService
		// You might need to adjust this if FileSystemService has complex constructor or dependencies
		// For simplicity, we're stubbing methods directly.
		mockFsService = sinon.createStubInstance(FileSystemService); // Use a concrete class for stubbing if IFileSystemService is just an interface
		// Default stub for fileExists, can be overridden in specific tests
		mockFsService.fileExists.resolves(false);
	});

	afterEach(() => {
		sinon.restore();
	});

	it('should return ok:true if compile command is not provided', async () => {
		const hook = new CompileHook(undefined, mockFsService); // No compile command
		const result = await hook.run(session);
		expect(result.ok).to.be.true;
		expect(result.message).to.equal('No compile command configured.');
		sinon.assert.notCalled(execCommandStub);
	});

	it('should return ok:false if FileSystem service is not provided (misconfiguration)', async () => {
		const hook = new CompileHook('make', undefined as any); // Force undefined fs
		const result = await hook.run(session);
		expect(result.ok).to.be.false;
		expect(result.message).to.equal('CompileHook misconfigured: FileSystem service missing.');
	});

	it('should return ok:true if compile command succeeds (exit code 0)', async () => {
		const compileCmd = 'npm run build';
		execCommandStub.withArgs(compileCmd, { workingDirectory: session.workingDir }).resolves({ exitCode: 0, stdout: 'Build successful', stderr: '' });

		const hook = new CompileHook(compileCmd, mockFsService);
		const result = await hook.run(session);

		expect(result.ok).to.be.true;
		expect(result.message).to.be.undefined;
		sinon.assert.calledOnceWithExactly(execCommandStub, compileCmd, { workingDirectory: session.workingDir });
	});

	it('should return ok:false with stderr message if compile command fails (non-zero exit code) and no additional files found', async () => {
		const compileCmd = 'npm run build';
		const stderrMessage = 'Compilation failed: Error X';
		const stdoutMessage = 'Some output before failure';
		execCommandStub.withArgs(compileCmd, { workingDirectory: session.workingDir }).resolves({ exitCode: 1, stdout: stdoutMessage, stderr: stderrMessage });

		const hook = new CompileHook(compileCmd, mockFsService);
		const result = await hook.run(session);

		expect(result.ok).to.be.false;
		const expectedMessage = `Stderr:\n${stderrMessage}\n\nStdout:\n${stdoutMessage}`;
		expect(result.message).to.equal(expectedMessage); // Not truncated in this case
		sinon.assert.calledOnceWithExactly(execCommandStub, compileCmd, { workingDirectory: session.workingDir });
		expect(result.additionalFiles).to.be.an('array').that.is.empty;
	});

	it('should truncate the message if it exceeds 4000 characters', async () => {
		const compileCmd = 'npm run build';
		const longStderr = 'a'.repeat(5000);
		execCommandStub.withArgs(compileCmd, { workingDirectory: session.workingDir }).resolves({ exitCode: 1, stdout: '', stderr: longStderr });

		const hook = new CompileHook(compileCmd, mockFsService);
		const result = await hook.run(session);

		expect(result.ok).to.be.false;
		const expectedMessage = `Stderr:\n${longStderr}\n\nStdout:\n`;
		expect(result.message).to.equal(expectedMessage.slice(0, 4000));
		expect(result.message?.length).to.equal(4000);
	});

	it('should return ok:false if execCommand throws an error', async () => {
		const compileCmd = 'npm run build';
		const errorMessage = 'Command not found';
		execCommandStub.withArgs(compileCmd, { workingDirectory: session.workingDir }).rejects(new Error(errorMessage));

		const hook = new CompileHook(compileCmd, mockFsService);
		const result = await hook.run(session);

		expect(result.ok).to.be.false;
		expect(result.message).to.equal(`Error executing compile command: ${errorMessage}`);
		sinon.assert.calledOnceWithExactly(execCommandStub, compileCmd, { workingDirectory: session.workingDir });
	});

	describe('Additional File Extraction on Compile Failure', () => {
		const compileCmd = 'make test';
		const workingDir = path.normalize('/project/root'); // Normalize for cross-platform consistency

		beforeEach(() => {
			session = newSession(workingDir, 'user request');
			session.absFnamesInChat = new Set(); // Initialize as empty
		});

		it('should extract new, valid relative file paths from compiler output', async () => {
			const output = 'Error in file.ts:10:5\nAnother error in sub/another.go:3:2';
			execCommandStub.resolves({ exitCode: 1, stdout: '', stderr: output });

			const absFileTs = path.join(workingDir, 'file.ts');
			const absAnotherGo = path.join(workingDir, 'sub/another.go');
			mockFsService.fileExists.withArgs(absFileTs).resolves(true);
			mockFsService.fileExists.withArgs(absAnotherGo).resolves(true);

			const hook = new CompileHook(compileCmd, mockFsService);
			const result = await hook.run(session);

			expect(result.ok).to.be.false;
			expect(result.additionalFiles).to.deep.members([path.normalize('file.ts'), path.normalize('sub/another.go')]);
		});

		it('should extract new, valid absolute file paths from compiler output and convert to relative', async () => {
			const absFileJs = path.join(workingDir, 'src/app.js');
			const output = `Error in ${absFileJs}:1:1`;
			execCommandStub.resolves({ exitCode: 1, stdout: output, stderr: '' });

			mockFsService.fileExists.withArgs(absFileJs).resolves(true);

			const hook = new CompileHook(compileCmd, mockFsService);
			const result = await hook.run(session);

			expect(result.ok).to.be.false;
			expect(result.additionalFiles).to.deep.equal([path.normalize('src/app.js')]);
		});

		it('should ignore file paths already in session.absFnamesInChat', async () => {
			const fileInChatRel = path.normalize('lib/inchat.ts');
			const fileInChatAbs = path.join(workingDir, fileInChatRel);
			session.absFnamesInChat = new Set([fileInChatAbs]);

			const newFileRel = path.normalize('new/mod.rs');
			const newFileAbs = path.join(workingDir, newFileRel);

			const output = `Error in ${fileInChatRel}:1:1\nProblem with ${newFileAbs}:2:2`;
			execCommandStub.resolves({ exitCode: 1, stdout: '', stderr: output });

			mockFsService.fileExists.withArgs(fileInChatAbs).resolves(true);
			mockFsService.fileExists.withArgs(newFileAbs).resolves(true);

			const hook = new CompileHook(compileCmd, mockFsService);
			const result = await hook.run(session);

			expect(result.ok).to.be.false;
			expect(result.additionalFiles).to.deep.equal([newFileRel]);
		});

		it('should ignore file paths outside the working directory', async () => {
			const outsideFile = path.normalize('/tmp/outside.txt'); // Absolute path outside workingDir
			const insideFileRel = path.normalize('src/inside.py');
			const insideFileAbs = path.join(workingDir, insideFileRel);

			const output = `Error in ${outsideFile}\nIssue with ${insideFileRel}`;
			execCommandStub.resolves({ exitCode: 1, stdout: '', stderr: output });

			mockFsService.fileExists.withArgs(outsideFile).resolves(true); // Assume it exists for test purposes
			mockFsService.fileExists.withArgs(insideFileAbs).resolves(true);

			const hook = new CompileHook(compileCmd, mockFsService);
			const result = await hook.run(session);

			expect(result.ok).to.be.false;
			expect(result.additionalFiles).to.deep.equal([insideFileRel]);
		});

		it('should ignore file paths that do not exist', async () => {
			const nonExistentFile = path.normalize('ghost.cpp');
			const existingFileRel = path.normalize('real.java');
			const existingFileAbs = path.join(workingDir, existingFileRel);

			const output = `Error in ${nonExistentFile}\nIssue with ${existingFileRel}`;
			execCommandStub.resolves({ exitCode: 1, stdout: '', stderr: output });

			mockFsService.fileExists.withArgs(path.join(workingDir, nonExistentFile)).resolves(false);
			mockFsService.fileExists.withArgs(existingFileAbs).resolves(true);

			const hook = new CompileHook(compileCmd, mockFsService);
			const result = await hook.run(session);

			expect(result.ok).to.be.false;
			expect(result.additionalFiles).to.deep.equal([existingFileRel]);
		});

		it('should handle paths with line/column numbers and trailing colons/quotes', async () => {
			const file1Rel = path.normalize('path/to/file1.c');
			const file1Abs = path.join(workingDir, file1Rel);
			const file2Rel = path.normalize('another/file2.ts');
			const file2Abs = path.join(workingDir, file2Rel);
			const file3Rel = path.normalize('quoted file.js');
			const file3Abs = path.join(workingDir, file3Rel);

			const output = `Error: ${file1Rel}:10:5: message\nWarning: "${file2Abs}": line 20\nNote: '${file3Rel}'`;
			execCommandStub.resolves({ exitCode: 1, stdout: output, stderr: '' });

			mockFsService.fileExists.withArgs(file1Abs).resolves(true);
			mockFsService.fileExists.withArgs(file2Abs).resolves(true);
			mockFsService.fileExists.withArgs(file3Abs).resolves(true);

			const hook = new CompileHook(compileCmd, mockFsService);
			const result = await hook.run(session);

			expect(result.ok).to.be.false;
			expect(result.additionalFiles).to.deep.members([file1Rel, file2Rel, file3Rel]);
		});

		it('should handle output with no file paths', async () => {
			const output = 'Generic error message without paths.';
			execCommandStub.resolves({ exitCode: 1, stdout: '', stderr: output });

			const hook = new CompileHook(compileCmd, mockFsService);
			const result = await hook.run(session);

			expect(result.ok).to.be.false;
			expect(result.additionalFiles).to.be.an('array').that.is.empty;
		});

		it('should handle empty output', async () => {
			const output = '';
			execCommandStub.resolves({ exitCode: 1, stdout: output, stderr: output });

			const hook = new CompileHook(compileCmd, mockFsService);
			const result = await hook.run(session);

			expect(result.ok).to.be.false;
			expect(result.additionalFiles).to.be.an('array').that.is.empty;
		});

		it('should handle paths with mixed separators (if OS allows)', async () => {
			// This test is more relevant on Windows, but we normalize paths anyway.
			const file1Rel = path.normalize('path/with\\mixed/separators.txt');
			const file1Abs = path.join(workingDir, file1Rel); // path.join normalizes

			const output = `Error in ${file1Rel}:1`;
			execCommandStub.resolves({ exitCode: 1, stdout: output, stderr: '' });

			mockFsService.fileExists.withArgs(file1Abs).resolves(true);

			const hook = new CompileHook(compileCmd, mockFsService);
			const result = await hook.run(session);

			expect(result.ok).to.be.false;
			// The extracted path should be normalized to the OS standard by path.join/resolve
			expect(result.additionalFiles).to.deep.equal([path.normalize('path/with/mixed/separators.txt')]);
		});
	});
});
