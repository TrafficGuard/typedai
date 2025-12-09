import { ChromaClient, type Collection, IncludeEnum } from 'chromadb';
import pino from 'pino';
import type { VectorStoreConfig } from '../core/config';
import type { EmbeddedChunk, IVectorStore, SearchResult } from '../core/interfaces';
import type { ChromaConfig } from './chromaConfig';
import { getCollectionNameForRepo } from './chromaConfig';

const logger = pino({ name: 'ChromaAdapter' });

/**
 * ChromaDB adapter implementing IVectorStore
 * Uses ChromaDB for local vector storage with hybrid search support
 */
export class ChromaAdapter implements IVectorStore {
	private client: ChromaClient;
	private collection: Collection | null = null;
	private config: VectorStoreConfig;
	private chromaConfig: ChromaConfig;
	private collectionName: string;
	private repoIdentifier: string;

	constructor(repoIdentifier: string, chromaConfig: ChromaConfig) {
		this.repoIdentifier = repoIdentifier;
		this.chromaConfig = chromaConfig;
		this.collectionName = getCollectionNameForRepo(repoIdentifier, chromaConfig.collectionPrefix);
		this.config = {
			chunking: {
				dualEmbedding: false,
				contextualChunking: false,
			},
		};

		// Initialize ChromaDB client
		this.client = new ChromaClient({
			path: chromaConfig.url,
			auth: chromaConfig.authToken
				? {
						provider: 'token',
						credentials: chromaConfig.authToken,
					}
				: undefined,
			tenant: chromaConfig.tenant,
			database: chromaConfig.database,
		});
	}

	async initialize(config: VectorStoreConfig): Promise<void> {
		this.config = config;

		logger.info({ collectionName: this.collectionName, config: this.config }, 'Initializing ChromaDB adapter');

		try {
			// Get or create collection with appropriate distance function
			const metadata: Record<string, string> = {
				'hnsw:space': this.chromaConfig.distanceFunction || 'cosine',
			};

			this.collection = await this.client.getOrCreateCollection({
				name: this.collectionName,
				metadata,
			});

			logger.info({ collectionName: this.collectionName }, 'ChromaDB adapter initialized successfully');
		} catch (error) {
			logger.error({ error, collectionName: this.collectionName }, 'Failed to initialize ChromaDB collection');
			throw error;
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

		if (!this.collection) {
			throw new Error('ChromaDB collection not initialized. Call initialize() first.');
		}

		logger.info({ chunkCount: chunks.length, collectionName: this.collectionName }, 'Indexing chunks');

		const configName = this.config.name || 'default';

		// ChromaDB supports batch operations, but has a recommended limit
		const BATCH_SIZE = 100;
		for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
			const batch = chunks.slice(i, i + BATCH_SIZE);

			const ids: string[] = [];
			const embeddings: number[][] = [];
			const documents: string[] = [];
			const metadatas: Record<string, any>[] = [];

			for (const chunk of batch) {
				const id = this.generateDocumentId(chunk);

				// Get contextualized content
				const contextualizedContent = 'contextualizedContent' in chunk.chunk ? chunk.chunk.contextualizedContent : chunk.chunk.content;

				// Extract metadata
				const functionName = chunk.chunk.metadata?.functionName;
				const className = chunk.chunk.metadata?.className;

				ids.push(id);
				embeddings.push(chunk.embedding);
				documents.push(contextualizedContent); // Store text for hybrid search
				metadatas.push({
					config_name: configName,
					filename: chunk.filePath,
					line_from: chunk.chunk.sourceLocation.startLine,
					line_to: chunk.chunk.sourceLocation.endLine,
					original_text: chunk.chunk.content,
					language: chunk.language,
					chunk_type: chunk.chunk.chunkType,
					function_name: functionName || '',
					class_name: className || '',
					natural_language_description: chunk.naturalLanguageDescription || '',
				});
			}

			// Upsert chunks (ChromaDB handles duplicates by ID)
			await this.collection.upsert({
				ids,
				embeddings,
				documents,
				metadatas,
			});

			logger.debug({ processed: i + batch.length, total: chunks.length }, 'Indexed batch');
		}

		logger.info({ chunkCount: chunks.length }, 'Successfully indexed all chunks');
	}

	async deleteByFilePath(filePath: string): Promise<number> {
		if (!this.collection) {
			throw new Error('ChromaDB collection not initialized. Call initialize() first.');
		}

		const configName = this.config.name || 'default';
		logger.info({ filePath, configName, collectionName: this.collectionName }, 'Deleting chunks by file path');

		try {
			// First count matching documents
			const existing = await this.collection.get({
				where: {
					$and: [{ filename: { $eq: filePath } }, { config_name: { $eq: configName } }],
				},
			});
			const count = existing.ids?.length || 0;

			if (count > 0) {
				// ChromaDB uses where clause for filtering deletes
				await this.collection.delete({
					where: {
						$and: [{ filename: { $eq: filePath } }, { config_name: { $eq: configName } }],
					},
				});
				logger.info({ filePath, deletedCount: count }, 'Deleted chunks');
			} else {
				logger.info({ filePath }, 'No chunks found to delete');
			}

			return count;
		} catch (error) {
			logger.error({ error, filePath }, 'Failed to delete chunks');
			throw error;
		}
	}

	async search(query: string, queryEmbedding: number[], maxResults: number, config: VectorStoreConfig): Promise<SearchResult[]> {
		if (!this.collection) {
			throw new Error('ChromaDB collection not initialized. Call initialize() first.');
		}

		const configName = config.name || 'default';
		const useHybridSearch = config.search?.hybridSearch ?? true;
		logger.debug({ query, maxResults, configName, hybridSearch: useHybridSearch }, 'Searching');

		try {
			// ChromaDB query with embedding
			const results = await this.collection.query({
				queryEmbeddings: [queryEmbedding],
				nResults: maxResults,
				where: { config_name: { $eq: configName } },
				include: [IncludeEnum.metadatas, IncludeEnum.documents, IncludeEnum.distances],
			});

			if (!results.ids[0] || results.ids[0].length === 0) {
				return [];
			}

			// Convert ChromaDB results to SearchResult format
			return results.ids[0].map((id, index) => {
				const metadata = results.metadatas?.[0]?.[index] || {};
				const distance = results.distances?.[0]?.[index] || 0;

				// Convert distance to similarity score (0-1, higher is better)
				// For cosine distance: similarity = 1 - distance
				// For L2 distance: similarity = 1 / (1 + distance)
				let score: number;
				if (this.chromaConfig.distanceFunction === 'l2') {
					score = 1 / (1 + distance);
				} else {
					// cosine or ip
					score = 1 - distance;
				}

				return {
					id: id,
					score: score,
					document: {
						filePath: String(metadata.filename || ''),
						functionName: metadata.function_name ? String(metadata.function_name) : undefined,
						className: metadata.class_name ? String(metadata.class_name) : undefined,
						startLine: Number(metadata.line_from) || 0,
						endLine: Number(metadata.line_to) || 0,
						language: String(metadata.language || 'unknown'),
						originalCode: String(metadata.original_text || ''),
						naturalLanguageDescription: metadata.natural_language_description ? String(metadata.natural_language_description) : undefined,
					},
					metadata: {
						distance: distance,
						chunkType: metadata.chunk_type,
					},
				};
			});
		} catch (error) {
			logger.error({ error, query }, 'Search failed');
			throw error;
		}
	}

	async purge(): Promise<void> {
		if (!this.collection) {
			throw new Error('ChromaDB collection not initialized. Call initialize() first.');
		}

		const configName = this.config.name || 'default';
		logger.warn({ configName, collectionName: this.collectionName }, 'Purging all documents');

		try {
			// Delete all documents with matching config name
			// Get all IDs first, then delete
			const allDocs = await this.collection.get({
				where: { config_name: { $eq: configName } },
			});

			if (allDocs.ids.length > 0) {
				await this.collection.delete({
					ids: allDocs.ids,
				});
			}

			logger.info({ deletedCount: allDocs.ids.length }, 'Successfully purged documents');
		} catch (error) {
			logger.error({ error }, 'Failed to purge documents');
			throw error;
		}
	}

	async getStats(): Promise<{
		totalDocuments: number;
		totalChunks: number;
		storageSize?: number;
	}> {
		if (!this.collection) {
			throw new Error('ChromaDB collection not initialized. Call initialize() first.');
		}

		const configName = this.config.name || 'default';

		try {
			// Get count of documents with matching config
			const result = await this.collection.count();

			return {
				totalDocuments: result,
				totalChunks: result,
				// ChromaDB doesn't expose storage size directly
			};
		} catch (error) {
			logger.error({ error }, 'Failed to get stats');
			throw error;
		}
	}

	/**
	 * Check if the ChromaDB server is available
	 */
	async isAvailable(): Promise<boolean> {
		try {
			await this.client.heartbeat();
			return true;
		} catch {
			return false;
		}
	}

	/**
	 * Delete the entire collection
	 */
	async deleteCollection(): Promise<void> {
		try {
			await this.client.deleteCollection({ name: this.collectionName });
			this.collection = null;
			logger.info({ collectionName: this.collectionName }, 'Collection deleted');
		} catch (error) {
			logger.error({ error, collectionName: this.collectionName }, 'Failed to delete collection');
			throw error;
		}
	}
}
