import { Pool, PoolClient, QueryResult, QueryResultRow } from 'pg';
import pino from 'pino';
import type { AlloyDBConfig } from './alloydbConfig';
import { getPostgresConnectionOptions, validateAlloyDBConfig } from './alloydbConfig';

const logger = pino({ name: 'AlloyDBClient' });

/**
 * AlloyDB client with connection pooling
 * Manages PostgreSQL connections to AlloyDB instance
 */
export class AlloyDBClient {
	private pool: Pool | null = null;
	private config: AlloyDBConfig;

	constructor(config: AlloyDBConfig) {
		this.config = config;
	}

	/**
	 * Initialize connection pool
	 */
	async connect(): Promise<void> {
		if (this.pool) {
			logger.debug('Connection pool already initialized');
			return;
		}

		// Validate configuration
		const validation = validateAlloyDBConfig(this.config);
		if (!validation.valid) {
			throw new Error(`Invalid AlloyDB configuration: ${validation.errors.join(', ')}`);
		}

		logger.info({ database: this.config.database }, 'Connecting to AlloyDB');

		const connectionOptions = getPostgresConnectionOptions(this.config);
		this.pool = new Pool(connectionOptions);

		// Test connection
		try {
			const client = await this.pool.connect();
			const result = await client.query('SELECT version()');
			logger.info({ version: result.rows[0].version }, 'Connected to AlloyDB');
			client.release();
		} catch (error) {
			logger.error({ error }, 'Failed to connect to AlloyDB');
			await this.pool.end();
			this.pool = null;
			throw error;
		}

		// Handle pool errors
		this.pool.on('error', (err) => {
			logger.error({ error: err }, 'Unexpected error on idle client');
		});
	}

	/**
	 * Close connection pool
	 */
	async disconnect(): Promise<void> {
		if (!this.pool) {
			return;
		}

		logger.info('Closing AlloyDB connection pool');
		await this.pool.end();
		this.pool = null;
	}

	/**
	 * Execute a query
	 */
	async query<R extends QueryResultRow = any>(text: string, params?: any[]): Promise<QueryResult<R>> {
		if (!this.pool) {
			throw new Error('AlloyDB client not connected. Call connect() first.');
		}

		logger.debug({ query: text, params }, 'Executing query');

		try {
			const result = await this.pool.query<R>(text, params);
			logger.debug({ rowCount: result.rowCount }, 'Query executed successfully');
			return result;
		} catch (error) {
			logger.error({ error, query: text, params }, 'Query failed');
			throw error;
		}
	}

	/**
	 * Execute a transaction
	 * @param callback Function that executes queries within transaction
	 */
	async transaction<T>(callback: (client: PoolClient) => Promise<T>): Promise<T> {
		if (!this.pool) {
			throw new Error('AlloyDB client not connected. Call connect() first.');
		}

		const client = await this.pool.connect();

		try {
			await client.query('BEGIN');
			logger.debug('Transaction started');

			const result = await callback(client);

			await client.query('COMMIT');
			logger.debug('Transaction committed');

			return result;
		} catch (error) {
			await client.query('ROLLBACK');
			logger.error({ error }, 'Transaction rolled back');
			throw error;
		} finally {
			client.release();
		}
	}

	/**
	 * Get a client from the pool for manual transaction management
	 */
	async getClient(): Promise<PoolClient> {
		if (!this.pool) {
			throw new Error('AlloyDB client not connected. Call connect() first.');
		}
		return this.pool.connect();
	}

	/**
	 * Get pool reference (for advanced usage)
	 */
	getPool(): Pool {
		if (!this.pool) {
			throw new Error('AlloyDB client not connected. Call connect() first.');
		}
		return this.pool;
	}

	/**
	 * Check if connected
	 */
	isConnected(): boolean {
		return this.pool !== null;
	}

	/**
	 * Check if required extensions are installed
	 */
	async checkExtensions(): Promise<{ vector: boolean; scann: boolean; columnarEngine: boolean }> {
		const result = await this.query<{ extname: string }>(
			`SELECT extname FROM pg_extension WHERE extname IN ('vector', 'alloydb_scann', 'google_columnar_engine')`,
		);

		const extensions = new Set(result.rows.map((row) => row.extname));

		return {
			vector: extensions.has('vector'),
			scann: extensions.has('alloydb_scann'),
			columnarEngine: extensions.has('google_columnar_engine'),
		};
	}

	/**
	 * Install required extensions (requires superuser or appropriate permissions)
	 */
	async installExtensions(): Promise<void> {
		logger.info('Installing required extensions');

		try {
			// Install vector extension
			await this.query('CREATE EXTENSION IF NOT EXISTS vector CASCADE');
			logger.info('Vector extension installed');

			// Install alloydb_scann extension
			await this.query('CREATE EXTENSION IF NOT EXISTS alloydb_scann CASCADE');
			logger.info('AlloyDB ScaNN extension installed');

			// Install columnar engine (optional, may require special permissions)
			if (this.config.enableColumnarEngine) {
				try {
					await this.query('CREATE EXTENSION IF NOT EXISTS google_columnar_engine CASCADE');
					logger.info('Google Columnar Engine extension installed');
				} catch (error) {
					logger.warn({ error }, 'Failed to install columnar engine extension (requires special permissions)');
				}
			}
		} catch (error) {
			logger.error({ error }, 'Failed to install extensions');
			throw error;
		}
	}

	/**
	 * Check if automated embeddings are available
	 */
	async checkAutomatedEmbeddings(): Promise<boolean> {
		try {
			const result = await this.query(`
				SELECT EXISTS (
					SELECT 1 FROM pg_proc
					WHERE proname = 'initialize_embeddings'
					AND pronamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'ai')
				) AS exists
			`);
			return result.rows[0].exists;
		} catch (error) {
			logger.warn({ error }, 'Failed to check for automated embeddings support');
			return false;
		}
	}

	/**
	 * Get database statistics
	 */
	async getStats(): Promise<{
		database: string;
		size: string;
		connections: number;
		maxConnections: number;
	}> {
		const sizeResult = await this.query(`
			SELECT pg_size_pretty(pg_database_size(current_database())) AS size
		`);

		const connectionsResult = await this.query(`
			SELECT count(*) AS current,
			       (SELECT setting::int FROM pg_settings WHERE name = 'max_connections') AS max
			FROM pg_stat_activity
		`);

		return {
			database: this.config.database,
			size: sizeResult.rows[0].size,
			connections: Number.parseInt(connectionsResult.rows[0].current),
			maxConnections: Number.parseInt(connectionsResult.rows[0].max),
		};
	}
}
