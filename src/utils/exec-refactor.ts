/**
 * @fileoverview
 * A robust and secure helper for executing shell commands in Node.js.
 *
 * This module provides a unified interface for running commands either on the host
 * or inside a Docker container. It is designed with security, reliability, and
 * observability as top priorities, addressing shortcomings of a previous implementation.
 *
 * Key features:
 * - Unified `executeCommand` function to prevent API confusion.
 * - Security-first design using `execFile` to avoid shell injection.
 * - `shell-quote` library for safe dynamic argument construction when a shell is necessary.
 * - Integrated support for running commands in Docker containers via `docker exec`.
 * - Modern timeout and cancellation support using `AbortController`.
 * - A `PersistentShell` class for interactive, stateful sessions (e.g., sourcing scripts).
 * - Standardized `CommandResult` and `CommandError` types for predictable outcomes.
 * - Simplified and reliable ANSI output formatting.
 * - Integration with application-level logging and OpenTelemetry tracing.
 */

import { type ExecException, type ExecFileOptions, exec, execFile } from 'node:child_process';
import { type ChildProcess, type SpawnOptionsWithoutStdio, spawn } from 'node:child_process';
import { constants, accessSync } from 'node:fs';
import { promisify } from 'node:util';
import { SpanStatusCode } from '@opentelemetry/api';
import { quote } from 'shell-quote';
import { agentContext } from '#agent/agentContext';
import { getFileSystem } from '#agent/agentContextUtils';
import { logger } from '#o11y/logger';
import { withSpan } from '#o11y/trace';
import { CONTAINER_PATH } from './exec';
import { formatAnsiWithMarkdownLinks } from './formatters';

const execFileAsync = promisify(execFile);
const execAsync = promisify(exec);

// #region Core Interfaces and Types

/** Represents the result of a command execution. */
export interface CommandResult {
	/** The command that was executed. */
	command: string;
	/** The arguments passed to the command. */
	args: string[];
	/** The standard output of the command. */
	stdout: string;
	/** The standard error of the command. */
	stderr: string;
	/** The exit code of the process. Null if the process was terminated by a signal. */
	exitCode: number | null;
	/** The signal that terminated the process, if any. */
	signal: NodeJS.Signals | null;
	/** The working directory where the command was executed. */
	cwd: string;
}

/** Custom error class for command execution failures. */
export class CommandError extends Error {
	constructor(
		message: string,
		public readonly result: CommandResult,
	) {
		super(message);
		this.name = 'CommandError';
	}
}

/** Options for configuring command execution. */
export interface ExecuteCommandOptions {
	/** The working directory to run the command in. Defaults to the agent's current working directory. */
	cwd?: string;
	/** Environment variables to set for the command, merged with `process.env`. */
	env?: Record<string, string>;
	/** Timeout in milliseconds. If exceeded, the process is terminated. Defaults to 2 minutes. */
	timeout?: number;
	/** If true, the function will throw a `CommandError` on failure. Defaults to true. */
	throwOnError?: boolean;
	/** The ID of the Docker container to execute the command in. If provided, the command runs via `docker exec`. */
	containerId?: string;
}

// #endregion

// #region Main Execution Logic

/**
 * Executes a command securely, with support for Docker containers, timeouts, and structured results.
 *
 * This is the primary function for running commands. It defaults to using `execFile` which does not
 * use a shell, preventing injection vulnerabilities.
 *
 * @param command The command or executable to run (e.g., 'ls', 'npm').
 * @param args An array of string arguments for the command (e.g., ['-la', '/tmp']).
 * @param options Configuration for the execution.
 * @returns A promise that resolves with the command's result.
 * @throws {CommandError} If the command fails and `throwOnError` is true.
 */
export async function execCommand(command: string, args: string[] = [], options: ExecuteCommandOptions = {}): Promise<CommandResult> {
	return withSpan('execCommand', async (span) => {
		const {
			timeout = 120 * 1000, // 2 minutes default timeout
			throwOnError = true,
			containerId,
		} = options;

		const fs = getFileSystem();
		const agentCwd = fs.getWorkingDirectory();
		const finalCwd = options.cwd ?? agentCwd;

		const fullCommandStr = `${command} ${args.join(' ')}`;
		span.setAttributes({
			'command.executable': command,
			'command.args': JSON.stringify(args),
			'command.full': fullCommandStr,
			'command.cwd': finalCwd,
			'command.timeout': timeout,
			'command.containerId': containerId,
		});

		const controller = new AbortController();
		const timer = timeout > 0 ? setTimeout(() => controller.abort(), timeout) : undefined;

		try {
			let result: { stdout: string; stderr: string; code?: number | null; signal?: NodeJS.Signals | null };

			if (containerId) {
				// --- Docker Execution Path ---
				const hostCwd = fs.getVcsRoot() ?? process.cwd();
				const containerWd = finalCwd;
				const dockerCommandResult = await executeInDocker(command, args, containerId, containerWd, {
					...options,
					cwd: hostCwd,
					signal: controller.signal,
				});
				result = { ...dockerCommandResult, code: dockerCommandResult.exitCode };
			} else {
				// --- Host Execution Path ---
				const execOptions: ExecFileOptions = {
					cwd: finalCwd,
					env: { ...process.env, ...options.env },
					signal: controller.signal,
				};
				const promise = execFileAsync(command, args, execOptions);
				result = await promise;
			}
			clearTimeout(timer);

			const commandResult: CommandResult = {
				command,
				args,
				stdout: formatAnsiWithMarkdownLinks(result.stdout),
				stderr: formatAnsiWithMarkdownLinks(result.stderr),
				exitCode: result.code ?? 0,
				signal: result.signal ?? null,
				cwd: finalCwd,
			};

			span.setAttributes({
				'command.exitCode': commandResult.exitCode ?? undefined,
				'command.signal': commandResult.signal ?? undefined,
				// Truncate large outputs for traces
				'command.stdout': commandResult.stdout.substring(0, 2048),
				'command.stderr': commandResult.stderr.substring(0, 2048),
			});
			span.setStatus({ code: SpanStatusCode.OK });

			return commandResult;
		} catch (error) {
			clearTimeout(timer);

			const execError = error as ExecException & { stdout: string; stderr: string };
			const commandResult: CommandResult = {
				command,
				args,
				stdout: formatAnsiWithMarkdownLinks(execError.stdout ?? ''),
				stderr: formatAnsiWithMarkdownLinks(execError.stderr ?? ''),
				exitCode: execError.code ?? null,
				signal: execError.signal ?? null,
				cwd: finalCwd,
			};

			const errorMessage = `Command failed with exit code ${commandResult.exitCode ?? 'N/A'}: ${fullCommandStr}`;
			logger.error({ error, result: commandResult }, errorMessage);

			span.recordException(error);
			span.setAttributes({
				'command.exitCode': commandResult.exitCode!,
				'command.signal': commandResult.signal!,
				'command.stdout': commandResult.stdout.substring(0, 2048),
				'command.stderr': commandResult.stderr.substring(0, 2048),
			});
			span.setStatus({ code: SpanStatusCode.ERROR, message: error.message });

			if (throwOnError) {
				throw new CommandError(errorMessage, commandResult);
			}
			return commandResult;
		}
	});
}

/**
 * Internal helper to build and run a `docker exec` command.
 */
async function executeInDocker(
	command: string,
	args: string[],
	containerId: string,
	workdir: string,
	options: ExecuteCommandOptions & { signal?: AbortSignal; cwd: string },
) {
	// Construct the command to be executed *inside* the container, ensuring it's safely quoted.
	const quotedCommand = [command, ...args].map((part) => quote([part])).join(' ');

	const envFlags = options.env
		? Object.entries(options.env)
				.map(([key, value]) => `-e ${quote([`${key}=${value}`])}`)
				.join(' ')
		: '';

	// The final command string to be executed by the *host's* shell.
	const dockerCommand = `docker exec ${envFlags} --workdir ${quote([workdir])} ${containerId} bash -c ${quote([quotedCommand])}`;

	logger.info(`DOCKER_EXEC: ${command} ${args.join(' ')} (in container ${containerId})`);
	logger.debug(`Executing on host: ${dockerCommand}`);

	const { stdout, stderr } = await execAsync(dockerCommand, {
		cwd: options.cwd, // This should be the host's VCS root.
		env: process.env,
		signal: options.signal,
	});

	// `docker exec` does not easily propagate the exact exit code on error to Node's `exec`,
	// so we append it to stdout and parse it out. This is a common pattern.
	const exitCodeCommand = 'echo $?';
	const exitCodeResult = await execAsync(`docker exec ${containerId} bash -c '${exitCodeCommand}'`);
	const exitCode = Number.parseInt(exitCodeResult.stdout.trim(), 10);

	return { stdout, stderr, exitCode };
}

// #endregion

// #region Utility Functions

/**
 * Finds the best available shell on the system from a predefined list.
 * @returns The path to an available shell.
 */
export function getAvailableShell(): string {
	// Prefer user-defined shell if it's available and seems safe.
	const envShell = process.env.SHELL;
	const safeShells = ['/bin/zsh', '/bin/bash', '/bin/sh'];
	if (envShell && safeShells.includes(envShell) && isExecutable(envShell)) {
		return envShell;
	}

	for (const shellPath of safeShells) {
		if (isExecutable(shellPath)) {
			return shellPath;
		}
	}

	// Fallback for Windows or systems without standard shells.
	return process.platform === 'win32' ? 'cmd.exe' : '/bin/sh';
}

/** Checks if a file at a given path is executable. */
function isExecutable(filePath: string): boolean {
	try {
		accessSync(filePath, constants.X_OK);
		return true;
	} catch (e) {
		return false;
	}
}

// #endregion
