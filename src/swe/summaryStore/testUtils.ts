import type { PGlite } from '@electric-sql/pglite';
import type { QueryResult, QueryResultRow } from 'pg';
import { INDEX_SQL, type IPgClient, SCHEMA_SQL } from './pgClient';

/**
 * Creates an IPgClient wrapper around a PGlite instance for testing.
 * PGlite provides real PostgreSQL semantics in-memory without Docker.
 */
export function createPGliteClient(pglite: PGlite): IPgClient {
	let schemaInitialized = false;

	return {
		async connect(): Promise<void> {
			// PGlite is already connected when instantiated
		},

		async disconnect(): Promise<void> {
			// Don't close PGlite - let the test manage its lifecycle
		},

		async query<R extends QueryResultRow = any>(text: string, params?: any[]): Promise<QueryResult<R>> {
			const result = await pglite.query<R>(text, params);
			return {
				rows: result.rows,
				rowCount: result.rows.length,
				command: '',
				oid: 0,
				fields: [], // PGlite field format differs from pg; not needed for these tests
			};
		},

		async initializeSchema(): Promise<void> {
			if (schemaInitialized) return;

			await pglite.query(SCHEMA_SQL);
			for (const indexSql of INDEX_SQL) {
				await pglite.query(indexSql);
			}
			schemaInitialized = true;
		},

		isConnected(): boolean {
			return true;
		},
	};
}

/**
 * Helper to create a PGlite instance for tests.
 * Each test suite should call this in before() and close in after().
 */
export async function createTestPGlite(): Promise<PGlite> {
	const { PGlite } = await import('@electric-sql/pglite');
	return new PGlite();
}

/**
 * Clears all data from the file_summaries table.
 * Call this in beforeEach() to ensure test isolation.
 */
export async function clearSummariesTable(pglite: PGlite): Promise<void> {
	await pglite.query('DELETE FROM file_summaries');
}
