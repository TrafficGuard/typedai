import { google } from '@google-cloud/discoveryengine/build/protos/protos';
import { struct } from 'pb-util';
import pino from 'pino';
import { settleAllWithInput } from '#utils/async-utils';
import { CodeFile, readFilesToIndex } from '../codeLoader';
import { SearchResult, VectorStore } from '../vector';
import { DiscoveryEngineDataStore } from './discoveryEngineDataStore';
import { ContextualizedChunkItem, generateContextualizedChunks } from './indexing/contextualizedChunker';
import { TextEmbeddingService, VertexAITextEmbeddingService } from './indexing/vertexEmbedder';

const logger = pino({ name: 'GoogleVectorStore' });

const BATCH_SIZE = 100; // Max documents per ImportDocuments request

const FILE_PROCESSING_PARALLEL_BATCH_SIZE = 5;
const INDEXER_EMBEDDING_PROCESSING_BATCH_SIZE = 100;

interface ChunkWithFileContext extends ContextualizedChunkItem {
	filePath: string;
	language: string;
	embedding?: number[];
}

export class GoogleVectorStore implements VectorStore {
	private readonly project: string;
	private readonly location: string;
	private readonly collection: string;
	private dataStoreId: string;
	private dataStore: DiscoveryEngineDataStore;
	private embeddingService: TextEmbeddingService;

	constructor(project: string, location: string, collection: string, dataStoreId: string) {
		this.project = project;
		this.location = location;
		this.collection = collection;
		this.dataStoreId = dataStoreId;

		this.dataStore = new DiscoveryEngineDataStore(project, location, collection, dataStoreId);
		this.embeddingService = new VertexAITextEmbeddingService();
	}

	async indexRepository(dir = './'): Promise<void> {
		logger.info(`Starting indexing pipeline for directory: ${dir}`);
		await this.dataStore.ensureDataStoreExists();

		const codeFiles = await readFilesToIndex(dir);
		if (codeFiles.length === 0) {
			logger.warn('No code files found to index.');
			return;
		}
		logger.info(`Loaded ${codeFiles.length} code files.`);

		// Before indexing new content, purge all documents associated with the files being re-indexed.
		await this.dataStore.purgeDocuments(codeFiles.map((file) => file.filePath));

		const failedFilesCount = { count: 0 };
		const failedChunksCount = { count: 0 };
		let totalChunks = 0;
		let successfullyProcessedAndEmbeddedChunks = 0;
		const documentsToIndex: google.cloud.discoveryengine.v1beta.IDocument[] = [];
		const processedChunksReadyForEmbedding: ChunkWithFileContext[] = [];

		// Process files in parallel batches
		for (let i = 0; i < codeFiles.length; i += FILE_PROCESSING_PARALLEL_BATCH_SIZE) {
			const fileBatch = codeFiles.slice(i, i + FILE_PROCESSING_PARALLEL_BATCH_SIZE);
			logger.info(`Processing a batch of ${fileBatch.length} files in parallel (batch starting at index ${i})...`);

			const settledFileResults = await settleAllWithInput(fileBatch, (currentFile) => this._processFileAndGetContextualizedChunks(currentFile));

			const chunksFromBatch: ChunkWithFileContext[] = [];
			for (const result of settledFileResults.fulfilledInputs) {
				const chunksFromThisFile = result[1]; // resolvedValue is ChunkWithFileContext[]
				if (chunksFromThisFile.length > 0) {
					chunksFromBatch.push(...chunksFromThisFile);
				}
			}
			processedChunksReadyForEmbedding.push(...chunksFromBatch);
			totalChunks += chunksFromBatch.length;

			for (const result of settledFileResults.rejected) {
				failedFilesCount.count++;
				logger.error({ err: result.reason, filePath: result.input.filePath }, 'File failed during batched parallel processing.');
			}

			// Check if current embedding batch is ready or if it's the last file batch
			if (
				processedChunksReadyForEmbedding.length >= INDEXER_EMBEDDING_PROCESSING_BATCH_SIZE ||
				(i + FILE_PROCESSING_PARALLEL_BATCH_SIZE >= codeFiles.length && processedChunksReadyForEmbedding.length > 0)
			) {
				const successfullyEmbeddedInBatch = await this._processAndIndexEmbeddingBatch(processedChunksReadyForEmbedding, documentsToIndex, failedChunksCount);
				successfullyProcessedAndEmbeddedChunks += successfullyEmbeddedInBatch;
				processedChunksReadyForEmbedding.length = 0; // Clear the array for the next batch

				// Check if documentsToIndex needs to be flushed to Discovery Engine
				if (documentsToIndex.length >= BATCH_SIZE || (i + FILE_PROCESSING_PARALLEL_BATCH_SIZE >= codeFiles.length && documentsToIndex.length > 0)) {
					logger.info(`Indexing batch of ${documentsToIndex.length} documents to Discovery Engine...`);
					await this.dataStore.importDocuments(documentsToIndex);
					documentsToIndex.length = 0; // Clear the Discovery Engine batch array
				}
			}
		}

		logger.info(
			`Indexing pipeline completed. Successfully prepared ${successfullyProcessedAndEmbeddedChunks} chunks from ${
				codeFiles.length - failedFilesCount.count
			} files for indexing.`,
		);
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

		const metadata = {
			file_path: chunk.filePath,
			function_name: chunk.chunk_type || undefined,
			start_line: chunk.source_location.start_line,
			end_line: chunk.source_location.end_line,
			language: chunk.language,
			natural_language_description: chunk.generated_context,
			original_code: chunk.original_chunk_content,
		};

		const jsonData = struct.encode(metadata);
		const document: google.cloud.discoveryengine.v1beta.IDocument = { id: docId, structData: jsonData };

		if (document.structData?.fields) {
			if (chunk.embedding && chunk.embedding.length > 0) {
				document.structData.fields.embedding_vector = {
					listValue: { values: chunk.embedding.map((value) => ({ numberValue: value })) },
				};
			}
			document.structData.fields.lexical_search_text = { stringValue: chunk.contextualized_chunk_content };
		}
		return document;
	}

	async search(query: string, maxResults = 10): Promise<SearchResult[]> {
		await this.dataStore.ensureDataStoreExists();
		logger.info({ query, maxResults }, `Performing search in data store: ${this.dataStoreId}`);
		return this.runSearchInternal(query, maxResults);
	}

	private async runSearchInternal(query: string, maxResults: number): Promise<SearchResult[]> {
		const servingConfigPath = this.dataStore.getServingConfigPath();

		const queryEmbedding = await this.embeddingService.generateEmbedding(query, 'CODE_RETRIEVAL_QUERY');
		if (!queryEmbedding) {
			logger.error({ query }, 'Failed to generate embedding for search query.');
			return [];
		}

		const searchRequest: google.cloud.discoveryengine.v1beta.ISearchRequest = {
			servingConfig: servingConfigPath,
			query: query,
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

		const response = await this.dataStore.search(searchRequest);

		const searchResultsWithScore = (response.results || [])
			.map((result) => {
				const fields = result.document?.structData?.fields;
				return {
					searchResult: {
						id: result.document?.id ?? 'unknown-id',
						document: {
							filePath: fields?.file_path?.stringValue ?? 'unknown_path',
							functionName: fields?.function_name?.stringValue,
							startLine: fields?.start_line?.numberValue ?? 0,
							endLine: fields?.end_line?.numberValue ?? 0,
							language: fields?.language?.stringValue ?? 'unknown',
							naturalLanguageDescription: fields?.natural_language_description?.stringValue ?? '',
							originalCode: fields?.original_code?.stringValue ?? '',
						},
					},
					score: result.document?.derivedStructData?.fields?.search_score?.numberValue ?? 0,
				};
			})
			.filter((item) => item.searchResult.id !== 'unknown-id');

		searchResultsWithScore.sort((a, b) => b.score - a.score);

		return searchResultsWithScore.map((item) => ({
			...item.searchResult,
			score: item.score,
		}));
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
