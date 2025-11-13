/**
 * AlloyDB Vector Search Module
 *
 * Provides vector search implementation using AlloyDB for PostgreSQL with:
 * - Automated vector embedding via AlloyDB AI
 * - ScaNN index in AUTO mode for optimal performance
 * - Hybrid search (vector + full-text search)
 * - Transactional updates for file chunks
 * - Columnar engine support for filtered vector search
 *
 * @module swe/vector/alloydb
 */

// Configuration
export type { AlloyDBConfig } from './alloydbConfig';
export { DEFAULT_ALLOYDB_CONFIG } from './alloydbConfig';
export {
	buildAlloyDBConfig,
	validateAlloyDBConfig,
	getPostgresConnectionOptions,
	sanitizeRepoNameForTable,
	getTableNameForRepo,
} from './alloydbConfig';

// Client
export { AlloyDBClient } from './alloydbClient';

// Adapter
export { AlloyDBAdapter } from './alloydbAdapter';

// Orchestrator
export { AlloyDBOrchestrator } from './alloydbOrchestrator';

// Factory functions
export {
	createAlloyDBAdapter,
	createAlloyDBOrchestrator,
	createAlloyDBOrchestratorFromRepo,
	createAlloyDBAdapterWithConfig,
	createAlloyDBOrchestratorWithConfig,
	validateAlloyDBPrerequisites,
} from './alloydbFactory';
