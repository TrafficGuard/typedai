import * as fs from 'node:fs';
import * as path from 'node:path';
import { getFileSystem } from '#agent/agentContextUtils';
import { logger } from '#o11y/logger';
import { AI_INFO_FILENAME } from '#swe/projectDetection';

/**
 * Cloud SQL configuration for summary storage
 */
export interface CloudSqlConfig {
	/** GCP project ID (overrides env GCLOUD_PROJECT) */
	projectId?: string;
	/** GCP region (overrides env GCLOUD_REGION) */
	region?: string;
	/** Cloud SQL instance connection name (format: project:region:instance) */
	instanceConnectionName: string;
	/** Database name */
	database: string;
}

/**
 * Local PostgreSQL configuration for summary storage
 */
export interface PostgresConfig {
	host: string;
	port: number;
	user: string;
	password: string;
	database: string;
}

/**
 * Summary store configuration
 */
export interface SummaryStoreConfig {
	/** Storage type: 'local' (default), 'cloudsql', or 'postgres' */
	type: 'local' | 'cloudsql' | 'postgres';
	/** Cloud SQL configuration (required when type is 'cloudsql') */
	googleCloud?: CloudSqlConfig;
	/** Local PostgreSQL configuration (required when type is 'postgres') */
	postgres?: PostgresConfig;
}

/**
 * Extended project info file format with summary store config
 */
interface ProjectInfoWithSummaryStore {
	summaryStore?: SummaryStoreConfig;
}

/**
 * Gets summary store configuration from .typedai.json or environment variables.
 *
 * Resolution priority:
 * 1. `.typedai.json` with `summaryStore` config
 * 2. `DATABASE_TYPE=postgres` env var -> use DATABASE_* env vars
 * 3. `SUMMARY_STORE_TYPE=cloudsql` env var -> use Cloud SQL
 * 4. Default -> null (local-only mode)
 *
 * Returns null if no cloud/database configuration is set.
 */
export async function getSummaryStoreConfig(): Promise<SummaryStoreConfig | null> {
	// First try to load from .typedai.json
	const fss = getFileSystem();
	const configPath = path.join(fss.getWorkingDirectory(), AI_INFO_FILENAME);

	try {
		if (await fss.fileExists(configPath)) {
			const content = await fss.readFile(configPath);
			const config = JSON.parse(content) as ProjectInfoWithSummaryStore[];

			// Look for summaryStore in the first project config (or could be at root level)
			const projectConfig = Array.isArray(config) ? config[0] : config;
			if (projectConfig?.summaryStore) {
				logger.debug({ config: projectConfig.summaryStore }, 'Loaded summaryStore config from .typedai.json');
				return projectConfig.summaryStore;
			}
		}
	} catch (error) {
		logger.debug({ error }, 'Failed to load summaryStore config from .typedai.json');
	}

	// Check for DATABASE_TYPE=postgres (local PostgreSQL)
	if (process.env.DATABASE_TYPE === 'postgres') {
		const host = process.env.DATABASE_HOST;
		const database = process.env.DATABASE_NAME;

		if (!host || !database) {
			logger.warn('DATABASE_TYPE is postgres but DATABASE_HOST or DATABASE_NAME not set');
			return null;
		}

		return {
			type: 'postgres',
			postgres: {
				host,
				port: Number.parseInt(process.env.DATABASE_PORT || '5432', 10),
				user: process.env.DATABASE_USER || 'postgres',
				password: process.env.DATABASE_PASSWORD || '',
				database,
			},
		};
	}

	// Check for SUMMARY_STORE_TYPE=cloudsql (Cloud SQL)
	const storeType = process.env.SUMMARY_STORE_TYPE as 'local' | 'cloudsql' | undefined;

	if (storeType === 'cloudsql') {
		const instanceConnectionName = process.env.SUMMARY_STORE_INSTANCE;
		const database = process.env.SUMMARY_STORE_DATABASE;

		if (!instanceConnectionName || !database) {
			logger.warn('SUMMARY_STORE_TYPE is cloudsql but SUMMARY_STORE_INSTANCE or SUMMARY_STORE_DATABASE not set');
			return null;
		}

		return {
			type: 'cloudsql',
			googleCloud: {
				projectId: process.env.GCLOUD_PROJECT,
				region: process.env.GCLOUD_REGION,
				instanceConnectionName,
				database,
			},
		};
	}

	// Return null to indicate local-only mode (default)
	return null;
}

/**
 * Checks if Cloud SQL summary storage is enabled
 */
export function isCloudSqlEnabled(config: SummaryStoreConfig | null): config is SummaryStoreConfig & { type: 'cloudsql' } {
	return config?.type === 'cloudsql' && config.googleCloud != null;
}

/**
 * Checks if local PostgreSQL summary storage is enabled
 */
export function isPostgresEnabled(config: SummaryStoreConfig | null): config is SummaryStoreConfig & { type: 'postgres' } {
	return config?.type === 'postgres' && config.postgres != null;
}

/**
 * Checks if any database-backed summary storage is enabled (Cloud SQL or local Postgres)
 */
export function isDatabaseEnabled(config: SummaryStoreConfig | null): boolean {
	return isCloudSqlEnabled(config) || isPostgresEnabled(config);
}
