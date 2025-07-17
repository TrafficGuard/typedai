import { google } from '@google-cloud/discoveryengine/build/protos/protos';
import pLimit from 'p-limit';
import { struct } from 'pb-util';
import pino from 'pino';
import { span } from '#o11y/trace';
import { ChunkSearchResult, ChunkWithFileContext } from '../chunking/chunkTypes';
import { generateContextualizedChunks } from '../chunking/contextualizedChunker';
import { CodeFile, readFilesToIndex } from '../codeLoader';
import { VectorStore } from '../vector';
import { DiscoveryEngine } from './discoveryEngine';
import { GoogleVectorServiceConfig } from './googleVectorConfig';
import { VertexAITextEmbeddingService } from './vertexEmbedder';

const logger = pino({ name: 'GoogleVectorStore' });

const FILE_PROCESSING_PARALLEL_BATCH_SIZE = 20;

class IndexingStats {
	fileCount = 0;
	failedFiles: string[] = [];
	failedChunksCount = 0;
}

export class GoogleVectorStore implements VectorStore {
	private dataStore: DiscoveryEngine;
	private embeddingService: VertexAITextEmbeddingService;

	constructor(private config: GoogleVectorServiceConfig) {
		this.dataStore = new DiscoveryEngine(config);
		this.embeddingService = new VertexAITextEmbeddingService(config);
	}

	/**
	 *
	 * @param dir the root directory of the repository
	 * @param subFolder only index files under this folder
	 */
	@span()
	async indexRepository(dir = './', subFolder: string = './'): Promise<void> {
		logger.info(`Starting indexing pipeline for directory: ${dir}`);
		const codeFiles = await readFilesToIndex(dir, subFolder);
		logger.info(`Loaded ${codeFiles.length} code files.`);

		if (codeFiles.length === 0) return;

		await this.indexFiles(codeFiles);
	}

	private async indexFiles(codeFiles: CodeFile[], stats = new IndexingStats()): Promise<void> {
		await this.dataStore.ensureDataStoreExists();
		stats.fileCount = codeFiles.length;

		// Before indexing new content, purge all documents associated with the files being re-indexed.
		await this.dataStore.purgeDocuments(codeFiles.map((file) => file.filePath));

		const limit = pLimit(FILE_PROCESSING_PARALLEL_BATCH_SIZE);
		let totalDocuments = 0;

		logger.info(`Starting pipelined indexing for ${codeFiles.length} files with a concurrency of ${FILE_PROCESSING_PARALLEL_BATCH_SIZE}...`);

		const processingPromises = codeFiles.map((file: CodeFile) =>
			limit(async () => {
				logger.info(`Starting processing for ${file.filePath}`)
				try {
					// 1. Chunk file
					const fileChunks = await this.generateContextualizedChunks(file, stats);
					if (fileChunks.length === 0) {
						logger.debug({ filePath: file.filePath }, 'No chunks generated for file, skipping.');
						return;
					}
					for (const chunk of fileChunks) console.log(chunk.filePath + ' =====================\n' + chunk.contextualized_chunk_content + '\n\n\n');
					logger.debug({ filePath: file.filePath, chunkCount: fileChunks.length }, 'File chunked, starting embedding.');

					// 2. Embed chunks and prepare documents
					const documents = await this.generateEmbeddingsAndPrepareDocuments(fileChunks, stats);
					if (documents.length === 0) {
						logger.warn({ filePath: file.filePath }, 'No documents generated from chunks, skipping storage.');
						return;
					}
					totalDocuments += documents.length;
					logger.info({ filePath: file.filePath, documentCount: documents.length }, 'Embeddings generated, starting storage.');

					// 3. Store documents
					await this.dataStore.importDocuments(documents);
					// logger.info(`Completed import of ${documents.length} documents for ${file.filePath}.`);
				} catch (e) {
					stats.failedFiles.push(file.filePath);
					logger.error({ err: e, filePath: file.filePath }, 'File failed during processing pipeline.');
				}
			}),
		);

		await Promise.all(processingPromises);

		logger.info(
			`Processed ${totalDocuments} chunks from ${
				codeFiles.length - stats.failedFiles.length
			} files. ${stats.failedFiles.length} files failed. ${stats.failedChunksCount} chunks failed.`,
		);
	}

	private async generateEmbeddingsAndPrepareDocuments(
		allChunks: ChunkWithFileContext[],
		stats: IndexingStats,
	): Promise<google.cloud.discoveryengine.v1beta.IDocument[]> {
		logger.info(`Generating embeddings for ${allChunks.length} chunks in parallel...`);

		const documentPromises = allChunks.map(async (chunk) => {
			const embeddingVector = await this.embeddingService.generateEmbedding(chunk.contextualized_chunk_content, 'RETRIEVAL_DOCUMENT');
			if (embeddingVector && embeddingVector.length > 0) {
				chunk.embedding = embeddingVector;
				return this.createDocument(chunk);
			}
			stats.failedChunksCount++;
			logger.warn(`Skipping chunk in ${chunk.filePath} at line ${chunk.source_location.start_line} due to embedding failure.`);
			return null;
		});

		const settledResults = await Promise.all(documentPromises);
		const documentsToIndex = settledResults.filter((doc) => doc !== null) as google.cloud.discoveryengine.v1beta.IDocument[];

		logger.info(`Successfully generated embeddings for ${documentsToIndex.length} of ${allChunks.length} chunks.`);
		return documentsToIndex;
	}

	private async generateContextualizedChunks(file: CodeFile, stats: IndexingStats): Promise<ChunkWithFileContext[]> {
		try {
			const contextualizedItems = await generateContextualizedChunks(file.filePath, file.content, file.language);
			return contextualizedItems.map((item) => ({
				...item,
				filePath: file.filePath,
				language: file.language,
			}));
		} catch (fileProcessingError: any) {
			stats.failedFiles.push(file.filePath);
			logger.error(
				{ err: { message: fileProcessingError.message, stack: fileProcessingError.stack }, filePath: file.filePath },
				`Critical error processing file ${file.filePath}. Skipping this file.`,
			);
			return [];
		}
	}

	private createDocumentId(filePath: string, functionName: string | undefined, startLine: number): string {
		const identifier = `${filePath}:${functionName || 'file'}:${startLine}`;
		return Buffer.from(identifier).toString('base64url');
	}

	private createDocument(chunk: ChunkWithFileContext): google.cloud.discoveryengine.v1beta.IDocument {
		const docId = this.createDocumentId(chunk.filePath, chunk.chunk_type, chunk.source_location.start_line);

		const document: google.cloud.discoveryengine.v1beta.IDocument = {
			id: docId,
			uri: chunk.filePath,
			structData: struct.encode({
				file_path: chunk.filePath,
				original_code: chunk.original_chunk_content,
				embedding_vector: chunk.embedding,
				lexical_search_text: chunk.contextualized_chunk_content,
			}),
		} as any;
		return document;
	}

	async search(query: string, maxResults = 10): Promise<ChunkSearchResult[]> {
		await this.dataStore.ensureDataStoreExists();
		logger.info({ query, maxResults }, `Performing search in data store: ${this.config.dataStoreId}`);

		const servingConfigPath = this.dataStore.getServingConfigPath();

		// const queryEmbedding = await this.embeddingService.generateEmbedding(query, 'RETRIEVAL_DOCUMENT');
		// if (!queryEmbedding) {
		// 	logger.error({ query }, 'Failed to generate embedding for search query.');
		// 	return [];
		// }

		const searchRequest: google.cloud.discoveryengine.v1.ISearchRequest = {
			servingConfig: servingConfigPath,
			pageSize: maxResults,
			relevanceScoreSpec: {
				returnRelevanceScore: true,
			},
			query,
			// embeddingSpec: {
			// 	embeddingVectors: [
			// 		{
			// 			fieldPath: 'embedding_vector',
			// 			vector: queryEmbedding,
			// 		},
			// 	],
			// },
		} as google.cloud.discoveryengine.v1.ISearchRequest;

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
					console.log(result)
					const item: ChunkSearchResult = {
						id: result.document.id ?? 'unknown-id',
						score: 0,//result.modelScores[0].score,
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
