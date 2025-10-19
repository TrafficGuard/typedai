/**
 * @fileoverview
 * Utility for loading environment variables from .env files in CLI tools.
 * When using git worktrees enables using the local.env from the main repository
 * Extracted from startLocal.ts to be shared across all CLI tools.
 */

import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
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
export function resolveEnvFilePath(options: ResolveEnvFileOptions = {}): string {
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
export function loadEnvFile(filePath: string): ParsedEnv {
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
export function applyEnvFile(filePath: string, options: ApplyEnvOptions = {}): void {
	const envVars = loadEnvFile(filePath);
	const override = options.override ?? false;

	for (const [key, value] of Object.entries(envVars)) {
		if (!override && process.env[key] !== undefined) continue;
		process.env[key] = value;
	}
}

/**
 * Convenience function to load environment variables from a .env file for CLI tools.
 * Tries to find and load the environment file, but continues gracefully if not found.
 * @param options Configuration options for override behavior
 */
export function loadCliEnvironment(options: ApplyEnvOptions = {}): void {
	try {
		const envFilePath = resolveEnvFilePath();
		applyEnvFile(envFilePath, options);
		logger.debug(`Loaded environment from ${envFilePath}`);
	} catch (err) {
		logger.debug(err, 'No environment file found; continuing with existing process.env');
	}
}
