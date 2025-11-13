import crypto from 'node:crypto';
import pino from 'pino';
import type { VectorStoreConfig } from '../core/config';
import type { EmbeddedChunk, IVectorStore, SearchResult } from '../core/interfaces';
import { AlloyDBClient } from './alloydbClient';
import type { AlloyDBConfig } from './alloydbConfig';
import { buildAlloyDBConfig, getTableNameForRepo } from './alloydbConfig';

const logger = pino({ name: 'AlloyDBAdapter' });

/**
 * AlloyDB adapter implementing IVectorStore
 * Uses AlloyDB's automated vector indexing and ScaNN index in AUTO mode
 * Supports hybrid search (vector + full-text search)
 */
export class AlloyDBAdapter implements IVectorStore {
	private client: AlloyDBClient;
	private config: VectorStoreConfig;
	private alloydbConfig: AlloyDBConfig;
	private tableName: string;
	private repoIdentifier: string;

	constructor(repoIdentifier: string, alloydbConfig: AlloyDBConfig) {
		this.repoIdentifier = repoIdentifier;
		this.alloydbConfig = alloydbConfig;
		this.client = new AlloyDBClient(alloydbConfig);
		this.tableName = getTableNameForRepo(repoIdentifier);
		this.config = {
			dualEmbedding: false,
			contextualChunking: false,
		};
	}

	async initialize(config: VectorStoreConfig): Promise<void> {
		this.config = config;
		this.alloydbConfig = buildAlloyDBConfig(config);

		logger.info({ tableName: this.tableName, config: this.config }, 'Initializing AlloyDB adapter');

		// Connect to database
		await this.client.connect();

		// Check and install required extensions
		const extensions = await this.client.checkExtensions();
		logger.info({ extensions }, 'Checking extensions');

		if (!extensions.vector || !extensions.scann) {
			logger.info('Installing required extensions');
			await this.client.installExtensions();
		}

		// Create table if not exists
		await this.createTableIfNotExists();

		// Set up automated embeddings
		await this.setupAutomatedEmbeddings();

		// Enable columnar engine if configured
		if (this.alloydbConfig.enableColumnarEngine && extensions.columnarEngine) {
			await this.enableColumnarEngine();
		}

		logger.info({ tableName: this.tableName }, 'AlloyDB adapter initialized successfully');
	}

	/**
	 * Create table schema if it doesn't exist
	 */
	private async createTableIfNotExists(): Promise<void> {
		logger.info({ tableName: this.tableName }, 'Creating table if not exists');

		// Create table with all required columns
		await this.client.query(`
			CREATE TABLE IF NOT EXISTS ${this.tableName} (
				id TEXT PRIMARY KEY,
				name TEXT NOT NULL DEFAULT 'default',
				filename TEXT NOT NULL,
				line_from INTEGER NOT NULL,
				line_to INTEGER NOT NULL,
				original_text TEXT NOT NULL,
				contextualized_chunk TEXT NOT NULL,
				embedding VECTOR(768),              -- Manual embedding (Vertex AI) or auto-embedding
				code_embedding VECTOR(768),         -- Dual embedding (code representation)
				language TEXT,
				chunk_type TEXT,
				function_name TEXT,
				class_name TEXT,
				metadata JSONB,
				full_text_search TSVECTOR,
				created_at TIMESTAMP DEFAULT NOW(),
				updated_at TIMESTAMP DEFAULT NOW()
			)
		`);

		// Create indexes
		await this.createIndexes();

		logger.info({ tableName: this.tableName }, 'Table created successfully');
	}

	/**
	 * Create indexes for the table
	 */
	private async createIndexes(): Promise<void> {
		logger.info({ tableName: this.tableName }, 'Creating indexes');

		// Check if the table has enough data for ScaNN index
		const countResult = await this.client.query(`SELECT COUNT(*) FROM ${this.tableName}`);
		const rowCount = Number.parseInt(countResult.rows[0].count);

		// ScaNN index requires some data to be created effectively
		// We'll create it in AUTO mode which will handle this automatically
		if (rowCount > 0) {
			// Create ScaNN index in AUTO mode with AH quantizer for columnar engine optimization
			// Index the 'embedding' column which contains either manual or auto-generated embeddings
			try {
				await this.client.query(`
					CREATE INDEX IF NOT EXISTS idx_${this.tableName}_vector
					ON ${this.tableName}
					USING scann (embedding cosine)
					WITH (mode='AUTO', quantizer='AH')
				`);
				logger.info('ScaNN vector index created in AUTO mode on embedding column');
			} catch (error) {
				logger.warn({ error }, 'Failed to create ScaNN index (will retry after data is added)');
			}
		} else {
			logger.info('Table is empty, will create ScaNN index after data is added');
		}

		// Create full-text search index for hybrid search
		await this.client.query(`
			CREATE INDEX IF NOT EXISTS idx_${this.tableName}_fts
			ON ${this.tableName}
			USING GIN (full_text_search)
		`);

		// Create index on name for multi-config filtering
		await this.client.query(`
			CREATE INDEX IF NOT EXISTS idx_${this.tableName}_name
			ON ${this.tableName}(name)
		`);

		// Create index on filename for deleteByFilePath operations
		await this.client.query(`
			CREATE INDEX IF NOT EXISTS idx_${this.tableName}_filename
			ON ${this.tableName}(filename)
		`);

		logger.info('Indexes created successfully');
	}

	/**
	 * Set up automated embeddings using AlloyDB AI
	 * Note: This is a preview feature and may not be available in AlloyDB Omni (Docker)
	 */
	private async setupAutomatedEmbeddings(): Promise<void> {
		const hasAutomatedEmbeddings = await this.client.checkAutomatedEmbeddings();

		if (!hasAutomatedEmbeddings) {
			logger.warn(
				'Automated embeddings (ai.initialize_embeddings) not available on this AlloyDB instance. ' +
					'This is expected for AlloyDB Omni (Docker). ' +
					'Will use manual embedding via Vertex AI instead.',
			);
			return;
		}

		logger.info('Setting up automated embeddings (preview feature)');

		try {
			// Initialize automated embeddings
			// Reads from 'contextualized_chunk' and stores embedding in 'embedding' column
			await this.client.query(
				`
				CALL ai.initialize_embeddings(
					model_id => $1,
					table_name => $2,
					content_column => 'contextualized_chunk',
					embedding_column => 'embedding',
					incremental_refresh_mode => 'transactional'
				)
			`,
				[this.alloydbConfig.embeddingModel, this.tableName],
			);

			logger.info('Automated embeddings initialized successfully - AlloyDB will manage embedding column');
		} catch (error) {
			logger.warn({ error }, 'Failed to initialize automated embeddings (may already be initialized or not supported)');
		}
	}

	/**
	 * Enable columnar engine for better filtered vector search performance
	 */
	private async enableColumnarEngine(): Promise<void> {
		try {
			await this.client.query('SELECT google_columnar_engine_add($1)', [this.tableName]);
			logger.info('Columnar engine enabled for table');
		} catch (error) {
			logger.warn({ error }, 'Failed to enable columnar engine');
		}
	}

	/**
	 * Generate document ID from chunk
	 */
	private generateDocumentId(chunk: EmbeddedChunk): string {
		const key = `${chunk.filePath}:${chunk.chunk.sourceLocation.startLine}:${chunk.chunk.sourceLocation.endLine}`;
		return Buffer.from(key).toString('base64url');
	}

	async indexChunks(chunks: EmbeddedChunk[]): Promise<void> {
		if (chunks.length === 0) {
			logger.debug('No chunks to index');
			return;
		}

		logger.info({ chunkCount: chunks.length, tableName: this.tableName }, 'Indexing chunks');

		const configName = this.config.name || 'default';

		// Batch insert chunks
		const BATCH_SIZE = 100;
		for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
			const batch = chunks.slice(i, i + BATCH_SIZE);

			// Build values array for batch insert
			const values: any[] = [];
			const placeholders: string[] = [];

			for (let j = 0; j < batch.length; j++) {
				const chunk = batch[j];
				const id = this.generateDocumentId(chunk);

				// Get contextualized content
				const contextualizedContent = 'contextualizedContent' in chunk.chunk ? chunk.chunk.contextualizedContent : chunk.chunk.content;

				// Extract metadata
				const functionName = chunk.chunk.metadata?.functionName;
				const className = chunk.chunk.metadata?.className;

				const baseIndex = j * 13;
				placeholders.push(
					`($${baseIndex + 1}, $${baseIndex + 2}, $${baseIndex + 3}, $${baseIndex + 4}, $${baseIndex + 5},
					  $${baseIndex + 6}, $${baseIndex + 7}, $${baseIndex + 8}, $${baseIndex + 9}, $${baseIndex + 10},
					  $${baseIndex + 11}, $${baseIndex + 12}, $${baseIndex + 13})`,
				);

				// Store manual embedding if provided (for when auto-embedding is unavailable)
				const manualEmbedding = chunk.embedding && chunk.embedding.length > 0 ? JSON.stringify(chunk.embedding) : null;

				values.push(
					id,
					configName,
					chunk.filePath,
					chunk.chunk.sourceLocation.startLine,
					chunk.chunk.sourceLocation.endLine,
					chunk.chunk.content, // original_text
					contextualizedContent, // contextualized_chunk
					manualEmbedding, // primary embedding (if auto-embedding unavailable)
					chunk.secondaryEmbedding ? JSON.stringify(chunk.secondaryEmbedding) : null, // code_embedding
					chunk.language,
					chunk.chunk.chunkType,
					functionName,
					className,
				);
			}

			// Upsert chunks (insert or update if exists)
			await this.client.query(
				`
				INSERT INTO ${this.tableName}
					(id, name, filename, line_from, line_to, original_text, contextualized_chunk,
					 embedding, code_embedding, language, chunk_type, function_name, class_name)
				VALUES ${placeholders.join(', ')}
				ON CONFLICT (id) DO UPDATE SET
					name = EXCLUDED.name,
					filename = EXCLUDED.filename,
					line_from = EXCLUDED.line_from,
					line_to = EXCLUDED.line_to,
					original_text = EXCLUDED.original_text,
					contextualized_chunk = EXCLUDED.contextualized_chunk,
					embedding = EXCLUDED.embedding,
					code_embedding = EXCLUDED.code_embedding,
					language = EXCLUDED.language,
					chunk_type = EXCLUDED.chunk_type,
					function_name = EXCLUDED.function_name,
					class_name = EXCLUDED.class_name,
					updated_at = NOW()
			`,
				values,
			);

			// Update full-text search vectors
			await this.client.query(
				`
				UPDATE ${this.tableName}
				SET full_text_search = to_tsvector('english', original_text)
				WHERE id = ANY($1)
			`,
				[batch.map((chunk) => this.generateDocumentId(chunk))],
			);

			logger.debug({ processed: i + batch.length, total: chunks.length }, 'Indexed batch');
		}

		// Ensure ScaNN index exists after adding data
		try {
			await this.client.query(`
				CREATE INDEX IF NOT EXISTS idx_${this.tableName}_vector
				ON ${this.tableName}
				USING scann (embedding cosine)
				WITH (mode='AUTO', quantizer='AH')
			`);
		} catch (error) {
			logger.warn({ error }, 'ScaNN index may already exist or data insufficient');
		}

		// Trigger refresh of automated embeddings (optional - transactional mode should auto-update)
		// Only if automated embeddings are enabled
		try {
			await this.client.query(
				`
				CALL ai.refresh_embeddings(
					table_name => $1,
					embedding_column => 'embedding',
					batch_size => 50
				)
			`,
				[this.tableName],
			);
			logger.debug('Triggered automated embedding refresh');
		} catch (error) {
			logger.debug({ error }, 'Could not trigger embedding refresh (automated embeddings may not be enabled)');
		}

		logger.info({ chunkCount: chunks.length }, 'Successfully indexed all chunks');
	}

	async deleteByFilePath(filePath: string): Promise<void> {
		const configName = this.config.name || 'default';
		logger.info({ filePath, configName, tableName: this.tableName }, 'Deleting chunks by file path');

		const result = await this.client.query(`DELETE FROM ${this.tableName} WHERE filename = $1 AND name = $2`, [filePath, configName]);

		logger.info({ deletedCount: result.rowCount }, 'Deleted chunks');
	}

	async search(query: string, queryEmbedding: number[], maxResults: number, config: VectorStoreConfig): Promise<SearchResult[]> {
		const configName = config.name || 'default';
		logger.debug({ query, maxResults, configName, hybridSearch: config.hybridSearch }, 'Searching');

		if (config.hybridSearch) {
			return this.hybridSearch(query, maxResults, configName);
		}

		return this.vectorSearch(query, maxResults, configName);
	}

	/**
	 * Pure vector search using ScaNN index
	 */
	private async vectorSearch(query: string, maxResults: number, configName: string): Promise<SearchResult[]> {
		const result = await this.client.query(
			`
			SELECT
				id,
				filename,
				line_from,
				line_to,
				original_text,
				language,
				chunk_type,
				function_name,
				class_name,
				embedding <=> google_ml.embedding($1, $2)::vector AS distance
			FROM ${this.tableName}
			WHERE name = $3
			ORDER BY distance
			LIMIT $4
		`,
			[this.alloydbConfig.embeddingModel, query, configName, maxResults],
		);

		return result.rows.map((row) => this.convertRowToSearchResult(row, 1 - row.distance));
	}

	/**
	 * Hybrid search combining vector search + full-text search using RRF
	 */
	private async hybridSearch(query: string, maxResults: number, configName: string): Promise<SearchResult[]> {
		const vectorWeight = this.alloydbConfig.vectorWeight ?? 0.7;
		const textWeight = 1 - vectorWeight;

		logger.debug({ vectorWeight, textWeight }, 'Performing hybrid search');

		// Get candidates from both vector and text search (get more for RRF)
		const candidateLimit = maxResults * 2;

		const result = await this.client.query(
			`
			WITH vector_results AS (
				SELECT
					id,
					filename,
					line_from,
					line_to,
					original_text,
					language,
					chunk_type,
					function_name,
					class_name,
					embedding <=> google_ml.embedding($1, $2)::vector AS distance,
					ROW_NUMBER() OVER (ORDER BY embedding <=> google_ml.embedding($1, $2)::vector) AS vector_rank
				FROM ${this.tableName}
				WHERE name = $3
				ORDER BY distance
				LIMIT $4
			),
			text_results AS (
				SELECT
					id,
					ts_rank(full_text_search, plainto_tsquery('english', $2)) AS text_rank,
					ROW_NUMBER() OVER (ORDER BY ts_rank(full_text_search, plainto_tsquery('english', $2)) DESC) AS text_rank_order
				FROM ${this.tableName}
				WHERE name = $3
					AND full_text_search @@ plainto_tsquery('english', $2)
				LIMIT $4
			),
			combined AS (
				SELECT
					v.id,
					v.filename,
					v.line_from,
					v.line_to,
					v.original_text,
					v.language,
					v.chunk_type,
					v.function_name,
					v.class_name,
					v.distance,
					v.vector_rank,
					COALESCE(t.text_rank_order, 999999) AS text_rank,
					-- Reciprocal Rank Fusion (RRF) score
					($5 / (60.0 + v.vector_rank)) + ($6 / (60.0 + COALESCE(t.text_rank_order, 999999))) AS rrf_score
				FROM vector_results v
				LEFT JOIN text_results t ON v.id = t.id

				UNION

				SELECT
					t2.id,
					v2.filename,
					v2.line_from,
					v2.line_to,
					v2.original_text,
					v2.language,
					v2.chunk_type,
					v2.function_name,
					v2.class_name,
					v2.distance,
					COALESCE(v2.vector_rank, 999999) AS vector_rank,
					t2.text_rank_order AS text_rank,
					($5 / (60.0 + COALESCE(v2.vector_rank, 999999))) + ($6 / (60.0 + t2.text_rank_order)) AS rrf_score
				FROM text_results t2
				LEFT JOIN vector_results v2 ON t2.id = v2.id
				WHERE v2.id IS NULL
			)
			SELECT * FROM combined
			ORDER BY rrf_score DESC
			LIMIT $7
		`,
			[this.alloydbConfig.embeddingModel, query, configName, candidateLimit, vectorWeight, textWeight, maxResults],
		);

		return result.rows.map((row) => this.convertRowToSearchResult(row, row.rrf_score));
	}

	/**
	 * Convert database row to SearchResult
	 */
	private convertRowToSearchResult(row: any, score: number): SearchResult {
		return {
			id: row.id,
			score: score,
			document: {
				filePath: row.filename,
				functionName: row.function_name,
				className: row.class_name,
				startLine: row.line_from,
				endLine: row.line_to,
				language: row.language,
				originalCode: row.original_text,
			},
			metadata: {
				distance: row.distance,
				vectorRank: row.vector_rank,
				textRank: row.text_rank,
			},
		};
	}

	async purge(): Promise<void> {
		const configName = this.config.name || 'default';
		logger.warn({ configName, tableName: this.tableName }, 'Purging all documents');

		const result = await this.client.query(`DELETE FROM ${this.tableName} WHERE name = $1`, [configName]);

		logger.info({ deletedCount: result.rowCount }, 'Successfully purged documents');
	}

	async getStats(): Promise<{
		totalDocuments: number;
		totalChunks: number;
		storageSize?: number;
	}> {
		const configName = this.config.name || 'default';

		// Get document count
		const countResult = await this.client.query(`SELECT COUNT(*) FROM ${this.tableName} WHERE name = $1`, [configName]);

		// Get table size
		const sizeResult = await this.client.query('SELECT pg_total_relation_size($1) AS size', [this.tableName]);

		return {
			totalDocuments: Number.parseInt(countResult.rows[0].count),
			totalChunks: Number.parseInt(countResult.rows[0].count),
			storageSize: Number.parseInt(sizeResult.rows[0].size),
		};
	}

	/**
	 * Close connection
	 */
	async close(): Promise<void> {
		await this.client.disconnect();
	}
}
