import { envVar } from '#utils/env-var';
import type { VectorStoreConfig } from '../core/config';

/**
 * AlloyDB connection configuration
 */
export interface AlloyDBConfig {
	/** AlloyDB instance resource name */
	instance?: string; // e.g., 'projects/PROJECT/locations/REGION/clusters/CLUSTER/instances/INSTANCE'

	/** Database name */
	database: string;

	/** Connection string (alternative to instance) */
	connectionString?: string;

	/** User for database authentication */
	user?: string;

	/** Password for database authentication */
	password?: string;

	/** Host (if not using connectionString or instance) */
	host?: string;

	/** Port (default: 5432) */
	port?: number;

	/** Max connections in pool */
	maxConnections?: number;

	/** Idle timeout in milliseconds */
	idleTimeoutMs?: number;

	/** Connection timeout in milliseconds */
	connectionTimeoutMs?: number;

	/** Use AlloyDB Auth Proxy */
	useAuthProxy?: boolean;

	/** Embedding model for automated embeddings */
	embeddingModel?: string;

	/** Enable columnar engine for better filtered vector search */
	enableColumnarEngine?: boolean;

	/** Hybrid search vector weight (0-1, text weight = 1 - vectorWeight) */
	vectorWeight?: number;
}

/**
 * Default AlloyDB configuration
 */
export const DEFAULT_ALLOYDB_CONFIG: Partial<AlloyDBConfig> = {
	port: 5432,
	maxConnections: 10,
	idleTimeoutMs: 30000,
	connectionTimeoutMs: 10000,
	useAuthProxy: true,
	embeddingModel: 'gemini-embedding-001',
	enableColumnarEngine: true,
	vectorWeight: 0.7, // 70% vector, 30% text in hybrid search
};

/**
 * Build AlloyDB configuration from VectorStoreConfig and environment variables
 * Config values override environment variables
 *
 * @param config VectorStoreConfig with AlloyDB settings
 * @returns AlloyDBConfig for database connection
 */
export function buildAlloyDBConfig(config: VectorStoreConfig): AlloyDBConfig {
	const alloydbConfig: AlloyDBConfig = {
		...DEFAULT_ALLOYDB_CONFIG,
		instance: config.alloydbInstance || process.env.ALLOYDB_INSTANCE,
		database: config.alloydbDatabase || envVar('ALLOYDB_DATABASE', 'vector_db'),
		connectionString: config.alloydbConnectionString || process.env.ALLOYDB_CONNECTION_STRING,
		user: config.alloydbUser || process.env.ALLOYDB_USER || process.env.PGUSER,
		password: config.alloydbPassword || process.env.ALLOYDB_PASSWORD || process.env.PGPASSWORD,
		host: config.alloydbHost || process.env.ALLOYDB_HOST || process.env.PGHOST,
		port: config.alloydbPort || (process.env.ALLOYDB_PORT ? Number.parseInt(process.env.ALLOYDB_PORT) : 5432),
		embeddingModel: config.alloydbEmbeddingModel || DEFAULT_ALLOYDB_CONFIG.embeddingModel,
		enableColumnarEngine: config.alloydbEnableColumnarEngine ?? DEFAULT_ALLOYDB_CONFIG.enableColumnarEngine,
		vectorWeight: config.alloydbVectorWeight ?? DEFAULT_ALLOYDB_CONFIG.vectorWeight,
	};

	return alloydbConfig;
}

/**
 * Validate AlloyDB configuration
 */
export function validateAlloyDBConfig(config: AlloyDBConfig): { valid: boolean; errors: string[] } {
	const errors: string[] = [];

	if (!config.database) {
		errors.push('database is required');
	}

	if (!config.connectionString) {
		// If no connection string, check for individual connection params
		if (!config.instance && !config.host) {
			errors.push('Either connectionString, instance, or host must be provided');
		}

		if (!config.user && !config.useAuthProxy) {
			errors.push('user is required when not using Auth Proxy or connection string');
		}
	}

	if (config.vectorWeight !== undefined && (config.vectorWeight < 0 || config.vectorWeight > 1)) {
		errors.push('vectorWeight must be between 0 and 1');
	}

	if (config.maxConnections !== undefined && config.maxConnections < 1) {
		errors.push('maxConnections must be at least 1');
	}

	return {
		valid: errors.length === 0,
		errors,
	};
}

/**
 * Get PostgreSQL connection options from AlloyDB config
 */
export function getPostgresConnectionOptions(config: AlloyDBConfig): Record<string, any> {
	if (config.connectionString) {
		return {
			connectionString: config.connectionString,
			max: config.maxConnections,
			idleTimeoutMillis: config.idleTimeoutMs,
			connectionTimeoutMillis: config.connectionTimeoutMs,
		};
	}

	// Build connection options from individual params
	const options: Record<string, any> = {
		database: config.database,
		max: config.maxConnections,
		idleTimeoutMillis: config.idleTimeoutMs,
		connectionTimeoutMillis: config.connectionTimeoutMs,
	};

	if (config.useAuthProxy && config.instance) {
		// When using Auth Proxy, connect via Unix socket
		// The proxy creates a socket at /tmp/alloydb/{instance_connection_name}
		options.host = '/tmp/alloydb';
		options.user = config.user || 'postgres';
	} else {
		options.host = config.host;
		options.port = config.port;
		options.user = config.user;
		options.password = config.password;
	}

	return options;
}

/**
 * Sanitize repository name for use as table name
 * Converts git URL or path to valid PostgreSQL identifier
 */
export function sanitizeRepoNameForTable(repoIdentifier: string): string {
	// Remove git URL protocol and domain
	let sanitized = repoIdentifier
		.replace(/^https?:\/\//, '')
		.replace(/^git@/, '')
		.replace(/\.git$/, '')
		.replace(/github\.com[:/]/, '')
		.replace(/gitlab\.com[:/]/, '')
		.replace(/bitbucket\.org[:/]/, '');

	// Replace invalid characters with underscores
	sanitized = sanitized.replace(/[^a-zA-Z0-9_]/g, '_');

	// Ensure it starts with a letter or underscore
	if (/^[0-9]/.test(sanitized)) {
		sanitized = `repo_${sanitized}`;
	}

	// Truncate to PostgreSQL identifier limit (63 chars)
	if (sanitized.length > 50) {
		// Leave room for "code_chunks_" prefix
		sanitized = sanitized.substring(0, 50);
	}

	return sanitized.toLowerCase();
}

/**
 * Get table name for a repository
 */
export function getTableNameForRepo(repoIdentifier: string): string {
	const sanitized = sanitizeRepoNameForTable(repoIdentifier);
	return `code_chunks_${sanitized}`;
}
