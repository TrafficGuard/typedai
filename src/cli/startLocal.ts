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
 */
async function main(): Promise<void> {
	let envFilePath: string | undefined;
	try {
		envFilePath = resolveEnvFilePath();
		applyEnvFile(envFilePath);
	} catch (err) {
		logger.warn(err, '[start-local] no environment file found; continuing with existing process.env');
	}

	process.env.NODE_ENV ??= 'development';

	const repoRoot = path.resolve(process.cwd());
	const typedAiHome = process.env.TYPEDAI_HOME ? path.resolve(process.env.TYPEDAI_HOME) : null;
	const isDefaultRepo = typedAiHome ? repoRoot === typedAiHome : false;

	const parsedPort = process.env.PORT ? Number.parseInt(process.env.PORT, 10) : undefined;
	let backendPort: number;
	if (isDefaultRepo) {
		backendPort = Number.isFinite(parsedPort) ? parsedPort! : 3000;
		await ensurePortAvailable(backendPort);
	} else {
		backendPort = await findAvailablePort(Number.isFinite(parsedPort) ? parsedPort : 3000);
	}
	process.env.PORT = backendPort.toString();
	process.env.BACKEND_PORT = backendPort.toString();

	const inspectorParsed = process.env.INSPECT_PORT ? Number.parseInt(process.env.INSPECT_PORT, 10) : undefined;
	let inspectPort: number;
	if (isDefaultRepo) {
		inspectPort = Number.isFinite(inspectorParsed) ? inspectorParsed! : 9229;
		await ensurePortAvailable(inspectPort);
	} else {
		inspectPort = await findAvailablePort(Number.isFinite(inspectorParsed) ? inspectorParsed : 9229);
	}
	process.env.INSPECT_PORT = inspectPort.toString();

	const apiBaseUrl = `http://localhost:${backendPort}/api/`;
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

	try {
		open(inspectPort, '0.0.0.0', false);
	} catch (error) {
		logger.warn(error, `[start-local] failed to open inspector on ${inspectPort}`);
	}

	const runtimeMetadataPath = path.join(process.cwd(), '.typedai', 'runtime', 'backend.json');
	writeRuntimeMetadata(runtimeMetadataPath, {
		envFilePath,
		backendPort,
		inspectPort,
	});

	const require = createRequire(__filename);
	require('../index');
}

main().catch((error) => {
	logger.fatal(error, '[start-local] failed to start backend');
	process.exitCode = 1;
});

function buildCandidatePath(value: string | null | undefined, cwd: string): string | null {
	if (!value) return null;
	if (isAbsolute(value)) return value;
	return resolve(cwd, value);
}

/**
 * Resolves the path to the env file used for local development.
 * Resolution order: explicit ENV_FILE → `variables/local.env` in the cwd →
 * `$TYPEDAI_HOME/variables/local.env`.
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
 * Parses a dotenv style file into a plain key/value map.
 * Lines without an equals sign or starting with `#` are ignored.
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
 * Loads the file and assigns its values to `process.env`.
 * Existing values are preserved unless `override` is set.
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
 * discover the chosen configuration (e.g. ports).
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
 * Primarily for tests where opening real sockets would fail in a sandbox.
 */
function setServerFactory(factory: ServerFactory | null): void {
	serverFactory = factory ?? (() => createServer());
}

/**
 * Attempts to find a free TCP port. Prefers the provided range before
 * delegating to the OS (port 0).
 */
/**
 * Attempts to find a free TCP port. Prefers the provided range before
 * delegating to the OS (port 0).
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

/** Ensures a fixed port can be bound, throwing when it is already in use. */
async function ensurePortAvailable(port: number): Promise<void> {
	try {
		await tryListen(port);
	} catch (error: any) {
		const reason = error?.message ? `: ${error.message}` : '';
		throw new Error(`Port ${port} is unavailable${reason}`);
	}
}

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
