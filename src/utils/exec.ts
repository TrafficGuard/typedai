import { type ExecException, type ExecSyncOptions, type SpawnOptionsWithoutStdio, exec, execSync, spawn } from 'node:child_process';
import type { ExecOptions } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { SpanStatusCode } from '@opentelemetry/api';
import { CONTAINER_PATH } from 'src/benchmarks/swebench/swe-bench-runner';
import { agentContext, getFileSystem } from '#agent/agentContextLocalStorage';
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
		try {
			if (existsSync(shellPath)) {
				return shellPath;
			}
		} catch (e) {
			// existsSync might throw in mocked environments (like mock-fs).
			// Log and continue checking other shells or fallbacks.
			logger.debug(`existsSync failed for ${shellPath}: ${e.message}`);
		}
	}

	// If none of the preferred shells were found or checked,
	// fall back to process.env.SHELL or a platform default.
	if (process.env.SHELL) {
		return process.env.SHELL;
	}

	// Provide a default based on the operating system if SHELL is not set
	return process.platform === 'win32' ? 'cmd.exe' : '/bin/bash';
}

function buildDockerCommand(containerId: string, command: string, workdir?: string, envVars?: Record<string, string>): string {
	const effectiveWorkdir = workdir || CONTAINER_PATH;
	const workdirFlag = `--workdir ${shellEscape(effectiveWorkdir)}`;
	const envVarsString = envVars
		? Object.entries(envVars)
				.map(([key, value]) => `-e ${key}=${shellEscape(value)}`)
				.join(' ')
		: '';
	return `docker exec ${envVarsString} ${workdirFlag} ${containerId} bash -c ${shellEscape(command)}`;
}

export function execCmdSync(command: string, cwd = getFileSystem().getWorkingDirectory()): ExecResults {
	const context = agentContext();
	const containerId = context?.containerId;
	const home = process.env.HOME;

	let commandToRun = command;
	if (commandToRun.startsWith('~') && home) commandToRun = home + commandToRun.substring(1);

	const hostCwd = containerId ? getFileSystem().getGitRepositoryRootDir() : cwd;
	if (containerId) {
		commandToRun = buildDockerCommand(containerId, commandToRun, cwd);
	}

	try {
		const shell = getAvailableShell();
		logger.debug(`execCmdSync ${commandToRun}\ncwd: ${hostCwd}\nshell: ${shell}`);

		const options: ExecSyncOptions = {
			cwd: hostCwd,
			shell,
			encoding: 'utf8',
			env: { ...process.env, PATH: `${process.env.PATH}:/bin:/usr/bin` },
		};

		let stdout = execSync(commandToRun, options);
		if (typeof stdout !== 'string') stdout = stdout.toString();

		logger.info(stdout);

		return {
			cmd: command,
			stdout,
			stderr: '',
			error: null,
			exitCode: 0, // Add exitCode for success
			cwd,
		};
	} catch (error) {
		logger.error(error, `Error executing command: ${commandToRun} in ${cwd}`);
		return {
			cmd: command,
			stdout: error.stdout?.toString() || '',
			stderr: error.stderr?.toString() || '',
			error: error instanceof Error ? error : new Error(String(error)),
			exitCode: error.code ?? 1,
			cwd,
		};
	}
}

export interface ExecResults {
	cmd: string;
	stdout: string;
	stderr: string;
	error: ExecException | null;
	exitCode: number;
	cwd?: string;
}

/**
 * @param command
 * @param cwd current working directory
 * @returns
 */
export async function execCmd(command: string, cwd = getFileSystem().getWorkingDirectory()): Promise<ExecResults> {
	return withSpan('execCmd', async (span) => {
		const context = agentContext();
		const containerId = context?.containerId;
		const home = process.env.HOME;

		logger.info(`execCmd ${home ? command.replace(home, '~') : command} ${cwd}${containerId ? ` [container: ${containerId}]` : ''}`);

		const hostCwd = containerId ? getFileSystem().getVcsRoot() : cwd;
		// If a containerId is present, wrap the command. Otherwise, use the original command.
		const commandToRun = containerId ? buildDockerCommand(containerId, command, cwd) : command;

		// Use the available shell
		const shell = getAvailableShell();
		const result = await new Promise<ExecResults>((resolve, reject) => {
			// Use the potentially wrapped command string here
			exec(commandToRun, { cwd: hostCwd, shell }, (error, stdout, stderr) => {
				resolve({
					cmd: command, // IMPORTANT: Return the original command for compatibility
					stdout: formatAnsiWithMarkdownLinks(stdout),
					stderr: formatAnsiWithMarkdownLinks(stderr),
					error,
					// Determine exit code: 0 for success, error code or 1 for failure
					exitCode: error ? ((error as any).code ?? 1) : 0,
					cwd,
				});
			});
		});
		if (!result.error) {
			span.setAttributes({
				cwd,
				command: commandToRun, // Log the actual command executed
				stdout: result.stdout,
				stderr: result.stderr,
				exitCode: result.exitCode,
			});
			span.setStatus({ code: result.error ? SpanStatusCode.ERROR : SpanStatusCode.OK });
		}
		return result;
	});
}

export interface ExecResult {
	command: string;
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
	let errorMessage = `${userMessage}. Exit code: ${execResult.exitCode}. Command: ${execResult.command}`;
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
		const context = agentContext();
		// Docker container Id to run the command in
		const containerId = context?.containerId;

		if (containerId) {
			// Running inside a container via docker exec
			const dockerCommand = buildDockerCommand(containerId, command, opts?.workingDirectory, opts?.envVars);
			const hostCwd = getFileSystem().getGitRepositoryRootDir();
			const options: ExecOptions = { cwd: hostCwd, env: process.env };

			try {
				logger.info(`DOCKER_EXEC: ${command} (in container ${containerId})`);
				logger.debug(`Executing: ${dockerCommand}`);
				let { stdout, stderr } = await execAsync(dockerCommand, options);
				stdout = formatAnsiWithMarkdownLinks(stdout);
				stderr = formatAnsiWithMarkdownLinks(stderr);
				span.setAttributes({
					'container.id': containerId,
					'container.command': command,
					cwd: opts?.workingDirectory ?? CONTAINER_PATH,
					command: dockerCommand,
					stdout,
					stderr,
					exitCode: 0,
				});
				span.setStatus({ code: SpanStatusCode.OK });
				return { stdout, stderr, exitCode: 0, command };
			} catch (error) {
				span.setAttributes({
					'container.id': containerId,
					'container.command': command,
					cwd: opts?.workingDirectory ?? CONTAINER_PATH, // Log container CWD
					command: dockerCommand,
					stdout: formatAnsiWithMarkdownLinks(error.stdout),
					stderr: formatAnsiWithMarkdownLinks(error.stderr),
					exitCode: error.code,
				});
				span.recordException(error);
				span.setStatus({ code: SpanStatusCode.ERROR, message: error.message });
				logger.error(error, `Error executing ${command} in container ${containerId}`);
				if (opts?.throwOnError) {
					const e: any = new Error(`Error running ${command} in container. ${error.stdout} ${error.stderr}`);
					e.code = error.code;
					throw e;
				}
				return { stdout: error.stdout, stderr: error.stderr, exitCode: error.code, command };
			}
		}

		// Original logic for host execution
		const shell = getAvailableShell();

		const env = opts?.envVars ? { ...process.env, ...opts.envVars } : process.env;
		const options: ExecOptions = { cwd: opts?.workingDirectory ?? getFileSystem().getWorkingDirectory(), shell, env };
		try {
			logger.info(`${options.cwd} % ${command}`);
			let { stdout, stderr } = await execAsync(command, options);
			stdout = formatAnsiWithMarkdownLinks(stdout);
			stderr = formatAnsiWithMarkdownLinks(stderr);
			span.setAttributes({
				cwd: options.cwd as string,
				shell,
				command,
				stdout,
				stderr,
				exitCode: 0,
			});
			span.setStatus({ code: SpanStatusCode.OK });
			return { stdout, stderr, exitCode: 0, command };
		} catch (error) {
			span.setAttributes({
				cwd: options.cwd as string,
				command,
				stdout: formatAnsiWithMarkdownLinks(error.stdout),
				stderr: formatAnsiWithMarkdownLinks(error.stderr),
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
			return { stdout: error.stdout, stderr: error.stderr, exitCode: error.code, command };
		}
	});
}

export async function spawnCommand(command: string, workingDirectory?: string): Promise<ExecResult> {
	return withSpan('spawnCommand', async (span) => {
		const context = agentContext();
		const containerId = context?.containerId;
		const shell = getAvailableShell();
		let commandToRun: string;
		let hostCwd: string;

		if (containerId) {
			commandToRun = buildDockerCommand(containerId, command, workingDirectory);
			hostCwd = getFileSystem().getGitRepositoryRootDir();
		} else {
			commandToRun = command;
			hostCwd = workingDirectory ?? getFileSystem().getWorkingDirectory();
		}

		const options: SpawnOptionsWithoutStdio = { cwd: hostCwd, shell, env: process.env };
		try {
			const logCwd = workingDirectory ?? getFileSystem().getWorkingDirectory();
			logger.info(`${logCwd} % ${command}${containerId ? ` [container: ${containerId}]` : ''}`);
			// Use the potentially wrapped command string here
			let { stdout, stderr, code } = await spawnAsync(commandToRun, options);
			stdout = formatAnsiWithMarkdownLinks(stdout);
			stderr = formatAnsiWithMarkdownLinks(stderr);
			span.setAttributes({
				cwd: hostCwd,
				command: commandToRun,
				stdout,
				stderr,
				exitCode: code,
			});
			span.setStatus({ code: code === 0 ? SpanStatusCode.OK : SpanStatusCode.ERROR });
			return { stdout, stderr, exitCode: code, command };
		} catch (error) {
			span.setAttributes({
				cwd: hostCwd,
				command: commandToRun,
				stdout: formatAnsiWithMarkdownLinks(error.stdout),
				stderr: formatAnsiWithMarkdownLinks(error.stderr),
				exitCode: error.code,
			});
			span.recordException(error);
			span.setStatus({ code: SpanStatusCode.ERROR, message: error.message });
			logger.error(error, `Error executing ${command}`);
			return { stdout: error.stdout, stderr: error.stderr, exitCode: error.code, command };
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
	const context = agentContext();
	const containerId = context?.containerId;

	// If in a container, delegate to execCommand, which handles non-interactive docker exec well.
	// This avoids the complexity of managing a persistent shell over docker exec.
	if (containerId) {
		logger.info(`Running shell command in container by delegating to execCommand: ${cmd}`);
		return execCommand(cmd, opts);
	}

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
					const exitCode = exitCodeMatch ? Number.parseInt(exitCodeMatch[1], 10) : null;

					// Clean up listeners
					child.stdout.off('data', onStdoutData);
					child.stderr.off('data', onStderrData);
					if (stdout.endsWith('\n')) stdout = stdout.substring(0, stdout.length - 1);
					resolve({ stdout, stderr, exitCode, command });
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

/**
 * Sanitise arguments by single quoting and escaping single quotes in the value
 * @param argValue command line argument value
 */
export function arg(argValue: string): string {
	// Ensure the argument is treated as a single token, escaping potential issues.
	// Simple quoting for common cases. More robust shell escaping might be needed
	// depending on the complexity of regex patterns allowed.
	// Escapes single quotes for POSIX shells (' -> '\''')
	return `'${argValue.replace(/'/g, "'\\''")}'`;
}

/**
 * Removes most ANSI escape codes (like colors, formatting) from a string,
 * but specifically converts OSC 8 hyperlinks into Markdown format `[Text](URL)`.
 *
 * @param text The input string potentially containing ANSI codes.
 * @returns The string with non-link ANSI codes removed and links formatted as Markdown,
 *          or the original string if input is null/undefined/empty.
 */
export function formatAnsiWithMarkdownLinks(text: string | null | undefined): string {
	if (!text) return text ?? '';

	// Regular expression to specifically match OSC 8 hyperlinks.
	// It captures the URL (group 1) and the Link Text (group 2).
	// Format: \x1B]8;;URL\x1B\\Text\x1B]8;;\x1B\\
	// Using \x1B for ESC
	// biome-ignore lint/suspicious/noControlCharactersInRegex: expected
	const osc8Regex = /\x1B]8;;(.*?)\x1B\\(.*?)\x1B]8;;\x1B\\/g;

	// First pass: Replace OSC 8 links with Markdown format.
	// We use the captured groups: $2 is the text, $1 is the URL.
	let processedText = text.replace(osc8Regex, '[$2]($1)');

	// Enhanced regex to match more ANSI escape sequences and control characters
	const comprehensiveAnsiRegex = new RegExp(
		[
			// Original comprehensive ANSI regex
			'[\\u001B\\u009B][[\\]()#;?]*(?:(?:(?:[a-zA-Z\\d]*(?:;[-a-zA-Z\\d\\/#&.:=?%@~_]*)*)?\\u0007)',
			'(?:(?:\\d{1,4}(?:;\\d{0,4})*)?[\\dA-PR-TZcf-ntqry=><~]))',

			// Additional patterns for edge cases:
			// Simple bracket sequences like [96m, [0m that might not be caught
			'\\[[0-9;]*[a-zA-Z]',

			// C1 control characters (0x80-0x9F)
			'[\\u0080-\\u009F]',

			// Bell character and other common control chars
			'\\u0007',

			// Backspace sequences
			'\\u0008+',

			// Form feed, vertical tab
			'[\\u000B\\u000C]',

			// Delete character
			'\\u007F',
		].join('|'),
		'g',
	);

	// Second pass: Remove all remaining ANSI codes and control characters
	processedText = processedText.replace(comprehensiveAnsiRegex, '');

	// Third pass: Clean up any remaining non-printable characters
	// This catches characters that might not be standard ANSI but are still control characters
	// Keep newlines, carriage returns, and tabs as they're meaningful
	// biome-ignore lint/suspicious/noControlCharactersInRegex: expected
	processedText = processedText.replace(/[\u0000-\u0008\u000E-\u001F\u007F-\u009F]/g, '');

	// Fourth pass: Handle specific problematic characters like 'ç' that might appear
	// in malformed sequences - remove any non-ASCII characters that seem out of place
	// This is more aggressive and might need adjustment based on your specific use case
	processedText = processedText.replace(/[^\x20-\x7E\r\n\t]/g, '');

	// Final cleanup: normalize whitespace
	// Replace multiple consecutive spaces with single spaces, but preserve line breaks
	processedText = processedText.replace(/[ \t]+/g, ' ');

	// Remove trailing spaces from each line
	processedText = processedText.replace(/[ \t]+$/gm, '');

	// Remove excessive blank lines (more than 2 consecutive)
	processedText = processedText.replace(/\n{3,}/g, '\n\n');

	return processedText.trim();
}

/**
 * Alternative version with more conservative control character removal
 * Use this if the above version is too aggressive for your use case
 */
export function formatAnsiWithMarkdownLinksConservative(text: string | null | undefined): string {
	if (!text) return text ?? '';

	// biome-ignore lint/suspicious/noControlCharactersInRegex: expected
	const osc8Regex = /\x1B]8;;(.*?)\x1B\\(.*?)\x1B]8;;\x1B\\/g;
	let processedText = text.replace(osc8Regex, '[$2]($1)');

	// More targeted approach - only remove known problematic sequences
	const targetedAnsiRegex = new RegExp(
		[
			// Standard ANSI escape sequences
			'\\x1B\\[[0-9;]*[a-zA-Z]',
			'\\x1B\\][0-9;]*[a-zA-Z]',
			'\\x1B\\([AB]',

			// Bracket sequences without escape character (common in your example)
			'\\[[0-9;]*m',

			// Specific problematic characters
			'[\\u0000-\\u0008\\u000B\\u000C\\u000E-\\u001F\\u007F]',
		].join('|'),
		'g',
	);

	processedText = processedText.replace(targetedAnsiRegex, '');

	// Light cleanup
	processedText = processedText.replace(/\s+/g, ' ').trim();

	return processedText;
}
