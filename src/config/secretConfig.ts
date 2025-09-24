import { logger } from '#o11y/logger';

export const SECRET_PTR_PREFIX = 'secret://';

// -- Secret manager --

export interface SecretManager {
	listSecrets(projectId?: string): Promise<string[]>;
	accessSecret(secretName: string, version?: string, projectIdOrName?: string): Promise<string>;
}

let secretManager: SecretManager | undefined;

// -- Secret config --

const secrets = new Map<string, string>(); // envKey -> secret value

let initialized = false;
let hasSecretEnvVars = false;

for (const [k, v] of Object.entries(process.env)) {
	if (!k) continue;
	const val = (v ?? '').trim();
	if (val.startsWith(SECRET_PTR_PREFIX)) hasSecretEnvVars = true;
}

export async function loadSecrets(sm?: SecretManager) {
	if (initialized) logger.info('Reloading secrets');

	const mapping = new Map<string, string>(); // envKey -> secret name
	const requested = new Set<string>();

	// Find process.env entries that start with SECRET_PTR_PREFIX
	for (const [k, v] of Object.entries(process.env)) {
		if (!k) continue;
		const val = (v ?? '').trim();
		if (!val.startsWith(SECRET_PTR_PREFIX)) continue;
		const secretName = val.substring(SECRET_PTR_PREFIX.length).trim();
		if (!secretName) continue;
		mapping.set(k, secretName);
		requested.add(secretName);
	}

	if (requested.size && !sm) throw new Error('Secret manager not provided');

	const allSecrets = new Set(await sm!.listSecrets());
	const toLoad = Array.from(requested).filter((n) => allSecrets.has(n));

	logger.info({
		message: `Config init: ${toLoad.length} secrets requested and present`,
		requestedCount: requested.size,
		presentCount: toLoad.length,
	});

	await Promise.all(
		toLoad.map(async (name) => {
			const value = await sm!.accessSecret(name, 'latest');
			secrets.set(name, value);
			for (const [envKey, mappedName] of mapping.entries()) {
				if (mappedName === name) secrets.set(envKey, value);
			}
			logger.info(`Loaded secret ${name}`);
		}),
	);

	initialized = true;
}

/**
 * Returns the secret value for the given environment variable name.
 * @param name
 * @returns the secret value
 * @throws Error if the secret manager is not initialized or the secret does not exist in the secret manager
 */
export function getSecret(name: string): string {
	if (hasSecretEnvVars && !initialized) throw new Error('Secret manager not initialized');
	if (!hasSecret(name)) throw new Error(`Secret '${name}' not found in ${Array.from(secrets.keys())}`);
	return secrets.get(name)!;
}

export function hasSecret(name: string): boolean {
	return secrets.has(name);
}
