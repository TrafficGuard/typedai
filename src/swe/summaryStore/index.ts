/**
 * Cloud SQL Summary Store Module
 *
 * Provides optional Cloud SQL storage for file/folder summaries,
 * enabling team-wide sharing of LLM-generated code summaries.
 *
 * This is an opt-in enhancement - the existing local-only workflow
 * remains the default when no Cloud SQL configuration is provided.
 *
 * @example Configuration in .typedai.json:
 * ```json
 * {
 *   "summaryStore": {
 *     "type": "cloudsql",
 *     "googleCloud": {
 *       "projectId": "my-project",
 *       "region": "us-central1",
 *       "instanceConnectionName": "my-project:us-central1:my-instance",
 *       "database": "summaries"
 *     }
 *   }
 * }
 * ```
 *
 * @example CLI Usage:
 * ```bash
 * pnpm summaries pull    # Pull from Cloud SQL
 * pnpm summaries push    # Push to Cloud SQL
 * pnpm summaries sync    # Full sync: pull → build → push
 * pnpm summaries status  # Show sync status
 * ```
 */

// Configuration
export {
	getSummaryStoreConfig,
	isCloudSqlEnabled,
	isPostgresEnabled,
	isDatabaseEnabled,
	type SummaryStoreConfig,
	type CloudSqlConfig,
	type PostgresConfig,
} from './config';

// PostgreSQL Client Interface and Implementations
export { type IPgClient, PostgresClient, SCHEMA_SQL, INDEX_SQL } from './pgClient';
export { CloudSqlClient } from './cloudSqlClient';

// Summary Store Adapter
export {
	PostgresSummaryStore,
	CloudSqlSummaryStore,
	createSummaryStore,
	determineSummaryType,
	type ISummaryStore,
} from './summaryStoreAdapter';

// Repository ID
export { getRepositoryId, normalizeGitUrl, isGitRepository } from './repoId';

// Local Hydration
export { hydrateLocalSummaries, readLocalSummaries, deleteOrphanedLocalSummaries } from './localHydration';

// Sync State
export {
	loadSyncState,
	saveSyncState,
	recordSuccessfulPull,
	recordSuccessfulPush,
	recordPendingPush,
	getSyncStatusMessage,
	createEmptySyncState,
	type SyncState,
} from './syncState';
