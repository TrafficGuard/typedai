import { type ChildProcess, type ExecFileOptions, execFile, spawn } from 'node:child_process';
import * as path from 'node:path';
import { promisify } from 'node:util';
import { logger } from '#o11y/logger'; // Assuming you have a logger, replace with console if not

const execFileAsync = promisify(execFile);

export interface DockerExecResult {
	stdout: string;
	stderr: string;
	exitCode: number;
	command: string;
}

export interface DockerControllerOptions {
	/** Array of docker-compose file paths. Order can matter if they override each other. */
	composeFiles: string[];
	/**
	 * Docker-compose project name.
	 * If not provided, it defaults to the directory name of the first compose file.
	 * Using a specific project name helps isolate test environments.
	 */
	projectName?: string;
	/** Optional path to a .env file for docker-compose variables. */
	envFile?: string;
}

export class DockerController {
	private readonly composeFiles: string[];
	private readonly projectName: string;
	private readonly envFile?: string;

	constructor(options: DockerControllerOptions) {
		if (!options.composeFiles || options.composeFiles.length === 0) {
			throw new Error('At least one compose file must be provided.');
		}
		this.composeFiles = options.composeFiles.map((p) => path.resolve(p)); // Ensure absolute paths
		this.projectName = options.projectName || this.generateProjectName(this.composeFiles[0]);
		this.envFile = options.envFile ? path.resolve(options.envFile) : undefined;

		logger.info(`DockerController initialized for project: ${this.projectName}`);
	}

	private generateProjectName(composeFilePath: string): string {
		return (
			path
				.basename(path.dirname(composeFilePath))
				.replace(/[^a-zA-Z0-9_.-]/g, '')
				.toLowerCase() || 'defaultproject'
		);
	}

	private getBaseComposeArgs(): string[] {
		const args: string[] = [];
		this.composeFiles.forEach((file) => {
			args.push('-f', file);
		});
		args.push('-p', this.projectName);
		if (this.envFile) {
			args.push('--env-file', this.envFile);
		}
		return args;
	}

	private async runDockerComposeCommand(
		commandArgs: string[],
		options?: ExecFileOptions & { logOutput?: boolean },
	): Promise<{ stdout: string; stderr: string }> {
		const fullArgs = [...this.getBaseComposeArgs(), ...commandArgs];
		logger.debug(`Executing: docker compose ${fullArgs.join(' ')}`);
		try {
			// Add current process.env to the options if not already there
			const execOptions = { ...options, env: { ...process.env, ...options?.env } };
			const { stdout, stderr } = await execFileAsync('docker', ['compose', ...fullArgs], execOptions);

			if (options?.logOutput) {
				if (stdout) logger.debug(`Docker compose stdout:\n${stdout}`);
				if (stderr) logger.debug(`Docker compose stderr:\n${stderr}`);
			}

			// Handle cases where stderr might contain non-error messages (e.g., warnings, progress)
			// This is a simple heuristic; more complex parsing might be needed for specific docker-compose versions.
			if (stderr) {
				const stderrLines = stderr.split('\n').filter((line) => line.trim() !== '');
				const warningLines = stderrLines.filter(
					(line) => line.toLowerCase().includes('warning') || line.toLowerCase().includes('deprecated') || !stdout.includes(line), // If stderr content is not in stdout, it's more likely a real message
				);
				if (warningLines.length > 0 && warningLines.length === stderrLines.length) {
					// All stderr lines are warnings/info
					if (!options?.logOutput && warningLines.join('\n').length > 0)
						logger.warn(`Docker compose command stderr (warnings/info):\n${warningLines.join('\n')}`);
				} else if (stderrLines.length > 0 && !options?.logOutput) {
					// If there are stderr lines not clearly identifiable as warnings, log them as potential errors
					logger.warn(`Docker compose command stderr (potential errors):\n${stderr}`);
				}
			}
			return { stdout, stderr };
		} catch (error: any) {
			logger.error(error, `Error executing: docker compose ${fullArgs.join(' ')}\nSTDOUT:\n${error.stdout}\nSTDERR:\n${error.stderr}`);
			throw error;
		}
	}

	/**
	 * Starts services defined in the compose file(s).
	 * @param services Optional array of service names to start. Starts all if empty.
	 * @param options Control build, detach mode, and environment variables.
	 */
	async up(services: string[] = [], options?: { build?: boolean; detach?: boolean; envVars?: Record<string, string> }): Promise<void> {
		const cmdArgs = ['up'];
		if (options?.build) cmdArgs.push('--build');
		if (options?.detach === undefined || options.detach) cmdArgs.push('-d'); // Detach by default
		if (services.length > 0) cmdArgs.push(...services);

		await this.runDockerComposeCommand(cmdArgs, { env: options?.envVars });
		logger.info(`Docker services [${services.join(', ') || 'all'}] up for project ${this.projectName}.`);
	}

	/**
	 * Stops and removes containers, networks, and optionally volumes.
	 * @param options Control volume and orphan removal.
	 */
	async down(options?: { removeVolumes?: boolean; removeOrphans?: boolean }): Promise<void> {
		const cmdArgs = ['down'];
		if (options?.removeVolumes) cmdArgs.push('-v'); // Removes named volumes
		if (options?.removeOrphans) cmdArgs.push('--remove-orphans');

		await this.runDockerComposeCommand(cmdArgs);
		logger.info(`Docker services down for project ${this.projectName}.`);
	}

	/**
	 * Executes a command in a running service container.
	 * @param serviceName The name of the service as defined in the compose file.
	 * @param command The command and its arguments as an array.
	 * @param execOptions Options for user, workdir, environment variables, and TTY.
	 */
	async exec(
		serviceName: string,
		command: string[],
		execOptions?: { user?: string; workdir?: string; envVars?: Record<string, string>; tty?: boolean },
	): Promise<DockerExecResult> {
		const baseArgs = ['exec'];
		// docker-compose exec defaults to TTY. Pass -T to disable if tty is false.
		if (execOptions?.tty === false) baseArgs.push('-T');

		if (execOptions?.user) baseArgs.push('--user', execOptions.user);
		if (execOptions?.workdir) baseArgs.push('--workdir', execOptions.workdir);
		if (execOptions?.envVars) {
			for (const [key, value] of Object.entries(execOptions.envVars)) {
				baseArgs.push('--env', `${key}=${value}`);
			}
		}
		baseArgs.push(serviceName);
		baseArgs.push(...command);

		const fullCommandString = `docker compose ${[...this.getBaseComposeArgs(), ...baseArgs].join(' ')}`;
		logger.debug(`Executing in container: ${fullCommandString}`);

		try {
			// execFile needs the command as the first arg, and the rest of args as an array
			const { stdout, stderr } = await execFileAsync('docker', ['compose', ...this.getBaseComposeArgs(), ...baseArgs], { env: process.env });
			return { stdout, stderr, exitCode: 0, command: command.join(' ') };
		} catch (error: any) {
			// error from execFileAsync will have stdout, stderr, code
			return {
				stdout: error.stdout?.toString() || '',
				stderr: error.stderr?.toString() || '',
				exitCode: error.code || 1,
				command: command.join(' '),
			};
		}
	}

	/**
	 * Follows logs from a specific service.
	 * @param serviceName The name of the service.
	 * @param onLog Callback function to handle log data (stdout or stderr).
	 * @param options Control log fetching (since, tail).
	 * @returns The ChildProcess instance for the log stream, allowing it to be killed.
	 */
	followLogs(
		serviceName: string,
		onLog: (type: 'stdout' | 'stderr', data: string) => void,
		options?: { since?: string; tail?: string | number; timestamps?: boolean },
	): ChildProcess {
		const cmdArgs = ['logs', '--follow', '--no-log-prefix'];
		if (options?.timestamps) cmdArgs.push('--timestamps');
		if (options?.since) cmdArgs.push('--since', options.since);
		if (options?.tail) cmdArgs.push('--tail', String(options.tail));
		cmdArgs.push(serviceName);

		const fullArgs = [...this.getBaseComposeArgs(), ...cmdArgs];
		logger.debug(`Following logs: docker compose ${fullArgs.join(' ')}`);

		const logProcess = spawn('docker', ['compose', ...fullArgs], { stdio: ['ignore', 'pipe', 'pipe'], env: process.env });

		logProcess.stdout?.on('data', (data) => onLog('stdout', data.toString()));
		logProcess.stderr?.on('data', (data) => onLog('stderr', data.toString()));

		logProcess.on('error', (err) => {
			logger.error(err, `Error spawning 'docker compose logs' for service ${serviceName} in project ${this.projectName}`);
		});

		logProcess.on('close', (code) => {
			if (code !== 0 && code !== null) {
				// null if killed
				logger.warn(`Log stream for service ${serviceName} (project ${this.projectName}) closed with code ${code}.`);
			} else {
				logger.info(`Log stream for service ${serviceName} (project ${this.projectName}) closed.`);
			}
		});

		return logProcess;
	}

	/**
	 * Retrieves the runtime container ID for a given service.
	 * @param serviceName The name of the service.
	 * @returns The container ID as a string, or undefined if not found or an error occurs.
	 */
	async getContainerId(serviceName: string): Promise<string | undefined> {
		const cmdArgs = ['ps', '-q', serviceName];
		try {
			const { stdout } = await this.runDockerComposeCommand(cmdArgs);
			const id = stdout.trim();
			return id || undefined;
		} catch (error) {
			// Error already logged by runDockerComposeCommand
			return undefined;
		}
	}

	/**
	 * Waits for a specific message pattern to appear in the logs of a service.
	 * Useful for checking if a service is ready.
	 * @param serviceName The service to monitor.
	 * @param messagePattern RegExp to match in the logs.
	 * @param timeoutMs Maximum time to wait in milliseconds.
	 * @param options Options for log fetching (e.g., tail to limit initial log scan).
	 */
	async waitForLogMessage(serviceName: string, messagePattern: RegExp, timeoutMs = 30000, options?: { tail?: string | number }): Promise<void> {
		return new Promise((resolve, reject) => {
			logger.info(
				`Waiting for log message matching ${messagePattern.source} from service ${serviceName} (project ${this.projectName}, timeout: ${timeoutMs}ms)`,
			);
			let logProcess: ChildProcess | null = null;

			const timer = setTimeout(() => {
				logProcess?.kill();
				reject(
					new Error(`Timeout (${timeoutMs}ms) waiting for log message "${messagePattern.source}" from service ${serviceName} in project ${this.projectName}`),
				);
			}, timeoutMs);

			const onLogData = (type: 'stdout' | 'stderr', data: string) => {
				if (messagePattern.test(data)) {
					logger.info(`Log message matching "${messagePattern.source}" found in ${type} for service ${serviceName} (project ${this.projectName}).`);
					clearTimeout(timer);
					logProcess?.kill();
					resolve();
				}
			};

			logProcess = this.followLogs(serviceName, onLogData, { tail: options?.tail ?? '50' });

			logProcess.on('error', (err) => {
				// Handle error from spawn itself
				clearTimeout(timer);
				reject(new Error(`Error starting log stream for ${serviceName} (project ${this.projectName}): ${err.message}`));
			});

			logProcess.on('close', (code) => {
				// If the log stream closes before the message is found or timeout occurs,
				// and it wasn't due to us killing it after finding the message.
				if (code !== 0 && code !== null) {
					// Check if it's still pending
					const state = (logProcess as any)._pending; // Not standard, but a way to check
					if (state !== 'killed') {
						// if not killed by us
						clearTimeout(timer);
						reject(new Error(`Log stream for ${serviceName} (project ${this.projectName}) closed unexpectedly with code ${code} while waiting for message.`));
					}
				}
			});
		});
	}
}
