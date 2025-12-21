import { logger } from '#o11y/logger';
import type { VectorStoreConfig } from '../core/config';
import { DEFAULT_VECTOR_CONFIG } from '../core/config';
import { AlloyDBAdapter } from './alloydbAdapter';
import type { AlloyDBConfig } from './alloydbConfig';
import { DEFAULT_ALLOYDB_CONFIG, buildAlloyDBConfig } from './alloydbConfig';
import { AlloyDBOrchestrator } from './alloydbOrchestrator';

/**
 * Create AlloyDB vector store adapter
 *
 * @param repoIdentifier Repository identifier (git URL or path)
 * @param config Vector store configuration
 * @returns AlloyDB adapter instance
 */
export function createAlloyDBAdapter(repoIdentifier: string, config?: VectorStoreConfig): AlloyDBAdapter {
	const vectorConfig = config || DEFAULT_VECTOR_CONFIG;
	const alloydbConfig = buildAlloyDBConfig(vectorConfig);

	logger.info({ repoIdentifier, config: alloydbConfig }, 'Creating AlloyDB adapter');

	return new AlloyDBAdapter(repoIdentifier, alloydbConfig);
}

/**
 * Create AlloyDB vector search orchestrator
 *
 * @param repoIdentifier Repository identifier (git URL or path)
 * @param config Vector store configuration
 * @returns AlloyDB orchestrator instance
 */
export function createAlloyDBOrchestrator(repoIdentifier: string, config?: VectorStoreConfig): AlloyDBOrchestrator {
	const vectorConfig = config || DEFAULT_VECTOR_CONFIG;
	const alloydbConfig = buildAlloyDBConfig(vectorConfig);

	logger.info({ repoIdentifier, config: alloydbConfig }, 'Creating AlloyDB orchestrator');

	return new AlloyDBOrchestrator(repoIdentifier, alloydbConfig, vectorConfig);
}

/**
 * Create AlloyDB orchestrator from environment variables and config file
 *
 * @param repoRoot Repository root path (to load .vectorconfig.json)
 * @param repoIdentifier Repository identifier (git URL or path)
 * @param configName Optional config name to load from array of configs
 * @returns AlloyDB orchestrator instance
 */
export async function createAlloyDBOrchestratorFromRepo(repoRoot: string, repoIdentifier: string, configName?: string): Promise<AlloyDBOrchestrator> {
	const { loadVectorConfig } = await import('../core/config.js');
	const config = loadVectorConfig(repoRoot, configName);

	logger.info({ repoRoot, repoIdentifier, configName }, 'Creating AlloyDB orchestrator from repo config');

	return createAlloyDBOrchestrator(repoIdentifier, config);
}

/**
 * Create AlloyDB adapter with custom AlloyDB configuration
 *
 * @param repoIdentifier Repository identifier
 * @param alloydbConfig Custom AlloyDB configuration
 * @param vectorConfig Optional vector store configuration
 * @returns AlloyDB adapter instance
 */
export function createAlloyDBAdapterWithConfig(repoIdentifier: string, alloydbConfig: AlloyDBConfig, vectorConfig?: VectorStoreConfig): AlloyDBAdapter {
	logger.info({ repoIdentifier }, 'Creating AlloyDB adapter with custom config');

	return new AlloyDBAdapter(repoIdentifier, alloydbConfig);
}

/**
 * Create AlloyDB orchestrator with custom AlloyDB configuration
 *
 * @param repoIdentifier Repository identifier
 * @param alloydbConfig Custom AlloyDB configuration
 * @param vectorConfig Optional vector store configuration
 * @returns AlloyDB orchestrator instance
 */
export function createAlloyDBOrchestratorWithConfig(
	repoIdentifier: string,
	alloydbConfig: AlloyDBConfig,
	vectorConfig?: VectorStoreConfig,
): AlloyDBOrchestrator {
	logger.info({ repoIdentifier }, 'Creating AlloyDB orchestrator with custom config');

	return new AlloyDBOrchestrator(repoIdentifier, alloydbConfig, vectorConfig);
}

/**
 * Validate AlloyDB prerequisites
 * Checks that AlloyDB instance is accessible and has required extensions
 *
 * @param config AlloyDB configuration
 * @returns Validation result with errors
 */
export async function validateAlloyDBPrerequisites(config: AlloyDBConfig): Promise<{
	valid: boolean;
	errors: string[];
	warnings: string[];
}> {
	const errors: string[] = [];
	const warnings: string[] = [];

	// Validate configuration
	const { validateAlloyDBConfig } = await import('./alloydbConfig.js');
	const configValidation = validateAlloyDBConfig(config);
	if (!configValidation.valid) {
		errors.push(...configValidation.errors);
	}

	if (errors.length > 0) {
		return { valid: false, errors, warnings };
	}

	// Try to connect and check extensions
	try {
		const { AlloyDBClient } = await import('./alloydbClient.js');
		const client = new AlloyDBClient(config);

		await client.connect();

		// Check extensions
		const extensions = await client.checkExtensions();

		if (!extensions.vector) {
			errors.push('Vector extension not installed. Run: CREATE EXTENSION IF NOT EXISTS vector CASCADE');
		}

		if (!extensions.scann) {
			errors.push('AlloyDB ScaNN extension not installed. Run: CREATE EXTENSION IF NOT EXISTS alloydb_scann CASCADE');
		}

		if (config.enableColumnarEngine && !extensions.columnarEngine) {
			warnings.push('Columnar engine extension not installed. Run: CREATE EXTENSION IF NOT EXISTS google_columnar_engine CASCADE');
		}

		// Check automated embeddings support
		const hasAutomatedEmbeddings = await client.checkAutomatedEmbeddings();
		if (!hasAutomatedEmbeddings) {
			warnings.push('Automated embeddings (ai.initialize_embeddings) not available on this instance');
		}

		// Get database stats
		const stats = await client.getStats();
		logger.info({ stats }, 'AlloyDB connection validated');

		await client.disconnect();
	} catch (error) {
		errors.push(`Failed to connect to AlloyDB: ${error instanceof Error ? error.message : String(error)}`);
	}

	return {
		valid: errors.length === 0,
		errors,
		warnings,
	};
}
