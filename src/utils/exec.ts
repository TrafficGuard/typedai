import { ExecException, ExecSyncOptions, SpawnOptionsWithoutStdio, exec, execSync, spawn } from 'child_process';
import { existsSync, readFileSync } from 'fs';
import { ExecOptions } from 'node:child_process';
import fs from 'node:fs';
import os from 'os';
import path from 'path';
import { promisify } from 'util';
import { SpanStatusCode } from '@opentelemetry/api';
import { getFileSystem } from '#agent/agentContextLocalStorage';
import { logger } from '#o11y/logger';
import { withSpan } from '#o11y/trace';

const execAsync = promisify(exec);
/**
 * Throws an exception if the result of an execCmd has an error
 * @param result
 * @param message
 */
export function checkExecResult(result: ExecResults, message: string) {
	if (result.error) {
		logger.info(result.stdout);
		logger.error(result.stderr);
		throw new Error(`Error executing command: ${result.cmd} in ${result.cwd ?? './'}\n${message}: ${result.error.message}`);
	}
}

function getAvailableShell(): string {
	const possibleShells = ['/bin/zsh', '/usr/bin/zsh', '/bin/bash', '/usr/bin/bash', '/bin/sh', '/usr/bin/sh'];
	for (const shellPath of possibleShells) {
		if (existsSync(shellPath)) {
			return shellPath;
		}
	}
	if (process.env.SHELL && existsSync(process.env.SHELL)) {
		return process.env.SHELL;
	}
	throw new Error('No suitable shell found for executing commands.');
}

export function execCmdSync(command: string, cwd = getFileSystem().getWorkingDirectory()): ExecResults {
	const home = process.env.HOME;

	if (command.startsWith('~') && home) command = home + command.substring(1);
	try {
		const shell = getAvailableShell();
		logger.debug(`execCmdSync ${command}\ncwd: ${cwd}\nshell: ${shell}`);

		const options: ExecSyncOptions = {
			cwd,
			shell,
			encoding: 'utf8',
			env: { ...process.env, PATH: `${process.env.PATH}:/bin:/usr/bin` },
		};

		let stdout = execSync(command, options);
		if (typeof stdout !== 'string') stdout = stdout.toString();

		logger.info(stdout);

		return {
			cmd: command,
			stdout,
			stderr: '',
			error: null,
			cwd,
		};
	} catch (error) {
		logger.error(error);
		return {
			cmd: command,
			stdout: error.stdout?.toString() || '',
			stderr: error.stderr?.toString() || '',
			error: error instanceof Error ? error : new Error(String(error)),
			cwd,
		};
	}
}

export interface ExecResults {
	cmd: string;
	stdout: string;
	stderr: string;
	error: ExecException | null;
	cwd?: string;
}

/**
 * @param command
 * @param cwd current working directory
 * @returns
 */
export async function execCmd(command: string, cwd = getFileSystem().getWorkingDirectory()): Promise<ExecResults> {
	return withSpan('execCmd', async (span) => {
		const home = process.env.HOME;
		logger.info(`execCmd ${home ? command.replace(home, '~') : command} ${cwd}`);
		// Use the available shell
		const shell = getAvailableShell();
		const result = await new Promise<ExecResults>((resolve, reject) => {
			exec(command, { cwd, shell }, (error, stdout, stderr) => {
				resolve({
					cmd: command,
					stdout,
					stderr,
					error,
					cwd,
				});
			});
		});
		if (!result.error) {
			span.setAttributes({
				cwd,
				command,
				stdout: result.stdout,
				stderr: result.stderr,
				exitCode: result.error ? 1 : 0,
			});
			span.setStatus({ code: result.error ? SpanStatusCode.ERROR : SpanStatusCode.OK });
		}
		return result;
	});
}

export interface ExecResult {
	stdout: string;
	stderr: string;
	exitCode: number;
}

/**
 * Throws an error if the ExecResult exit code is not zero
 * @param userMessage The error message prepended to the stdout and stderr
 * @param execResult
 */
export function failOnError(userMessage: string, execResult: ExecResult): void {
	if (execResult.exitCode === 0) return;
	let errorMessage = userMessage;
	errorMessage += execResult.stdout ? `\n${execResult.stdout}` : '';
	if (execResult.stdout && execResult.stderr) errorMessage += '\n';
	if (execResult.stderr) errorMessage += execResult.stderr;
	throw new Error(errorMessage);
}

export interface ExecCmdOptions {
	workingDirectory?: string;
	envVars?: Record<string, string>;
	throwOnError?: boolean;
	/** Value to mask in logs/traces */
	mask?: string;
}

// TODO stream the output and watch for cmdsubst> which would indicate a malformed command

export async function execCommand(command: string, opts?: ExecCmdOptions): Promise<ExecResult> {
	return withSpan('execCommand', async (span) => {
		const shell = getAvailableShell();

		const env = opts?.envVars ? { ...process.env, ...opts.envVars } : process.env;
		const options: ExecOptions = { cwd: opts?.workingDirectory ?? getFileSystem().getWorkingDirectory(), shell, env };
		try {
			logger.info(`${options.cwd} % ${command}`);
			const { stdout, stderr } = await execAsync(command, options);

			span.setAttributes({
				cwd: options.cwd as string,
				shell,
				command,
				stdout,
				stderr,
				exitCode: 0,
			});
			span.setStatus({ code: SpanStatusCode.OK });
			return { stdout, stderr, exitCode: 0 };
		} catch (error) {
			span.setAttributes({
				cwd: options.cwd as string,
				command,
				stdout: error.stdout,
				stderr: error.stderr,
				exitCode: error.code,
			});
			span.recordException(error);
			span.setStatus({ code: SpanStatusCode.ERROR, message: error.message });
			logger.error(error, `Error executing ${command}`);
			if (opts?.throwOnError) {
				const e: any = new Error(`Error running ${command}. ${error.stdout} ${error.stderr}`);
				e.code = error.code;
				throw e;
			}
			return { stdout: error.stdout, stderr: error.stderr, exitCode: error.code };
		}
	});
}

export async function spawnCommand(command: string, workingDirectory?: string): Promise<ExecResult> {
	return withSpan('spawnCommand', async (span) => {
		const shell = getAvailableShell();
		const cwd = workingDirectory ?? getFileSystem().getWorkingDirectory();
		const options: SpawnOptionsWithoutStdio = { cwd, shell, env: process.env };
		try {
			logger.info(`${options.cwd} % ${command}`);
			const { stdout, stderr, code } = await spawnAsync(command, options);

			span.setAttributes({
				cwd,
				command,
				stdout,
				stderr,
				exitCode: 0,
			});
			span.setStatus({ code: SpanStatusCode.OK });
			return { stdout, stderr, exitCode: 0 };
		} catch (error) {
			span.setAttributes({
				cwd,
				command,
				stdout: error.stdout,
				stderr: error.stderr,
				exitCode: error.code,
			});
			span.recordException(error);
			span.setStatus({ code: SpanStatusCode.ERROR, message: error.message });
			logger.error(error, `Error executing ${command}`);
			return { stdout: error.stdout, stderr: error.stderr, exitCode: error.code };
		}
	});
}

function spawnAsync(command: string, options: SpawnOptionsWithoutStdio): Promise<{ stdout: string; stderr: string; code: number }> {
	return withSpan('spawnCommand', async (span) => {
		const shell = os.platform() === 'darwin' ? '/bin/zsh' : '/bin/bash';
		return new Promise((resolve, reject) => {
			const process = spawn(command, [], { ...options, shell, stdio: ['ignore', 'pipe', 'pipe'] });
			let stdout = '';
			let stderr = '';

			process.stdout.on('data', (data) => {
				stdout += data.toString();
			});

			process.stderr.on('data', (data) => {
				stderr += data.toString();
			});

			process.on('close', (code) => {
				span.setAttributes({
					cwd: options.cwd.toString(),
					command,
					stdout,
					stderr,
					exitCode: code,
				});
				span.setStatus({ code: code === 0 ? SpanStatusCode.OK : SpanStatusCode.ERROR });

				if (code === 0) {
					resolve({ stdout, stderr, code });
				} else {
					const error = new Error(`Command failed: ${command}`) as any;
					error.stdout = stdout;
					error.stderr = stderr;
					error.code = code;
					reject(error);
				}
			});
		});
	});
}

/**
 * This could be extracted to a class as its purpose is to have a persistent shell which
 * can have multiple commands executed over time.
 * This can be required when needing to source a script before executing other scripts.
 * @param cmd
 * @param opts
 */
export async function runShellCommand(cmd: string, opts?: ExecCmdOptions): Promise<ExecResult> {
	const shell: string = process.platform === 'win32' ? 'cmd.exe' : os.platform() === 'darwin' ? '/bin/zsh' : '/bin/bash';
	const env: Record<string, string> = opts?.envVars ? { ...process.env, ...opts.envVars } : { ...process.env };
	const cwd: string = opts?.workingDirectory ?? getFileSystem().getWorkingDirectory();

	const child = spawn(shell, [], { stdio: ['pipe', 'pipe', 'pipe'], cwd, env });

	function closeShell(): Promise<{ code: number; signal: NodeJS.Signals }> {
		return new Promise((resolve, reject) => {
			child.on('exit', (code: number, signal: NodeJS.Signals) => {
				resolve({ code, signal });
			});

			child.stdin.end();
		});
	}
	// Function to send a command and capture stdout and stderr
	function sendCommand(command: string): Promise<ExecResult> {
		return new Promise((resolve, reject) => {
			let stdout = '';
			let stderr = '';
			let commandOutput = '';
			const commandDoneMarker = `COMMAND_DONE_EXIT${Math.random().toString(36).substring(2, 15)}`;

			const onStdoutData = (data) => {
				commandOutput += data.toString();

				if (commandOutput.includes(commandDoneMarker)) {
					const parts = commandOutput.split(commandDoneMarker);
					stdout = parts[0];
					const exitCodeMatch = parts[1].match(/EXIT_CODE:(\d+)/);
					const exitCode = exitCodeMatch ? parseInt(exitCodeMatch[1], 10) : null;

					// Clean up listeners
					child.stdout.off('data', onStdoutData);
					child.stderr.off('data', onStderrData);
					if (stdout.endsWith('\n')) stdout = stdout.substring(0, stdout.length - 1);
					resolve({ stdout, stderr, exitCode });
				}
			};

			const onStderrData = (data) => {
				stderr += data.toString();
			};

			child.stdout.on('data', onStdoutData);
			child.stderr.on('data', onStderrData);

			// Write the command to the shell's stdin, followed by an echo of the exit code
			child.stdin.write(`${command}\n`);
			if (process.platform === 'win32') {
				child.stdin.write(`echo ${commandDoneMarker} EXIT_CODE:%ERRORLEVEL%\n`);
			} else {
				child.stdin.write(`echo ${commandDoneMarker} EXIT_CODE:$?\n`);
			}
		});
	}

	let result: ExecResult;
	try {
		if (shell === '/bin/zsh') {
			const zshrc = path.join(process.env.HOME, '.zshrc');
			if (existsSync(zshrc)) {
				const result = await sendCommand(`source ${zshrc}`);
				if (result.exitCode) logger.error(`source ${zshrc} returned ${result.exitCode}.`);
			}
		} else if (shell === '/bin/bash') {
			const bashrc = path.join(process.env.HOME, '.bashrc');
			if (existsSync(bashrc)) {
				const result = await sendCommand(`source ${bashrc}`);
				if (result.exitCode) logger.error(`source ${bashrc} returned ${result.exitCode}.`);
			}
		}

		result = await sendCommand(cmd);
	} finally {
		try {
			await closeShell();
		} catch (ex) {
			logger.warn(ex, `Error closing shell for command ${cmd}`);
		}
	}

	return result;
}

/**
 * Handles quoting of strings used as shell arguments
 * @param s
 */
export function shellEscape(s: string): string {
	// return "'" + s.replace(/'/g, "'\\''") + "'";
	return `"${s.replace(/["\\$`]/g, '\\$&')}"`;
}
