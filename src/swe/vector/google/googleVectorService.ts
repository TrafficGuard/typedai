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

const logger = pino({ name: 'GoogleVectorStore' });

const BATCH_SIZE = 100; // Max documents per ImportDocuments request

const FILE_PROCESSING_PARALLEL_BATCH_SIZE = 5;
const INDEXER_EMBEDDING_PROCESSING_BATCH_SIZE = 100;

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

		if (codeFiles.length === 0) {
			logger.info('No files to index.');
			return;
		}
		await this.indexFiles(codeFiles);
	}

	private async indexFiles(codeFiles: CodeFile[]): Promise<void> {
		await this.dataStore.ensureDataStoreExists();

		// Before indexing new content, purge all documents associated with the files being re-indexed.
		await this.dataStore.purgeDocuments(codeFiles.map((file) => file.filePath));

		const { chunks, failedFilesCount } = await this._generateAllContextualizedChunks(codeFiles);

		if (chunks.length === 0) {
			logger.info('No chunks were generated from the files. Indexing complete.');
			return;
		}

		const { documents, failedChunksCount } = await this._generateEmbeddingsAndPrepareDocuments(chunks);

		if (documents.length > 0) {
			await this._importDocumentsToDataStore(documents);
		}

		logger.info(
			`Indexing pipeline completed. Successfully prepared ${documents.length} chunks from ${
				codeFiles.length - failedFilesCount
			} files for indexing. Failed to process ${failedFilesCount} files and ${failedChunksCount} chunks.`,
		);
	}

	private async _generateAllContextualizedChunks(codeFiles: CodeFile[]): Promise<{ chunks: ChunkWithFileContext[]; failedFilesCount: number }> {
		const allChunks: ChunkWithFileContext[] = [];
		let failedFilesCount = 0;

		// Process files in parallel batches
		for (let i = 0; i < codeFiles.length; i += FILE_PROCESSING_PARALLEL_BATCH_SIZE) {
			const fileBatch = codeFiles.slice(i, i + FILE_PROCESSING_PARALLEL_BATCH_SIZE);
			logger.info(`Generating chunks for a batch of ${fileBatch.length} files (batch starting at index ${i})...`);

			const settledFileResults = await settleAllWithInput(fileBatch, (currentFile) => this._processFileAndGetContextualizedChunks(currentFile));

			for (const result of settledFileResults.fulfilledInputs) {
				const chunksFromThisFile = result[1]; // resolvedValue is ChunkWithFileContext[]
				if (chunksFromThisFile.length > 0) {
					allChunks.push(...chunksFromThisFile);
				}
			}

			for (const result of settledFileResults.rejected) {
				failedFilesCount++;
				logger.error({ err: result.reason, filePath: result.input.filePath }, 'File failed during chunk generation.');
			}
		}
		logger.info(`Generated ${allChunks.length} chunks from ${codeFiles.length - failedFilesCount} files.`);
		return { chunks: allChunks, failedFilesCount };
	}

	private async _generateEmbeddingsAndPrepareDocuments(
		allChunks: ChunkWithFileContext[],
	): Promise<{ documents: google.cloud.discoveryengine.v1beta.IDocument[]; failedChunksCount: number }> {
		const documentsToIndex: google.cloud.discoveryengine.v1beta.IDocument[] = [];
		const failedChunksCount = { count: 0 };
		let successfullyEmbeddedChunks = 0;

		for (let i = 0; i < allChunks.length; i += INDEXER_EMBEDDING_PROCESSING_BATCH_SIZE) {
			const chunkBatch = allChunks.slice(i, i + INDEXER_EMBEDDING_PROCESSING_BATCH_SIZE);

			const successfullyEmbeddedInBatch = await this._processAndIndexEmbeddingBatch(chunkBatch, documentsToIndex, failedChunksCount);
			successfullyEmbeddedChunks += successfullyEmbeddedInBatch;
		}

		logger.info(`Successfully generated embeddings for ${successfullyEmbeddedChunks} of ${allChunks.length} chunks.`);
		return { documents: documentsToIndex, failedChunksCount: failedChunksCount.count };
	}

	private async _importDocumentsToDataStore(documents: google.cloud.discoveryengine.v1beta.IDocument[]): Promise<void> {
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
		globalFailedChunksCounter: { count: number },
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
				globalFailedChunksCounter.count++;
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
