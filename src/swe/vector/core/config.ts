import * as fs from 'node:fs';
import * as path from 'node:path';
import { envVar } from '#utils/env-var';
import type { GoogleVectorServiceConfig } from '../google/googleVectorConfig';

/**
 * Core vector store configuration for repository indexing
 */
export interface VectorStoreConfig {
	/** Name of the vector store collection (used to map to specific collections) */
	name?: string;

	// === Google Cloud Discovery Engine Configuration ===
	/** GCP project ID (overrides env GCLOUD_PROJECT) */
	gcpProject?: string;

	/** Discovery Engine location (overrides env DISCOVERY_ENGINE_LOCATION, default: 'global') */
	discoveryEngineLocation?: string;

	/** Discovery Engine collection ID (overrides env DISCOVERY_ENGINE_COLLECTION_ID, default: 'default_collection') */
	discoveryEngineCollectionId?: string;

	/** GCP region for embedding service (overrides env GCLOUD_REGION, default: 'us-central1') */
	gcpRegion?: string;

	/** Discovery Engine datastore ID (overrides env DISCOVERY_ENGINE_DATA_STORE_ID) */
	datastoreId?: string;

	// === Vector Search Settings ===
	/** Enable dual embedding (code + natural language translation) - ~12% better retrieval */
	dualEmbedding: boolean;

	/** Enable contextual chunking (LLM-generated context) - ~49-67% better retrieval */
	contextualChunking: boolean;

	/** Chunk size in characters (default: 2500) */
	chunkSize?: number;

	/** Chunk overlap in characters (default: 300) */
	chunkOverlap?: number;

	/** Chunking strategy: 'ast' (fast, semantic) or 'llm' (slow, high quality) */
	chunkStrategy?: 'ast' | 'llm';

	/** Embedding provider: 'vertex' | 'openai' | 'voyage' | 'cohere' */
	embeddingProvider?: string;

	/** Embedding model name */
	embeddingModel?: string;

	/** Enable hybrid search (vector + BM25 lexical) */
	hybridSearch?: boolean;

	/** Enable reranking for search results */
	reranking?: boolean;

	/** Reranking model (default: 'semantic-ranker-512@latest') */
	rerankingModel?: string;

	/** Number of candidates to rerank (default: 50, max: 200) */
	rerankingTopK?: number;

	/** File/directory patterns to include (glob patterns, e.g., ['src/**', 'lib/**']) */
	includePatterns?: string[];

	/** Maximum file size in bytes to index (default: 1MB) */
	maxFileSize?: number;

	/** Supported file extensions to index */
	fileExtensions?: string[];

	/** Log contextualized chunks to .typedai/vector/chunks/ for debugging (default: false) */
	logChunks?: boolean;

	// === AlloyDB Configuration ===
	/** AlloyDB instance resource name (e.g., 'projects/PROJECT/locations/REGION/clusters/CLUSTER/instances/INSTANCE') */
	alloydbInstance?: string;

	/** AlloyDB database name */
	alloydbDatabase?: string;

	/** AlloyDB connection string (alternative to instance) */
	alloydbConnectionString?: string;

	/** AlloyDB host (for direct connection) */
	alloydbHost?: string;

	/** AlloyDB port (default: 5432) */
	alloydbPort?: number;

	/** AlloyDB user */
	alloydbUser?: string;

	/** AlloyDB password */
	alloydbPassword?: string;

	/** AlloyDB embedding model for automated embeddings (default: 'gemini-embedding-001') */
	alloydbEmbeddingModel?: string;

	/** Enable AlloyDB columnar engine for better filtered vector search (default: true) */
	alloydbEnableColumnarEngine?: boolean;

	/** Hybrid search vector weight (0-1, text weight = 1 - vectorWeight, default: 0.7) */
	alloydbVectorWeight?: number;
}

/**
 * Default configuration - fast and cost-effective
 */
export const DEFAULT_VECTOR_CONFIG: VectorStoreConfig = {
	dualEmbedding: false,
	contextualChunking: false,
	chunkSize: 2500,
	chunkOverlap: 300,
	chunkStrategy: 'ast',
	embeddingProvider: 'vertex',
	embeddingModel: 'gemini-embedding-001',
	hybridSearch: true,
	reranking: false,
	maxFileSize: 1024 * 1024, // 1MB
	fileExtensions: ['.ts', '.tsx', '.js', '.jsx', '.py', '.java', '.cpp', '.c', '.h', '.go', '.rs', '.rb', '.php', '.cs', '.swift', '.kt'],
	logChunks: false,
};

/**
 * High quality configuration - enables all quality features
 */
export const HIGH_QUALITY_CONFIG: VectorStoreConfig = {
	...DEFAULT_VECTOR_CONFIG,
	dualEmbedding: true,
	contextualChunking: true,
	reranking: true,
};

/**
 * Load vector store configuration from repository
 * Checks for .vectorconfig.json or vectorStore field in package.json
 *
 * @param repoRoot - Repository root path
 * @param configName - Optional config name to load from array of configs
 * @returns Single config or first config from array if no name specified
 */
export function loadVectorConfig(repoRoot: string, configName?: string): VectorStoreConfig {
	// Try .vectorconfig.json first
	const vectorConfigPath = path.join(repoRoot, '.vectorconfig.json');
	if (fs.existsSync(vectorConfigPath)) {
		try {
			const configContent = fs.readFileSync(vectorConfigPath, 'utf-8');
			const parsed = JSON.parse(configContent);

			// Check if it's an array of configs
			if (Array.isArray(parsed)) {
				if (configName) {
					// Find config by name
					const config = parsed.find((c) => c.name === configName);
					if (!config) {
						throw new Error(`Config with name "${configName}" not found`);
					}
					return { ...DEFAULT_VECTOR_CONFIG, ...config };
				}
				// Return first config if no name specified
				if (parsed.length === 0) {
					throw new Error('Config array is empty');
				}
				return { ...DEFAULT_VECTOR_CONFIG, ...parsed[0] };
			}

			// Single config object
			return { ...DEFAULT_VECTOR_CONFIG, ...parsed };
		} catch (error) {
			console.warn(`Failed to parse .vectorconfig.json: ${error}`);
		}
	}

	// Try package.json vectorStore field
	const packageJsonPath = path.join(repoRoot, 'package.json');
	if (fs.existsSync(packageJsonPath)) {
		try {
			const packageContent = fs.readFileSync(packageJsonPath, 'utf-8');
			const packageJson = JSON.parse(packageContent);
			if (packageJson.vectorStore) {
				const vectorStore = packageJson.vectorStore;

				// Check if it's an array of configs
				if (Array.isArray(vectorStore)) {
					if (configName) {
						const config = vectorStore.find((c) => c.name === configName);
						if (!config) {
							throw new Error(`Config with name "${configName}" not found`);
						}
						return { ...DEFAULT_VECTOR_CONFIG, ...config };
					}
					if (vectorStore.length === 0) {
						throw new Error('Config array is empty');
					}
					return { ...DEFAULT_VECTOR_CONFIG, ...vectorStore[0] };
				}

				return { ...DEFAULT_VECTOR_CONFIG, ...vectorStore };
			}
		} catch (error) {
			console.warn(`Failed to parse package.json: ${error}`);
		}
	}

	// Return default config
	return DEFAULT_VECTOR_CONFIG;
}

/**
 * Load all vector store configurations from repository
 * Returns array of all configs (even if there's only one)
 */
export function loadAllVectorConfigs(repoRoot: string): VectorStoreConfig[] {
	// Try .vectorconfig.json first
	const vectorConfigPath = path.join(repoRoot, '.vectorconfig.json');
	if (fs.existsSync(vectorConfigPath)) {
		try {
			const configContent = fs.readFileSync(vectorConfigPath, 'utf-8');
			const parsed = JSON.parse(configContent);

			// Check if it's an array of configs
			if (Array.isArray(parsed)) {
				return parsed.map((c) => ({ ...DEFAULT_VECTOR_CONFIG, ...c }));
			}

			// Single config object - wrap in array
			return [{ ...DEFAULT_VECTOR_CONFIG, ...parsed }];
		} catch (error) {
			console.warn(`Failed to parse .vectorconfig.json: ${error}`);
		}
	}

	// Try package.json vectorStore field
	const packageJsonPath = path.join(repoRoot, 'package.json');
	if (fs.existsSync(packageJsonPath)) {
		try {
			const packageContent = fs.readFileSync(packageJsonPath, 'utf-8');
			const packageJson = JSON.parse(packageContent);
			if (packageJson.vectorStore) {
				const vectorStore = packageJson.vectorStore;

				// Check if it's an array of configs
				if (Array.isArray(vectorStore)) {
					return vectorStore.map((c) => ({ ...DEFAULT_VECTOR_CONFIG, ...c }));
				}

				return [{ ...DEFAULT_VECTOR_CONFIG, ...vectorStore }];
			}
		} catch (error) {
			console.warn(`Failed to parse package.json: ${error}`);
		}
	}

	// Return default config in array
	return [DEFAULT_VECTOR_CONFIG];
}

/**
 * Save vector store configuration to repository
 * @param repoRoot - Repository root path
 * @param config - Single config or array of configs to save
 */
export function saveVectorConfig(repoRoot: string, config: VectorStoreConfig | VectorStoreConfig[]): void {
	const vectorConfigPath = path.join(repoRoot, '.vectorconfig.json');
	fs.writeFileSync(vectorConfigPath, JSON.stringify(config, null, 2), 'utf-8');
}

/**
 * Add or update a vector store configuration in the config file
 * @param repoRoot - Repository root path
 * @param config - Config to add or update (matched by name)
 */
export function addOrUpdateVectorConfig(repoRoot: string, config: VectorStoreConfig): void {
	const configs = loadAllVectorConfigs(repoRoot);

	if (!config.name) {
		// If no name, replace the entire config with a single config
		saveVectorConfig(repoRoot, config);
		return;
	}

	// Find existing config by name
	const existingIndex = configs.findIndex((c) => c.name === config.name);

	if (existingIndex >= 0) {
		// Update existing config
		configs[existingIndex] = { ...configs[existingIndex], ...config };
	} else {
		// Add new config
		configs.push(config);
	}

	saveVectorConfig(repoRoot, configs);
}

/**
 * Validate vector store configuration
 */
export function validateVectorConfig(config: VectorStoreConfig): { valid: boolean; errors: string[] } {
	const errors: string[] = [];

	if (config.name !== undefined) {
		if (typeof config.name !== 'string' || config.name.trim() === '') {
			errors.push('name must be a non-empty string');
		}
		// Validate name format (alphanumeric, dash, underscore)
		if (config.name && !/^[a-zA-Z0-9_-]+$/.test(config.name)) {
			errors.push('name must contain only alphanumeric characters, dashes, and underscores');
		}
	}

	// GCP configuration validation
	if (config.gcpProject !== undefined && config.gcpProject.trim() === '') {
		errors.push('gcpProject must be a non-empty string');
	}

	if (config.datastoreId !== undefined && config.datastoreId.trim() === '') {
		errors.push('datastoreId must be a non-empty string');
	}

	if (config.discoveryEngineLocation !== undefined) {
		const validLocations = ['global', 'us', 'eu'];
		if (!validLocations.includes(config.discoveryEngineLocation)) {
			errors.push(`discoveryEngineLocation must be one of: ${validLocations.join(', ')}`);
		}
	}

	if (config.gcpRegion !== undefined && config.gcpRegion.trim() === '') {
		errors.push('gcpRegion must be a non-empty string');
	}

	if (config.discoveryEngineCollectionId !== undefined && config.discoveryEngineCollectionId.trim() === '') {
		errors.push('discoveryEngineCollectionId must be a non-empty string');
	}

	if (config.chunkSize && config.chunkSize < 100) {
		errors.push('chunkSize must be at least 100 characters');
	}

	if (config.chunkSize && config.chunkSize > 10000) {
		errors.push('chunkSize should not exceed 10000 characters');
	}

	if (config.chunkOverlap && config.chunkOverlap < 0) {
		errors.push('chunkOverlap must be non-negative');
	}

	if (config.chunkOverlap && config.chunkSize && config.chunkOverlap >= config.chunkSize) {
		errors.push('chunkOverlap must be less than chunkSize');
	}

	if (config.chunkStrategy && !['ast', 'llm'].includes(config.chunkStrategy)) {
		errors.push("chunkStrategy must be 'ast' or 'llm'");
	}

	if (config.maxFileSize && config.maxFileSize < 1024) {
		errors.push('maxFileSize must be at least 1KB');
	}

	return {
		valid: errors.length === 0,
		errors,
	};
}

/**
 * Validate array of vector store configurations
 * Checks for duplicate names and validates each config
 */
export function validateVectorConfigs(configs: VectorStoreConfig[]): { valid: boolean; errors: string[] } {
	const errors: string[] = [];
	const names = new Set<string>();

	for (const config of configs) {
		// Validate individual config
		const configValidation = validateVectorConfig(config);
		if (!configValidation.valid) {
			errors.push(...configValidation.errors.map((e) => `Config "${config.name || 'unnamed'}": ${e}`));
		}

		// Check for duplicate names
		if (config.name) {
			if (names.has(config.name)) {
				errors.push(`Duplicate config name: "${config.name}"`);
			}
			names.add(config.name);
		}
	}

	// If there are multiple configs, all should have names
	if (configs.length > 1) {
		const unnamedConfigs = configs.filter((c) => !c.name);
		if (unnamedConfigs.length > 0) {
			errors.push(`When using multiple configs, all configs must have a "name" property (${unnamedConfigs.length} unnamed config(s) found)`);
		}
	}

	return {
		valid: errors.length === 0,
		errors,
	};
}

/**
 * Build GoogleVectorServiceConfig from VectorStoreConfig + environment variables
 * Config values override environment variables
 *
 * @param config VectorStoreConfig with optional GCP settings
 * @returns GoogleVectorServiceConfig for Google Cloud services
 */
export function buildGoogleVectorServiceConfig(config: VectorStoreConfig): GoogleVectorServiceConfig {
	return {
		project: config.gcpProject || envVar('GCLOUD_PROJECT'),
		region: config.gcpRegion || envVar('GCLOUD_REGION', 'us-central1'),
		discoveryEngineLocation: config.discoveryEngineLocation || envVar('DISCOVERY_ENGINE_LOCATION', 'global'),
		collection: config.discoveryEngineCollectionId || envVar('DISCOVERY_ENGINE_COLLECTION_ID', 'default_collection'),
		dataStoreId: config.datastoreId || envVar('DISCOVERY_ENGINE_DATA_STORE_ID', 'test-datastore'),
		embeddingModel: config.embeddingModel || process.env.DISCOVERY_ENGINE_EMBEDDING_MODEL || 'gemini-embedding-001',
	};
}

/**
 * Get estimated cost per file based on configuration
 * Returns cost estimate in USD
 */
export function estimateCostPerFile(config: VectorStoreConfig, avgFileSize = 5000): number {
	let cost = 0;

	// Base embedding cost (~$0.00001 per 1K tokens)
	const tokensPerFile = avgFileSize / 4; // rough estimate: 4 chars per token
	cost += (tokensPerFile / 1000) * 0.00001;

	// Dual embedding doubles the embedding cost
	if (config.dualEmbedding) {
		cost += (tokensPerFile / 1000) * 0.00001; // code-to-english translation
		cost += (tokensPerFile / 1000) * 0.00001; // second embedding
	}

	// Contextual chunking adds LLM cost
	if (config.contextualChunking) {
		// Assume 5 chunks per file, each needing context generation
		const chunksPerFile = 5;
		const tokensPerContextGeneration = avgFileSize + 100; // full file + context prompt
		cost += ((chunksPerFile * tokensPerContextGeneration) / 1000) * 0.00001;
	}

	return cost;
}

/**
 * Print configuration summary
 */
export function printConfigSummary(config: VectorStoreConfig): void {
	console.log('Vector Store Configuration:');
	console.log('━'.repeat(50));
	console.log(`  Dual Embedding: ${config.dualEmbedding ? '✓ Enabled' : '✗ Disabled'}`);
	console.log(`  Contextual Chunking: ${config.contextualChunking ? '✓ Enabled' : '✗ Disabled'}`);
	console.log(`  Chunk Strategy: ${config.chunkStrategy || 'ast'}`);
	console.log(`  Chunk Size: ${config.chunkSize || 2500} chars`);
	console.log(`  Chunk Overlap: ${config.chunkOverlap || 300} chars`);
	console.log(`  Embedding Provider: ${config.embeddingProvider || 'vertex'}`);
	console.log(`  Embedding Model: ${config.embeddingModel || 'gemini-embedding-001'}`);
	console.log(`  Hybrid Search: ${config.hybridSearch ? '✓ Enabled' : '✗ Disabled'}`);
	console.log(`  Reranking: ${config.reranking ? '✓ Enabled' : '✗ Disabled'}`);
	console.log('━'.repeat(50));

	// Show quality and cost estimates
	const quality = (config.dualEmbedding ? 12 : 0) + (config.contextualChunking ? 60 : 0);
	const costMultiplier = 1 + (config.dualEmbedding ? 2 : 0) + (config.contextualChunking ? 5 : 0);

	console.log(`  Estimated Quality Improvement: ~${quality}%`);
	console.log(`  Estimated Cost Multiplier: ${costMultiplier}x`);
	console.log(`  Estimated Cost per File: ~$${estimateCostPerFile(config).toFixed(6)}`);
	console.log('━'.repeat(50));
}
