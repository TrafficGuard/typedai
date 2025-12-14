import { Pool, type QueryResult, type QueryResultRow } from 'pg';
import { logger } from '#o11y/logger';
import type { PostgresConfig } from './config';

/**
 * Generic PostgreSQL client interface.
 * Implemented by both CloudSqlClient (IAM auth) and PostgresClient (standard auth).
 */
export interface IPgClient {
	connect(): Promise<void>;
	disconnect(): Promise<void>;
	query<R extends QueryResultRow = any>(text: string, params?: any[]): Promise<QueryResult<R>>;
	initializeSchema(): Promise<void>;
	isConnected(): boolean;
}

/**
 * Schema SQL for file_summaries table.
 * Shared between all client implementations.
 */
export const SCHEMA_SQL = `
	CREATE TABLE IF NOT EXISTS file_summaries (
		id SERIAL PRIMARY KEY,
		repository_id VARCHAR(255) NOT NULL,
		file_path VARCHAR(1024) NOT NULL,
		content_hash VARCHAR(64) NOT NULL,
		short_summary TEXT NOT NULL,
		long_summary TEXT NOT NULL,
		summary_type VARCHAR(20) NOT NULL,
		created_at TIMESTAMP DEFAULT NOW(),
		updated_at TIMESTAMP DEFAULT NOW(),
		UNIQUE(repository_id, file_path)
	)
`;

export const INDEX_SQL = [
	'CREATE INDEX IF NOT EXISTS idx_summaries_repo ON file_summaries(repository_id)',
	'CREATE INDEX IF NOT EXISTS idx_summaries_repo_type ON file_summaries(repository_id, summary_type)',
];

/**
 * Standard PostgreSQL client using pg Pool.
 * Uses DATABASE_* environment variables for connection config.
 */
export class PostgresClient implements IPgClient {
	private pool: Pool | null = null;
	private config: PostgresConfig;

	constructor(config: PostgresConfig) {
		this.config = config;
	}

	async connect(): Promise<void> {
		if (this.pool) {
			logger.debug('PostgreSQL connection pool already initialized');
			return;
		}

		logger.info({ host: this.config.host, database: this.config.database }, 'Connecting to PostgreSQL');

		this.pool = new Pool({
			host: this.config.host,
			port: this.config.port,
			user: this.config.user,
			password: this.config.password,
			database: this.config.database,
			max: 5,
		});

		// Test connection
		try {
			const client = await this.pool.connect();
			const result = await client.query('SELECT version()');
			logger.info({ version: result.rows[0].version }, 'Connected to PostgreSQL');
			client.release();
		} catch (error) {
			logger.error({ error }, 'Failed to connect to PostgreSQL');
			await this.disconnect();
			throw error;
		}

		this.pool.on('error', (err) => {
			logger.error({ error: err }, 'Unexpected error on idle PostgreSQL client');
		});
	}

	async disconnect(): Promise<void> {
		if (this.pool) {
			logger.info('Closing PostgreSQL connection pool');
			await this.pool.end();
			this.pool = null;
		}
	}

	async query<R extends QueryResultRow = any>(text: string, params?: any[]): Promise<QueryResult<R>> {
		if (!this.pool) {
			throw new Error('PostgreSQL client not connected. Call connect() first.');
		}

		logger.debug({ query: text.substring(0, 100), paramCount: params?.length }, 'Executing query');

		try {
			const result = await this.pool.query<R>(text, params);
			logger.debug({ rowCount: result.rowCount }, 'Query executed successfully');
			return result;
		} catch (error) {
			logger.error({ error, query: text.substring(0, 200) }, 'Query failed');
			throw error;
		}
	}

	async initializeSchema(): Promise<void> {
		logger.info('Initializing PostgreSQL summary store schema');

		await this.query(SCHEMA_SQL);

		for (const indexSql of INDEX_SQL) {
			await this.query(indexSql);
		}

		logger.info('Schema initialized successfully');
	}

	isConnected(): boolean {
		return this.pool !== null;
	}
}
