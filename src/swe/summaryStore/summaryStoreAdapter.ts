import { logger } from '#o11y/logger';
import type { Summary } from '#swe/index/llmSummaries';
import { CloudSqlClient } from './cloudSqlClient';
import { type SummaryStoreConfig, isCloudSqlEnabled, isPostgresEnabled } from './config';
import { type IPgClient, PostgresClient } from './pgClient';

/**
 * Database row type for file summaries
 */
interface SummaryRow {
	repository_id: string;
	file_path: string;
	content_hash: string;
	short_summary: string;
	long_summary: string;
	summary_type: string;
	updated_at: Date;
}

/**
 * Interface for summary storage backends
 */
export interface ISummaryStore {
	/**
	 * Pull all summaries for a repository
	 */
	pull(repoId: string): Promise<Map<string, Summary>>;

	/**
	 * Push summaries to the store (upsert)
	 */
	push(repoId: string, summaries: Map<string, Summary>): Promise<void>;

	/**
	 * Delete summaries by paths
	 */
	delete(repoId: string, paths: string[]): Promise<void>;

	/**
	 * Close any connections
	 */
	close(): Promise<void>;
}

/**
 * Determines the summary type from a file path.
 * Exported for testing.
 */
export function determineSummaryType(path: string): 'project' | 'folder' | 'file' {
	if (path === '_project_summary') {
		return 'project';
	}
	if (path.endsWith('/_index') || path === '_index') {
		return 'folder';
	}
	return 'file';
}

/**
 * PostgreSQL implementation of the summary store.
 * Works with any IPgClient implementation (CloudSqlClient, PostgresClient, or PGlite for tests).
 */
export class PostgresSummaryStore implements ISummaryStore {
	private client: IPgClient;
	private connected = false;

	constructor(client: IPgClient) {
		this.client = client;
	}

	private async ensureConnected(): Promise<void> {
		if (!this.connected) {
			await this.client.connect();
			await this.client.initializeSchema();
			this.connected = true;
		}
	}

	async pull(repoId: string): Promise<Map<string, Summary>> {
		await this.ensureConnected();

		logger.info({ repoId }, 'Pulling summaries from database');

		const result = await this.client.query<SummaryRow>(
			`SELECT file_path, content_hash, short_summary, long_summary, summary_type
			 FROM file_summaries
			 WHERE repository_id = $1`,
			[repoId],
		);

		const summaries = new Map<string, Summary>();

		for (const row of result.rows) {
			summaries.set(row.file_path, {
				path: row.file_path,
				short: row.short_summary,
				long: row.long_summary,
				meta: {
					hash: row.content_hash,
				},
			});
		}

		logger.info({ repoId, count: summaries.size }, 'Pulled summaries from database');
		return summaries;
	}

	async push(repoId: string, summaries: Map<string, Summary>): Promise<void> {
		await this.ensureConnected();

		if (summaries.size === 0) {
			logger.debug({ repoId }, 'No summaries to push');
			return;
		}

		logger.info({ repoId, count: summaries.size }, 'Pushing summaries to database');

		// Batch upsert using ON CONFLICT
		const values: any[] = [];
		const placeholders: string[] = [];
		let paramIndex = 1;

		for (const [path, summary] of summaries) {
			const summaryType = determineSummaryType(path);

			placeholders.push(`($${paramIndex}, $${paramIndex + 1}, $${paramIndex + 2}, $${paramIndex + 3}, $${paramIndex + 4}, $${paramIndex + 5})`);
			values.push(repoId, path, summary.meta.hash, summary.short, summary.long, summaryType);
			paramIndex += 6;
		}

		// Execute in batches of 100 to avoid query size limits
		const batchSize = 100;
		for (let i = 0; i < placeholders.length; i += batchSize) {
			const batchPlaceholders = placeholders.slice(i, i + batchSize);
			const batchValues = values.slice(i * 6, (i + batchSize) * 6);

			await this.client.query(
				`INSERT INTO file_summaries (repository_id, file_path, content_hash, short_summary, long_summary, summary_type)
				 VALUES ${batchPlaceholders.join(', ')}
				 ON CONFLICT (repository_id, file_path)
				 DO UPDATE SET
					content_hash = EXCLUDED.content_hash,
					short_summary = EXCLUDED.short_summary,
					long_summary = EXCLUDED.long_summary,
					summary_type = EXCLUDED.summary_type,
					updated_at = NOW()`,
				batchValues,
			);
		}

		logger.info({ repoId, count: summaries.size }, 'Pushed summaries to database');
	}

	async delete(repoId: string, paths: string[]): Promise<void> {
		await this.ensureConnected();

		if (paths.length === 0) {
			return;
		}

		logger.info({ repoId, count: paths.length }, 'Deleting summaries from database');

		// Delete in batches
		const batchSize = 100;
		for (let i = 0; i < paths.length; i += batchSize) {
			const batch = paths.slice(i, i + batchSize);
			const placeholders = batch.map((_, idx) => `$${idx + 2}`).join(', ');

			await this.client.query(`DELETE FROM file_summaries WHERE repository_id = $1 AND file_path IN (${placeholders})`, [repoId, ...batch]);
		}
	}

	async close(): Promise<void> {
		if (this.connected) {
			await this.client.disconnect();
			this.connected = false;
		}
	}
}

/**
 * @deprecated Use PostgresSummaryStore with CloudSqlClient instead
 */
export const CloudSqlSummaryStore = PostgresSummaryStore;

/**
 * Factory function to create a summary store based on configuration
 */
export async function createSummaryStore(config: SummaryStoreConfig | null): Promise<ISummaryStore | null> {
	if (!config) {
		return null;
	}

	if (isCloudSqlEnabled(config) && config.googleCloud) {
		const client = new CloudSqlClient(config.googleCloud);
		return new PostgresSummaryStore(client);
	}

	if (isPostgresEnabled(config) && config.postgres) {
		const client = new PostgresClient(config.postgres);
		return new PostgresSummaryStore(client);
	}

	return null;
}
