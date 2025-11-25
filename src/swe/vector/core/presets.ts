import * as fs from 'node:fs';
import * as path from 'node:path';
import type { VectorStoreConfig } from './config';

/**
 * Repository vector configuration
 * References a preset from the TypedAI .vectorconfig.json
 */
export interface RepositoryVectorConfig {
	/** Config name (required when using array of configs) */
	name?: string;

	/** Mark as default when multiple configs exist */
	default?: boolean;

	/** Preset name - must match a named config in typedai's .vectorconfig.json */
	preset: string;

	/** Files to include (required) */
	includePatterns: string[];

	/** Optional: Override auto-detected backend */
	backend?: 'alloydb' | 'discovery-engine';

	/** Optional: Override preset values */
	overrides?: Partial<VectorStoreConfig>;
}

/**
 * Get path to typedai's .vectorconfig.json (preset registry)
 * Uses TYPEDAI_HOME env var to locate the typedai repo
 */
function getPresetRegistryPath(): string {
	const typedaiHome = process.env.TYPEDAI_HOME;
	if (!typedaiHome) {
		throw new Error(
			'TYPEDAI_HOME environment variable is not set.\n' + 'Set it to the path of the typedai repository, e.g.:\n' + '  export TYPEDAI_HOME=/path/to/nous',
		);
	}
	return path.join(typedaiHome, '.vectorconfig.json');
}

/**
 * Load all preset configs from typedai's .vectorconfig.json
 */
export function loadPresetRegistry(): VectorStoreConfig[] {
	const registryPath = getPresetRegistryPath();
	if (!fs.existsSync(registryPath)) {
		throw new Error(`Preset registry not found: ${registryPath}`);
	}
	const content = fs.readFileSync(registryPath, 'utf-8');
	const configs = JSON.parse(content);
	return Array.isArray(configs) ? configs : [configs];
}

/**
 * Get a preset by name from the registry
 */
export function getPreset(name: string): VectorStoreConfig {
	const registry = loadPresetRegistry();
	const preset = registry.find((c) => c.name === name);
	if (!preset) {
		const available = registry
			.map((c) => c.name)
			.filter(Boolean)
			.join(', ');
		throw new Error(`Unknown preset: "${name}". Available presets: ${available}`);
	}
	return { ...preset };
}

/**
 * List available preset names
 */
export function listPresets(): string[] {
	return loadPresetRegistry()
		.map((c) => c.name)
		.filter(Boolean) as string[];
}
