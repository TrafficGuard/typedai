import { AuthTypes, Connector, IpAddressTypes } from '@google-cloud/cloud-sql-connector';
import type { PoolClient, QueryResult, QueryResultRow } from 'pg';
import { Pool } from 'pg';
import { logger } from '#o11y/logger';
import type { CloudSqlConfig } from './config';
import { INDEX_SQL, type IPgClient, SCHEMA_SQL } from './pgClient';

/**
 * Cloud SQL client with IAM-based authentication via Cloud SQL Connector.
 * Manages PostgreSQL connections to Cloud SQL instance.
 * Implements IPgClient for compatibility with PostgresSummaryStore.
 */
export class CloudSqlClient implements IPgClient {
	private pool: Pool | null = null;
	private connector: Connector | null = null;
	private config: CloudSqlConfig;

	constructor(config: CloudSqlConfig) {
		this.config = config;
	}

	/**
	 * Initialize connection pool with Cloud SQL Connector
	 */
	async connect(): Promise<void> {
		if (this.pool) {
			logger.debug('Connection pool already initialized');
			return;
		}

		logger.info({ instanceConnectionName: this.config.instanceConnectionName, database: this.config.database }, 'Connecting to Cloud SQL');

		// Create Cloud SQL Connector
		this.connector = new Connector();

		try {
			// Get connection options from the connector using IAM auth
			const clientOpts = await this.connector.getOptions({
				instanceConnectionName: this.config.instanceConnectionName,
				ipType: IpAddressTypes.PUBLIC,
				authType: AuthTypes.IAM,
			});

			// Create pool with connector options
			this.pool = new Pool({
				...clientOpts,
				user: await this.getIamUser(),
				database: this.config.database,
				max: 5, // Connection pool size
			});

			// Test connection
			const client = await this.pool.connect();
			const result = await client.query('SELECT version()');
			logger.info({ version: result.rows[0].version }, 'Connected to Cloud SQL');
			client.release();
		} catch (error) {
			logger.error({ error }, 'Failed to connect to Cloud SQL');
			await this.disconnect();
			throw error;
		}

		// Handle pool errors
		this.pool.on('error', (err) => {
			logger.error({ error: err }, 'Unexpected error on idle client');
		});
	}

	/**
	 * Get the IAM user for authentication.
	 * Uses service account email or current user's email from ADC.
	 */
	private async getIamUser(): Promise<string> {
		// If GOOGLE_APPLICATION_CREDENTIALS is set, use service account
		if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
			try {
				const fs = await import('node:fs');
				const credentials = JSON.parse(fs.readFileSync(process.env.GOOGLE_APPLICATION_CREDENTIALS, 'utf-8'));
				if (credentials.client_email) {
					// Remove .gserviceaccount.com suffix for IAM user
					return credentials.client_email.replace('.gserviceaccount.com', '');
				}
			} catch (error) {
				logger.warn({ error }, 'Failed to read service account credentials');
			}
		}

		// Fall back to using gcloud auth
		try {
			const { GoogleAuth } = await import('google-auth-library');
			const auth = new GoogleAuth();
			const credentials = await auth.getCredentials();
			if (credentials.client_email) {
				return credentials.client_email.replace('.gserviceaccount.com', '');
			}
		} catch (error) {
			logger.warn({ error }, 'Failed to get credentials from GoogleAuth');
		}

		throw new Error('Unable to determine IAM user for Cloud SQL authentication');
	}

	/**
	 * Close connection pool and connector
	 */
	async disconnect(): Promise<void> {
		if (this.pool) {
			logger.info('Closing Cloud SQL connection pool');
			await this.pool.end();
			this.pool = null;
		}

		if (this.connector) {
			this.connector.close();
			this.connector = null;
		}
	}

	/**
	 * Execute a query
	 */
	async query<R extends QueryResultRow = any>(text: string, params?: any[]): Promise<QueryResult<R>> {
		if (!this.pool) {
			throw new Error('Cloud SQL client not connected. Call connect() first.');
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

	/**
	 * Execute a transaction
	 */
	async transaction<T>(callback: (client: PoolClient) => Promise<T>): Promise<T> {
		if (!this.pool) {
			throw new Error('Cloud SQL client not connected. Call connect() first.');
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
	 * Check if connected
	 */
	isConnected(): boolean {
		return this.pool !== null;
	}

	/**
	 * Initialize the database schema
	 */
	async initializeSchema(): Promise<void> {
		logger.info('Initializing Cloud SQL summary store schema');

		await this.query(SCHEMA_SQL);

		for (const indexSql of INDEX_SQL) {
			await this.query(indexSql);
		}

		logger.info('Schema initialized successfully');
	}
}
