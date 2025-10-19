/**
 * @fileoverview
 * This script is the entry point for starting the backend server in a local development
 * environment. It is designed to handle the complexities of a multi-repository setup
 * where developers might be running a fork of the main repository.
 *
 * Key features:
 * - Dynamically finds available ports for the backend server and Node.js inspector
 *   to avoid conflicts, especially for contributors not using the default setup.
 * - Resolves and loads environment variables from a `.env` file.
 * - Writes a `backend.json` runtime metadata file that other processes (like the
 *   frontend dev server) can read to discover the backend's port.
 * - Initializes and starts the Fastify server.
 */
import '#fastify/trace-init/trace-init';

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { open } from 'node:inspector';
import { createRequire } from 'node:module';
import { type Server as NetServer, createServer } from 'node:net';
import path, { isAbsolute, resolve } from 'node:path';
import { logger } from '#o11y/logger';

interface ResolveEnvFileOptions {
	envFile?: string | null;
	cwd?: string;
	typedAiHome?: string | null;
}

interface ApplyEnvOptions {
	override?: boolean;
}

type ParsedEnv = Record<string, string>;

/**
 * Bootstraps the local backend server with dynamic ports and env-file fallback.
 * This function orchestrates the entire startup sequence for local development.
 */
async function main(): Promise<void> {
	let envFilePath: string | undefined;
	try {
		// 1. Resolve and apply environment variables from a `.env` file.
		envFilePath = resolveEnvFilePath();
		applyEnvFile(envFilePath);
	} catch (err) {
		logger.warn(err, '[start-local] no environment file found; continuing with existing process.env');
	}

	process.env.NODE_ENV ??= 'development';

	// Determine if this is the "default" repository setup (e.g., the main repo)
	// or a contributor's setup (e.g., a fork). This affects port handling.
	// In the default setup, we use fixed ports (3000/9229) and fail if they're taken.
	// In a contributor setup, we find the next available port to avoid conflicts.
	const repoRoot = path.resolve(process.cwd());
	const typedAiHome = process.env.TYPEDAI_HOME ? path.resolve(process.env.TYPEDAI_HOME) : null;
	const isDefaultRepo = typedAiHome ? repoRoot === typedAiHome : false;
	process.env.TYPEDAI_PORT_MODE = isDefaultRepo ? 'fixed' : 'dynamic';

	// 2. Determine and set the backend server port.
	const parsedPort = process.env.PORT ? Number.parseInt(process.env.PORT, 10) : undefined;
	let backendPort: number;
	if (isDefaultRepo) {
		backendPort = Number.isFinite(parsedPort) ? parsedPort! : 3000;
		await ensurePortAvailable(backendPort);
	} else {
		backendPort = await findAvailablePort(Number.isFinite(parsedPort) ? parsedPort : 3000);
	}
	// Set both PORT and BACKEND_PORT for compatibility with different consumers.
	process.env.PORT = backendPort.toString();
	process.env.BACKEND_PORT = backendPort.toString();

	// 3. Determine and set the Node.js inspector port.
	const inspectorParsed = process.env.INSPECT_PORT ? Number.parseInt(process.env.INSPECT_PORT, 10) : undefined;
	let inspectPort: number;
	if (isDefaultRepo) {
		inspectPort = Number.isFinite(inspectorParsed) ? inspectorParsed! : 9229;
		await ensurePortAvailable(inspectPort);
	} else {
		inspectPort = await findAvailablePort(Number.isFinite(inspectorParsed) ? inspectorParsed : 9229);
	}
	process.env.INSPECT_PORT = inspectPort.toString();

	// 4. Set environment variables that depend on the resolved ports.
	const apiBaseUrl = `http://localhost:${backendPort}/api/`;
	// Only override API_BASE_URL if it's not set or points to the default port,
	// allowing for custom configurations.
	if (!process.env.API_BASE_URL || process.env.API_BASE_URL.includes('localhost:3000')) {
		process.env.API_BASE_URL = apiBaseUrl;
	}

	// Keep UI_URL loosely in sync for consumers that expect localhost links.
	const defaultUiUrl = 'http://localhost:4200/';
	if (!process.env.UI_URL || process.env.UI_URL === defaultUiUrl) {
		process.env.UI_URL = process.env.UI_URL ?? defaultUiUrl;
	}

	if (envFilePath) {
		logger.info(`[start-local] using env file ${envFilePath}`);
	}
	logger.info(`[start-local] backend listening on ${backendPort}`);
	logger.info(`[start-local] inspector listening on ${inspectPort}`);

	// 5. Attempt to open the inspector in a browser.
	try {
		open(inspectPort, '0.0.0.0', false);
	} catch (error) {
		logger.warn(error, `[start-local] failed to open inspector on ${inspectPort}`);
	}

	// 6. Write runtime metadata for other processes to consume.
	// This allows the frontend dev server to know which port the backend is running on.
	const runtimeMetadataPath = path.join(process.cwd(), '.typedai', 'runtime', 'backend.json');
	writeRuntimeMetadata(runtimeMetadataPath, {
		envFilePath,
		backendPort,
		inspectPort,
	});

	// 7. Start the server by requiring the main application entry point.
	const require = createRequire(__filename);
	require('../index');
}

main().catch((error) => {
	logger.fatal(error, '[start-local] failed to start backend');
	process.exitCode = 1;
});

/**
 * Builds an absolute path from a potential relative path.
 * @param value The path value (can be null or undefined).
 * @param cwd The current working directory to resolve from.
 * @returns An absolute path, or null if the input value is empty.
 */
function buildCandidatePath(value: string | null | undefined, cwd: string): string | null {
	if (!value) return null;
	if (isAbsolute(value)) return value;
	return resolve(cwd, value);
}

/**
 * Resolves the path to the env file used for local development.
 * Resolution order:
 * 1. Explicit `ENV_FILE` environment variable.
 * 2. `variables/local.env` relative to the current working directory.
 * 3. `variables/local.env` inside the directory specified by `TYPEDAI_HOME`.
 * @throws If no environment file can be found in any of the candidate locations.
 */
function resolveEnvFilePath(options: ResolveEnvFileOptions = {}): string {
	const cwd = options.cwd ?? process.cwd();
	const envFileCandidate = buildCandidatePath(options.envFile ?? process.env.ENV_FILE, cwd);
	const localEnvCandidate = resolve(cwd, 'variables', 'local.env');
	const typedAiHomeCandidate = options.typedAiHome ?? process.env.TYPEDAI_HOME;
	const typedAiEnvCandidate = typedAiHomeCandidate ? resolve(typedAiHomeCandidate, 'variables', 'local.env') : null;

	const candidates = [envFileCandidate, localEnvCandidate, typedAiEnvCandidate];
	for (const candidate of candidates) {
		if (!candidate) continue;
		if (existsSync(candidate)) return candidate;
	}

	throw new Error(
		'Could not locate environment file. Set ENV_FILE, create variables/local.env, or ensure TYPEDAI_HOME points to a repository that contains variables/local.env.',
	);
}

/**
 * Parses a dotenv-style file into a plain key/value map.
 * - Ignores lines starting with `#` (comments).
 * - Ignores lines without an equals sign.
 * - Trims whitespace from keys and values.
 * - Strips `export ` prefix from keys.
 * - Removes quotes from values.
 * - Converts `\n` literals to newlines.
 * @param filePath The absolute path to the environment file.
 * @returns A record of environment variables.
 */
function loadEnvFile(filePath: string): ParsedEnv {
	if (!existsSync(filePath)) throw new Error(`Environment file not found at ${filePath}`);
	const contents = readFileSync(filePath, 'utf8');
	const lines = contents.split(/\r?\n/);
	const parsed: ParsedEnv = {};

	for (const rawLine of lines) {
		const line = rawLine.trim();
		if (!line || line.startsWith('#')) continue;
		const equalIndex = line.indexOf('=');
		if (equalIndex <= 0) continue;

		const key = line
			.substring(0, equalIndex)
			.trim()
			.replace(/^export\s+/, '');
		if (!key) continue;
		let value = line.substring(equalIndex + 1).trim();

		if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
			value = value.slice(1, -1);
		}
		value = value.replace(/\\n/g, '\n');
		parsed[key] = value;
	}

	return parsed;
}

/**
 * Loads an environment file and assigns its values to `process.env`.
 * By default, it does not override existing environment variables.
 * @param filePath The path to the environment file.
 * @param options Configuration options. `override: true` will cause it to
 *   overwrite existing `process.env` values.
 */
function applyEnvFile(filePath: string, options: ApplyEnvOptions = {}): void {
	const envVars = loadEnvFile(filePath);
	const override = options.override ?? false;

	for (const [key, value] of Object.entries(envVars)) {
		if (!override && process.env[key] !== undefined) continue;
		process.env[key] = value;
	}
}

/**
 * Writes JSON metadata describing the current runtime so other processes can
 * discover the chosen configuration (e.g., ports). This is crucial for the
 * frontend dev server to connect to the correct backend port.
 * @param targetPath The full path where the metadata file will be written.
 * @param data The data object to serialize into the JSON file.
 */
function writeRuntimeMetadata(targetPath: string, data: Record<string, unknown>): void {
	const dir = path.dirname(targetPath);
	if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
	writeFileSync(targetPath, JSON.stringify({ ...data, updatedAt: new Date().toISOString() }, null, 2));
}

type ServerFactory = () => NetServer;

let serverFactory: ServerFactory = () => createServer();

/**
 * Overrides the net server factory used when probing ports.
 * This is primarily a testing utility to allow mocking of `net.createServer`
 * in environments where opening real sockets is not possible or desired.
 * @param factory A function that returns a `net.Server` instance, or null to reset.
 */
function setServerFactory(factory: ServerFactory | null): void {
	serverFactory = factory ?? (() => createServer());
}

/**
 * Attempts to find a free TCP port.
 * It first checks the `preferred` port and a number of subsequent ports (`attempts`).
 * If no port in that range is free, it falls back to asking the OS for any
 * available port by trying to listen on port 0.
 * @param preferred The starting port number to check.
 * @param attempts The number of consecutive ports to try after `preferred`.
 * @returns A promise that resolves with an available port number.
 * @throws If no available port can be found.
 */
async function findAvailablePort(preferred?: number, attempts = 20): Promise<number> {
	const ports: number[] = [];

	if (preferred && preferred > 0) {
		for (let i = 0; i < attempts; i++) {
			ports.push(preferred + i);
		}
	}

	ports.push(0);

	for (const port of ports) {
		try {
			const resolved = await tryListen(port);
			return resolved;
		} catch {}
	}

	throw new Error('Unable to find an available port');
}

/**
 * Ensures a fixed port can be bound, throwing an error if it is already in use.
 * This is used for the "default repo" setup where ports are expected to be fixed.
 * @param port The port to check.
 * @returns A promise that resolves if the port is available.
 * @throws If the port is already in use.
 */
async function ensurePortAvailable(port: number): Promise<void> {
	try {
		await tryListen(port);
	} catch (error: any) {
		const reason = error?.message ? `: ${error.message}` : '';
		throw new Error(`Port ${port} is unavailable${reason}`);
	}
}

/**
 * Low-level utility to test if a port is available by creating a server,
 * listening on the port, and then immediately closing it.
 * @param port The port number to test. A value of 0 will cause the OS to
 *   assign an arbitrary available port.
 * @returns A promise that resolves with the actual port number that was
 *   successfully bound.
 * @rejects If the port is already in use or another error occurs.
 */
async function tryListen(port: number): Promise<number> {
	return await new Promise<number>((resolve, reject) => {
		const server = serverFactory();

		server.once('error', (error) => {
			server.close();
			reject(error);
		});

		server.listen({ port, host: '0.0.0.0', exclusive: true }, () => {
			const address = server.address();
			server.close(() => {
				if (address && typeof address === 'object') {
					resolve(address.port);
				} else {
					resolve(port);
				}
			});
		});
	});
}
