import type { VectorStoreConfig } from '../core/config';

/**
 * ChromaDB connection configuration
 */
export interface ChromaConfig {
	/** ChromaDB server URL (default: http://localhost:8000) */
	url: string;

	/** Authentication token (optional, for ChromaDB Cloud or authenticated servers) */
	authToken?: string;

	/** Tenant name (default: 'default_tenant') */
	tenant?: string;

	/** Database name (default: 'default_database') */
	database?: string;

	/** Collection name prefix */
	collectionPrefix?: string;

	/** Embedding dimension (must match the embedder) */
	embeddingDimension: number;

	/** Distance function: 'cosine' | 'l2' | 'ip' */
	distanceFunction?: 'cosine' | 'l2' | 'ip';

	/** Hybrid search text weight (0-1, vector weight = 1 - textWeight) */
	textWeight?: number;
}

/**
 * Default ChromaDB configuration
 */
export const DEFAULT_CHROMA_CONFIG: Partial<ChromaConfig> = {
	url: 'http://localhost:8000',
	tenant: 'default_tenant',
	database: 'default_database',
	collectionPrefix: 'code_chunks',
	distanceFunction: 'cosine',
	textWeight: 0.3, // 30% text, 70% vector in hybrid search
};

/**
 * Build ChromaDB configuration from VectorStoreConfig and environment variables
 * Config values override environment variables
 *
 * @param config VectorStoreConfig with Chroma settings
 * @param embeddingDimension Dimension from the embedder
 * @returns ChromaConfig for database connection
 */
export function buildChromaConfig(config: VectorStoreConfig, embeddingDimension: number): ChromaConfig {
	const chromaConfig: ChromaConfig = {
		...DEFAULT_CHROMA_CONFIG,
		url: config.chroma?.url || process.env.CHROMA_URL || DEFAULT_CHROMA_CONFIG.url!,
		authToken: config.chroma?.authToken || process.env.CHROMA_AUTH_TOKEN,
		tenant: config.chroma?.tenant || process.env.CHROMA_TENANT || DEFAULT_CHROMA_CONFIG.tenant,
		database: config.chroma?.database || process.env.CHROMA_DATABASE || DEFAULT_CHROMA_CONFIG.database,
		collectionPrefix: config.chroma?.collectionPrefix || DEFAULT_CHROMA_CONFIG.collectionPrefix,
		embeddingDimension,
		distanceFunction: config.chroma?.distanceFunction || DEFAULT_CHROMA_CONFIG.distanceFunction,
		textWeight: config.chroma?.textWeight ?? DEFAULT_CHROMA_CONFIG.textWeight,
	};

	return chromaConfig;
}

/**
 * Validate ChromaDB configuration
 */
export function validateChromaConfig(config: ChromaConfig): { valid: boolean; errors: string[] } {
	const errors: string[] = [];

	if (!config.url) {
		errors.push('url is required');
	}

	if (!config.embeddingDimension || config.embeddingDimension < 1) {
		errors.push('embeddingDimension must be a positive integer');
	}

	if (config.textWeight !== undefined && (config.textWeight < 0 || config.textWeight > 1)) {
		errors.push('textWeight must be between 0 and 1');
	}

	if (config.distanceFunction && !['cosine', 'l2', 'ip'].includes(config.distanceFunction)) {
		errors.push("distanceFunction must be 'cosine', 'l2', or 'ip'");
	}

	return {
		valid: errors.length === 0,
		errors,
	};
}

/**
 * Sanitize repository name for use as collection name
 * Converts git URL or path to valid ChromaDB collection name
 */
export function sanitizeRepoNameForCollection(repoIdentifier: string): string {
	// Remove git URL protocol and domain
	let sanitized = repoIdentifier
		.replace(/^https?:\/\//, '')
		.replace(/^git@/, '')
		.replace(/\.git$/, '')
		.replace(/github\.com[:/]/, '')
		.replace(/gitlab\.com[:/]/, '')
		.replace(/bitbucket\.org[:/]/, '');

	// Replace invalid characters with underscores
	// ChromaDB collection names: 3-63 chars, starts/ends with alphanumeric, can contain underscores, hyphens
	sanitized = sanitized.replace(/[^a-zA-Z0-9_-]/g, '_');

	// Ensure it starts with a letter
	if (/^[^a-zA-Z]/.test(sanitized)) {
		sanitized = `repo_${sanitized}`;
	}

	// Ensure it ends with alphanumeric
	sanitized = sanitized.replace(/[^a-zA-Z0-9]+$/, '');

	// Truncate to ChromaDB collection name limit (63 chars)
	// Leave room for prefix
	if (sanitized.length > 45) {
		sanitized = sanitized.substring(0, 45);
	}

	// Ensure minimum length of 3 chars after prefix
	if (sanitized.length < 3) {
		sanitized = `${sanitized}_repo`;
	}

	return sanitized.toLowerCase();
}

/**
 * Get collection name for a repository
 */
export function getCollectionNameForRepo(repoIdentifier: string, prefix?: string): string {
	const sanitized = sanitizeRepoNameForCollection(repoIdentifier);
	const collectionPrefix = prefix || DEFAULT_CHROMA_CONFIG.collectionPrefix;
	return `${collectionPrefix}_${sanitized}`;
}
