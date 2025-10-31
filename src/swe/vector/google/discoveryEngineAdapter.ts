import { google } from '@google-cloud/discoveryengine/build/protos/protos';
import { struct } from 'pb-util';
import pino from 'pino';
import { VectorStoreConfig } from '../core/config';
import { EmbeddedChunk, IVectorStore, SearchResult } from '../core/interfaces';
import { DiscoveryEngine } from './discoveryEngine';
import { GoogleVectorServiceConfig } from './googleVectorConfig';

const logger = pino({ name: 'DiscoveryEngineAdapter' });

/**
 * Google Discovery Engine adapter implementing IVectorStore
 * Supports dual embeddings (code + natural language)
 * Uses Discovery Engine's native vector search capabilities
 */
export class DiscoveryEngineAdapter implements IVectorStore {
	private engine: DiscoveryEngine;
	private config: VectorStoreConfig;

	constructor(googleConfig: GoogleVectorServiceConfig) {
		this.engine = new DiscoveryEngine(googleConfig);
		this.config = {
			dualEmbedding: false,
			contextualChunking: false,
		};
	}

	async initialize(config: VectorStoreConfig): Promise<void> {
		this.config = config;
		await this.engine.ensureDataStoreExists();
		logger.info({ config: this.config }, 'Discovery Engine adapter initialized');
	}

	async indexChunks(chunks: EmbeddedChunk[]): Promise<void> {
		if (chunks.length === 0) {
			logger.debug('No chunks to index');
			return;
		}

		logger.info({ chunkCount: chunks.length, dualEmbedding: this.config.dualEmbedding }, 'Indexing chunks');

		// Convert chunks to Discovery Engine documents
		const documents = chunks.map((chunk) => this.convertChunkToDocument(chunk));

		// Import documents in batches
		const BATCH_SIZE = 100;
		for (let i = 0; i < documents.length; i += BATCH_SIZE) {
			const batch = documents.slice(i, i + BATCH_SIZE);
			await this.engine.importDocuments(batch);
			logger.debug({ processed: i + batch.length, total: documents.length }, 'Imported batch');
		}

		logger.info({ chunkCount: chunks.length }, 'Successfully indexed all chunks');
	}

	async deleteByFilePath(filePath: string): Promise<void> {
		logger.info({ filePath }, 'Deleting documents by file path');
		await this.engine.purgeDocuments([filePath]);
	}

	async search(query: string, queryEmbedding: number[], maxResults: number, config: VectorStoreConfig): Promise<SearchResult[]> {
		logger.debug({ query, maxResults, dualEmbedding: config.dualEmbedding }, 'Searching');

		const servingConfigPath = this.engine.getServingConfigPath();

		// Build search request
		const searchRequest: google.cloud.discoveryengine.v1.ISearchRequest = {
			servingConfig: servingConfigPath,
			query: query,
			pageSize: maxResults,
			queryExpansionSpec: {
				condition: google.cloud.discoveryengine.v1.SearchRequest.QueryExpansionSpec.Condition.AUTO,
			},
			spellCorrectionSpec: {
				mode: google.cloud.discoveryengine.v1.SearchRequest.SpellCorrectionSpec.Mode.AUTO,
			},
		};

		// If dual embedding is enabled and we have a query embedding, use it
		// Discovery Engine supports hybrid search (vector + text) natively
		if (config.dualEmbedding && queryEmbedding && queryEmbedding.length > 0) {
			// TODO: Add vector search parameters when available in Discovery Engine API
			// Currently, Discovery Engine automatically uses embeddings if they're present in the documents
			logger.debug('Using hybrid search (text + vector)');
		}

		const results = await this.engine.search(searchRequest);

		// Convert Discovery Engine results to SearchResult format
		return this.convertSearchResults(results);
	}

	async purge(): Promise<void> {
		logger.warn('Purging all documents from Discovery Engine');
		await this.engine.purgeAllDocuments();
		logger.info('Successfully purged all documents');
	}

	async getStats(): Promise<{
		totalDocuments: number;
		totalChunks: number;
		storageSize?: number;
	}> {
		// Discovery Engine doesn't expose stats directly
		// This would require a separate tracking mechanism
		logger.debug('Stats not available from Discovery Engine API');
		return {
			totalDocuments: 0,
			totalChunks: 0,
		};
	}

	/**
	 * Convert EmbeddedChunk to Discovery Engine document format
	 */
	private convertChunkToDocument(chunk: EmbeddedChunk): google.cloud.discoveryengine.v1.IDocument {
		const docId = this.generateDocumentId(chunk);

		// Determine the searchable text content (contextualized if available, otherwise original)
		const searchableText = 'contextualizedContent' in chunk.chunk ? chunk.chunk.contextualizedContent : chunk.chunk.content;

		// Build struct data object
		const structData: Record<string, any> = {
			filePath: chunk.filePath,
			language: chunk.language,
			originalCode: chunk.chunk.content,
			startLine: chunk.chunk.sourceLocation.startLine,
			endLine: chunk.chunk.sourceLocation.endLine,
			chunkType: chunk.chunk.chunkType,
			// CRITICAL: Discovery Engine requires lexical_search_text field for text search
			lexical_search_text: searchableText,
		};

		// Add natural language description if dual embedding is enabled
		if (this.config.dualEmbedding && chunk.naturalLanguageDescription) {
			structData.naturalLanguageDescription = chunk.naturalLanguageDescription;
		}

		// Add context if available (from ContextualizedChunk)
		if ('context' in chunk.chunk && chunk.chunk.context) {
			structData.context = chunk.chunk.context;
		}

		// Add embeddings
		// Primary embedding (code or natural language depending on dual embedding config)
		if (chunk.embedding && chunk.embedding.length > 0) {
			structData.embedding = chunk.embedding;
		}

		// Secondary embedding (code embedding when dual embedding is enabled)
		if (this.config.dualEmbedding && chunk.secondaryEmbedding && chunk.secondaryEmbedding.length > 0) {
			structData.codeEmbedding = chunk.secondaryEmbedding;
		}

		// Extract function/class name if available from metadata
		if (chunk.chunk.metadata) {
			if (chunk.chunk.metadata.functionName) {
				structData.functionName = chunk.chunk.metadata.functionName;
			}
			if (chunk.chunk.metadata.className) {
				structData.className = chunk.chunk.metadata.className;
			}
		}

		// Base document structure
		const document: google.cloud.discoveryengine.v1.IDocument = {
			id: docId,
			structData: struct.encode(structData),
		};

		return document;
	}

	/**
	 * Generate unique document ID for a chunk
	 */
	private generateDocumentId(chunk: EmbeddedChunk): string {
		// Use file path + start line as unique identifier
		const sanitized = chunk.filePath.replace(/[^a-zA-Z0-9_-]/g, '_');
		return `${sanitized}_${chunk.chunk.sourceLocation.startLine}_${chunk.chunk.sourceLocation.endLine}`;
	}

	/**
	 * Convert Discovery Engine search results to SearchResult format
	 */
	private convertSearchResults(results: google.cloud.discoveryengine.v1.SearchResponse.ISearchResult[]): SearchResult[] {
		const converted: SearchResult[] = [];

		for (const result of results) {
			if (!result.document?.structData?.fields) {
				continue;
			}

			const fields = result.document.structData.fields;

			// Helper to safely extract string values from Struct fields
			const getString = (fieldName: string): string | undefined => fields[fieldName]?.stringValue ?? undefined;

			// Helper to safely extract number values
			const getNumber = (fieldName: string): number | undefined => fields[fieldName]?.numberValue ?? undefined;

			converted.push({
				id: result.document.id || 'unknown',
				score: 1.0, // Discovery Engine doesn't expose relevance scores directly
				document: {
					filePath: getString('filePath') ?? 'unknown',
					functionName: getString('functionName'),
					className: getString('className'),
					startLine: getNumber('startLine') ?? 0,
					endLine: getNumber('endLine') ?? 0,
					language: getString('language') ?? 'unknown',
					naturalLanguageDescription: getString('naturalLanguageDescription'),
					originalCode: getString('originalCode') ?? '',
					context: getString('context'),
				},
			});
		}

		return converted;
	}

	/**
	 * Delete data store (cleanup)
	 */
	async deleteDataStore(): Promise<void> {
		await this.engine.deleteDataStore();
	}

	/**
	 * DIAGNOSTIC: List all documents in the data store
	 */
	async listDocuments(pageSize = 100): Promise<any[]> {
		return await this.engine.listDocuments(pageSize);
	}

	/**
	 * DIAGNOSTIC: Get a specific document by ID
	 */
	async getDocument(documentId: string): Promise<any> {
		return await this.engine.getDocument(documentId);
	}

	/**
	 * DIAGNOSTIC: Get data store info
	 */
	async getDataStoreInfo(): Promise<any> {
		return await this.engine.getDataStoreInfo();
	}
}
