import { google } from '@google-cloud/discoveryengine/build/protos/protos';
import { struct } from 'pb-util';
import pino from 'pino';
import { settleAllWithInput } from '#utils/async-utils';
import { ChunkSearchResult, ChunkWithFileContext, ContextualizedChunkItem } from '../chunking/chunkTypes';
import { generateContextualizedChunks } from '../chunking/contextualizedChunker';
import { CodeFile, readFilesToIndex } from '../codeLoader';
import { SearchResult, VectorStore } from '../vector';
import { DiscoveryEngine } from './discoveryEngine';
import { GoogleVectorServiceConfig } from './googleVectorConfig';
import { TextEmbeddingService, VertexAITextEmbeddingService } from './vertexEmbedder';
import { span } from '#o11y/trace';
import pLimit from 'p-limit';

const logger = pino({ name: 'GoogleVectorStore' });

const BATCH_SIZE = 100; // Max documents per ImportDocuments request

const FILE_PROCESSING_PARALLEL_BATCH_SIZE = 5;
const INDEXER_EMBEDDING_PROCESSING_BATCH_SIZE = 100;

class IndexingStats {
	fileCount: number = 0;
	failedFiles: string[] = [];
	failedChunksCount: number = 0;
}

export class GoogleVectorStore implements VectorStore {
	private dataStore: DiscoveryEngine;
	private embeddingService: TextEmbeddingService;

	constructor(private config: GoogleVectorServiceConfig) {
		this.dataStore = new DiscoveryEngine(config);
		this.embeddingService = new VertexAITextEmbeddingService(config);
	}

	@span()
	async indexRepository(dir = './'): Promise<void> {
		logger.info(`Starting indexing pipeline for directory: ${dir}`);
		const codeFiles = await readFilesToIndex(dir);
		logger.info(`Loaded ${codeFiles.length} code files.`);

		if (codeFiles.length === 0) return;
		
		await this.indexFiles(codeFiles);
	}

	private async indexFiles(codeFiles: CodeFile[], stats = new IndexingStats()): Promise<void> {
		await this.dataStore.ensureDataStoreExists();
		stats.fileCount = codeFiles.length;
	
		// Before indexing new content, purge all documents associated with the files being re-indexed.
		await this.dataStore.purgeDocuments(codeFiles.map((file) => file.filePath));
	
		// Use p-limit to control the concurrency of file processing for chunk generation.
		const limit = pLimit(FILE_PROCESSING_PARALLEL_BATCH_SIZE);
	
		logger.info(`Generating chunks for ${codeFiles.length} files with a concurrency of ${FILE_PROCESSING_PARALLEL_BATCH_SIZE}...`);
	
		// Create a promise for each file's chunk generation, wrapped in the limiter.
		const chunkGenerationPromises = codeFiles.map((file) =>
			limit(() =>
				this._processFileAndGetContextualizedChunks(file).catch((e) => {
					stats.failedFiles.push(file.filePath);
					logger.error({ err: e, filePath: file.filePath }, `File failed during chunk generation.`);
					return []; // Return an empty array on failure to not break Promise.all
				}),
			),
		);
	
		// Wait for all chunk generation promises to resolve.
		const nestedChunks = await Promise.all(chunkGenerationPromises);
		const allChunks = nestedChunks.flat();
	
		logger.info(`Completed chunk generation. Total chunks: ${allChunks.length}.`);
	
		if (allChunks.length === 0) {
			logger.warn('No chunks were generated from any of the files. Indexing will stop.');
			return;
		}
	
		// Pass all generated chunks to the embedding and storage stages.
		// These stages have their own internal batching.
		const documents = await this._generateEmbeddingsAndPrepareDocuments(allChunks, stats);
	
		if (documents.length > 0) {
			await this.storeDocuments(documents);
		}
	
		logger.info(
			`Indexing pipeline completed. Successfully prepared ${documents.length} chunks from ${
				codeFiles.length - stats.failedFiles.length
			} files for indexing. Failed to process ${stats.failedFiles.length} files and ${stats.failedChunksCount} chunks.`,
		);
	}


	private async _generateEmbeddingsAndPrepareDocuments(
		allChunks: ChunkWithFileContext[], stats: IndexingStats
		): Promise<google.cloud.discoveryengine.v1beta.IDocument[]> {
		const documentsToIndex: google.cloud.discoveryengine.v1beta.IDocument[] = [];
		let failedChunksCount = 0;
		let successfullyEmbeddedChunks = 0;

		for (let i = 0; i < allChunks.length; i += INDEXER_EMBEDDING_PROCESSING_BATCH_SIZE) {
			const chunkBatch = allChunks.slice(i, i + INDEXER_EMBEDDING_PROCESSING_BATCH_SIZE);

			const successfullyEmbeddedInBatch = await this._processAndIndexEmbeddingBatch(chunkBatch, documentsToIndex, stats);
			successfullyEmbeddedChunks += successfullyEmbeddedInBatch;
		}

		logger.info(`Successfully generated embeddings for ${successfullyEmbeddedChunks} of ${allChunks.length} chunks.`);
		return documentsToIndex;
	}

	private async storeDocuments(documents: google.cloud.discoveryengine.v1beta.IDocument[]): Promise<void> {
		for (let i = 0; i < documents.length; i += BATCH_SIZE) {
			const batch = documents.slice(i, i + BATCH_SIZE);
			logger.info(`Indexing batch of ${batch.length} documents to Discovery Engine...`);
			await this.dataStore.importDocuments(batch);
		}
		logger.info(`Completed import of ${documents.length} documents.`);
	}

	private async _processFileAndGetContextualizedChunks(file: CodeFile): Promise<ChunkWithFileContext[]> {
		try {
			const contextualizedItems = await generateContextualizedChunks(file.filePath, file.content, file.language);
			return contextualizedItems.map((item) => ({
				...item,
				filePath: file.filePath,
				language: file.language,
			}));
		} catch (fileProcessingError: any) {
			logger.error(
				{ err: { message: fileProcessingError.message, stack: fileProcessingError.stack }, filePath: file.filePath },
				`Critical error processing file ${file.filePath}. Skipping this file.`,
			);
			return [];
		}
	}

	private async _processAndIndexEmbeddingBatch(
		chunksToProcess: ChunkWithFileContext[],
		documentsTarget: google.cloud.discoveryengine.v1beta.IDocument[],
		stats: IndexingStats,
	): Promise<number> {
		if (chunksToProcess.length === 0) return 0;

		logger.info(`Processing batch of ${chunksToProcess.length} chunks for embedding...`);
		const textsToEmbed = chunksToProcess.map((chunk) => chunk.contextualized_chunk_content);
		const embeddingsBatchResults = await this.embeddingService.generateEmbeddings(textsToEmbed, 'RETRIEVAL_DOCUMENT');

		let successfullyEmbeddedInBatch = 0;
		for (let i = 0; i < embeddingsBatchResults.length; i++) {
			const embeddingVector = embeddingsBatchResults[i];
			const currentChunk = chunksToProcess[i];

			if (embeddingVector && embeddingVector.length > 0) {
				currentChunk.embedding = embeddingVector;
				const docProto = this._prepareDocumentProto(currentChunk);
				documentsTarget.push(docProto);
				successfullyEmbeddedInBatch++;
			} else {
				stats.failedChunksCount++;
				logger.warn(`Skipping chunk in ${currentChunk.filePath} at line ${currentChunk.source_location.start_line} due to embedding failure.`);
			}
		}
		logger.info(`Successfully embedded ${successfullyEmbeddedInBatch} documents from batch of ${chunksToProcess.length}.`);
		return successfullyEmbeddedInBatch;
	}

	private _createDocumentId(filePath: string, functionName: string | undefined, startLine: number): string {
		const identifier = `${filePath}:${functionName || 'file'}:${startLine}`;
		return Buffer.from(identifier).toString('base64url');
	}

	private _prepareDocumentProto(chunk: ChunkWithFileContext): google.cloud.discoveryengine.v1beta.IDocument {
		const docId = this._createDocumentId(chunk.filePath, chunk.chunk_type, chunk.source_location.start_line);

		const document: google.cloud.discoveryengine.v1beta.IDocument = {
			id: docId,
			structData: struct.encode({
				file_path: chunk.filePath,
				original_code: chunk.original_chunk_content,
				embedding_vector: chunk.embedding,
				lexical_search_text: chunk.contextualized_chunk_content,
			}),
		};
		return document;
	}

	async search(query: string, maxResults = 10): Promise<ChunkSearchResult[]> {
		await this.dataStore.ensureDataStoreExists();
		logger.info({ query, maxResults }, `Performing search in data store: ${this.config.dataStoreId}`);

		const servingConfigPath = this.dataStore.getServingConfigPath();

		const queryEmbedding = await this.embeddingService.generateEmbedding(query, 'RETRIEVAL_DOCUMENT');
		if (!queryEmbedding) {
			logger.error({ query }, 'Failed to generate embedding for search query.');
			return [];
		}

		const searchRequest: google.cloud.discoveryengine.v1beta.ISearchRequest = {
			servingConfig: servingConfigPath,
			pageSize: maxResults,
			embeddingSpec: {
				embeddingVectors: [
					{
						fieldPath: 'embedding_vector',
						vector: queryEmbedding,
					},
				],
			},
		};

		const searchResults = await this.dataStore.search(searchRequest);
		logger.info({ query }, `Received ${searchResults?.length ?? 0} search results.`);

		// 4. Process Results
		const results: ChunkSearchResult[] = [];
		if (searchResults) {
			for (const result of searchResults) {
				// Ensure result and document exist before proceeding
				if (result.document?.structData?.fields) {
					const fields = result.document.structData.fields;
					// Helper to safely extract string values from Struct fields
					const getString = (fieldName: string): string | undefined => fields[fieldName]?.stringValue;
					// Helper to safely extract number values
					const getNumber = (fieldName: string): number | undefined => fields[fieldName]?.numberValue;

					const item: ChunkSearchResult = {
						id: result.document.id ?? 'unknown-id',
						score: result.document.derivedStructData?.fields?.search_score?.numberValue ?? 0, // Check actual score field name
						document: {
							filePath: getString('file_path') ?? 'unknown_path',
							functionName: getString('function_name'), // Optional
							startLine: getNumber('start_line') ?? 0,
							endLine: getNumber('end_line') ?? 0,
							language: getString('language') ?? 'unknown',
							naturalLanguageDescription: getString('natural_language_description') ?? '',
							originalCode: getString('original_code') ?? '',
						},
					};
					results.push(item);
				}
			}
		}

		results.sort((a, b) => b.score - a.score);

		return results;
	}

	async createDataStore(): Promise<void> {
		await this.dataStore.ensureDataStoreExists();
	}

	async deleteDataStore(): Promise<void> {
		await this.dataStore.deleteDataStore();
	}
}

/**
 * Sanitizes a Git URL to be a valid Google Cloud resource ID.
 * Replaces non-alphanumeric characters with hyphens and enforces length constraints.
 * @param url The Git URL.
 * @returns A sanitized string suitable for a data store ID.
 */
export function sanitizeGitUrlForDataStoreId(url: string): string {
	return url
		.replace(/^https?:\/\//, '') // Remove protocol
		.replace(/\.git$/, '') // Remove .git suffix
		.replace(/[^a-zA-Z0-9-]/g, '_') // Replace non-alphanumeric with underscore
		.toLowerCase()
		.slice(0, 60); // Enforce max length for resource IDs
}
