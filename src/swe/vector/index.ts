/**
 * Vector Search System
 *
 * A comprehensive, configurable vector search solution for code repositories.
 *
 * Features:
 * - AST-based semantic chunking
 * - Optional contextual enrichment (49-67% better retrieval)
 * - Optional dual embeddings (12% better retrieval)
 * - Merkle tree-based incremental sync
 * - Hybrid search (vector + BM25)
 *
 * @see README.md for detailed documentation
 */

// Core Configuration
export type { VectorStoreConfig } from './core/config';
export {
	DEFAULT_VECTOR_CONFIG,
	HIGH_QUALITY_CONFIG,
	loadVectorConfig,
	saveVectorConfig,
	validateVectorConfig,
	estimateCostPerFile,
	printConfigSummary,
} from './core/config';

// Core Interfaces
export type {
	IChunker,
	IContextualizer,
	ICodeTranslator,
	IEmbedder,
	IVectorStore,
	ISynchronizer,
	IReranker,
	IVectorSearchOrchestrator,
	RawChunk,
	ContextualizedChunk,
	ChunkWithFile,
	EmbeddedChunk,
	SearchResult,
	FileInfo,
	ChunkSourceLocation,
	ProgressInfo,
	ProgressCallback,
} from './core/interfaces';

// Chunking
export { ASTChunker } from './chunking/astChunker';

// Contextualization
export { LLMContextualizer, MetadataContextualizer } from './core/contextualizer';

// Translation
export { LLMCodeTranslator, SimpleCodeTranslator } from './core/codeTranslator';

// Embeddings
export { VertexEmbedderAdapter, DualEmbeddingGenerator, getDocumentTaskType, getQueryTaskType } from './google/vertexEmbedderAdapter';

// Synchronization
export { MerkleSynchronizer } from './sync/merkleSynchronizer';

// Vector Store
export { DiscoveryEngineAdapter } from './google/discoveryEngineAdapter';

// Main Orchestrator
export { VectorSearchOrchestrator } from './google/vectorSearchOrchestrator';

// Legacy exports for backward compatibility
export { DiscoveryEngine } from './google/discoveryEngine';
export { VertexAITextEmbeddingService } from './google/vertexEmbedder';
export type { TaskType } from './google/vertexEmbedder';
export { GoogleVectorStore, sanitizeGitUrlForDataStoreId } from './google/googleVectorService';
export type { GoogleVectorServiceConfig } from './google/googleVectorConfig';
export {
	getGoogleVectorServiceConfig,
	GCLOUD_PROJECT,
	DISCOVERY_ENGINE_LOCATION,
	DISCOVERY_ENGINE_COLLECTION_ID,
	GCLOUD_REGION,
	DISCOVERY_ENGINE_DATA_STORE_ID,
	DISCOVERY_ENGINE_EMBEDDING_MODEL,
} from './google/googleVectorConfig';

// Original interfaces (legacy)
export type { VectorSearch, VectorIndex, VectorStore, SearchResult as LegacySearchResult } from './vector';

/**
 * Quick Start Example:
 *
 * ```typescript
 * import { VectorSearchOrchestrator, getGoogleVectorServiceConfig } from '@/swe/vector';
 *
 * // Create orchestrator
 * const orchestrator = new VectorSearchOrchestrator(
 *   getGoogleVectorServiceConfig()
 * );
 *
 * // Index repository
 * await orchestrator.indexRepository('/path/to/repo', {
 *   config: {
 *     dualEmbedding: true,
 *     contextualChunking: true
 *   }
 * });
 *
 * // Search
 * const results = await orchestrator.search('authentication logic');
 * ```
 *
 * Configuration Presets:
 *
 * Fast (Development):
 * ```json
 * {
 *   "dualEmbedding": false,
 *   "contextualChunking": false
 * }
 * ```
 *
 * Balanced (Production):
 * ```json
 * {
 *   "dualEmbedding": false,
 *   "contextualChunking": true
 * }
 * ```
 *
 * Maximum Quality:
 * ```json
 * {
 *   "dualEmbedding": true,
 *   "contextualChunking": true
 * }
 * ```
 */
