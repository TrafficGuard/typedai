// File: src/swe/vector/google/google-vector-store.ts

import { DataStoreServiceClient, DocumentServiceClient, SearchServiceClient } from '@google-cloud/discoveryengine';
import { google } from '@google-cloud/discoveryengine/build/protos/protos';
import pino from 'pino';
import { struct } from 'pb-util';
import { sleep } from '#utils/async-async-utils';
import { SearchResult, VectorStore } from '../vector';
import { createDataStoreServiceClient, getDocumentServiceClient, getSearchServiceClient } from './config';
import { CodeFile, readFilesToIndex } from './indexing/codeLoader';
import { TextEmbeddingService, VertexAITextEmbeddingService, getEmbeddingService } from './indexing/embedder';
import { ContextualizedChunkItem, generateContextualizedChunks } from './indexing/unifiedChunkContextualizer';

const logger = pino({ name: 'GoogleVectorStore' });

const BATCH_SIZE = 100; // Max documents per ImportDocuments request
const MAX_RETRIES = 3;
const INITIAL_RETRY_DELAY_MS = 1000;
const RETRY_DELAY_MULTIPLIER = 2;

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
	private dataStoreClient: DataStoreServiceClient;
	private documentClient: DocumentServiceClient;
	private searchClient: SearchServiceClient;
	private dataStorePath: string | null = null;
	private embeddingService: TextEmbeddingService;

	constructor(project: string, location: string, collection: string, dataStoreId: string) {
		this.project = project;
		this.location = location;
		this.collection = collection;
		this.dataStoreId = dataStoreId;

		this.documentClient = getDocumentServiceClient();
		this.searchClient = getSearchServiceClient();
		this.dataStoreClient = createDataStoreServiceClient(this.location);
		this.embeddingService = new VertexAITextEmbeddingService();
	}

	async indexRepository(dir: string = './'): Promise<void> {
		const files = await readFilesToIndex(dir);
		await this.indexFiles(files);
	}

	private async indexFiles(files: CodeFile[]): Promise<void> {
		await this.ensureDataStoreExists();

		const documents: ChunkWithFileContext[] = await this.generateContextualizedChunks(files);

		await this.addEmbeddings(documents);

		await this.deleteDocuments(files.map((file) => file.filePath));

		await this.importDocuments(documents);
	}

	private _createDocumentId(filePath: string, functionName: string | undefined, startLine: number): string {
		const identifier = `${filePath}:${functionName || 'file'}:${startLine}`;
		// Use base64 encoding for safe IDs
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
			chunk_specific_context: chunk.generated_context,
			original_code: chunk.original_chunk_content,
		};

		const jsonData = struct.encode(metadata);

		const document: google.cloud.discoveryengine.v1beta.IDocument = {
			id: docId,
			structData: jsonData,
		};

		if (document.structData?.fields) {
			if (chunk.embedding && chunk.embedding.length > 0) {
				document.structData.fields.embedding_vector = {
					listValue: {
						values: chunk.embedding.map((value) => ({ numberValue: value })),
					},
				};
			} else {
				logger.warn(`No embedding generated for doc ${docId}`);
			}

			const lexicalSearchContent = chunk.contextualized_chunk_content;
			if (lexicalSearchContent && lexicalSearchContent.trim() !== '') {
				document.structData.fields.lexical_search_text = { stringValue: lexicalSearchContent };
			} else {
				logger.warn(`Document ID ${docId} has empty lexicalSearchContent. Not adding lexical_search_text field.`);
			}
		} else {
			logger.warn(`structData or structData.fields missing for doc ${docId}. Cannot add embedding or lexical_search_text.`);
		}

		return document;
	}

	private async importDocuments(documents: ChunkWithFileContext[]): Promise<void> {
		logger.info(`Starting import for ${documents.length} documents.`);
		for (let i = 0; i < documents.length; i += BATCH_SIZE) {
			const batch = documents.slice(i, i + BATCH_SIZE);
			const docProtos = batch.map((doc) => this._prepareDocumentProto(doc));

			if (docProtos.length === 0) continue;

			const request: google.cloud.discoveryengine.v1beta.IImportDocumentsRequest = {
				parent: `${this.dataStorePath}/branches/default_branch`,
				inlineSource: {
					documents: docProtos,
				},
				reconciliationMode: google.cloud.discoveryengine.v1beta.ImportDocumentsRequest.ReconciliationMode.INCREMENTAL,
			};

			for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
				try {
					logger.info(`Attempting to import batch of ${docProtos.length} documents (Attempt ${attempt + 1}/${MAX_RETRIES})...`);
					const [operation] = await this.documentClient.importDocuments(request);
					logger.info(`ImportDocuments operation started: ${operation.name}`);
					// Not waiting for completion for now to speed up process, can be changed.
					// await operation.promise();
					break; // Success
				} catch (apiError: any) {
					const delay = INITIAL_RETRY_DELAY_MS * RETRY_DELAY_MULTIPLIER ** attempt;
					logger.error(
						{ err: apiError, attempt: attempt + 1, maxRetries: MAX_RETRIES, delay },
						`API call failed for importDocuments. Retrying in ${delay}ms...`,
					);
					if (attempt < MAX_RETRIES - 1) {
						await sleep(delay);
					} else {
						logger.error(`All ${MAX_RETRIES} retries failed for importDocuments. Skipping batch.`);
						// Decide if to throw or just log and continue
					}
				}
			}
		}
		logger.info('Finished importing all document batches.');
	}

	private async deleteDocuments(filePaths: string[]): Promise<void> {
		if (filePaths.length === 0) {
			logger.info('No file paths provided for deletion. Skipping.');
			return;
		}
		logger.info(`Purging documents for ${filePaths.length} file(s)...`);

		// Discovery Engine filter string can get very long.
		// Let's batch the deletions to avoid hitting filter length limits.
		const BATCH_SIZE_PURGE = 20; // Number of files to purge per API call

		for (let i = 0; i < filePaths.length; i += BATCH_SIZE_PURGE) {
			const batchFilePaths = filePaths.slice(i, i + BATCH_SIZE_PURGE);
			const filter = batchFilePaths.map((p) => `struct_field("file_path") = "${p}"`).join(' OR ');

			const request: google.cloud.discoveryengine.v1beta.IPurgeDocumentsRequest = {
				parent: `${this.dataStorePath}/branches/default_branch`,
				filter: filter,
				force: true, // Required for purge
			};

			try {
				const [operation] = await this.documentClient.purgeDocuments(request);
				logger.info(`PurgeDocuments operation started for ${batchFilePaths.length} files: ${operation.name}`);
				// Not waiting for completion to speed up process.
				// await operation.promise();
			} catch (error) {
				logger.error({ error, filter }, 'Failed to start PurgeDocuments operation.');
				// Decide if to throw or continue
			}
		}
	}

	private async addEmbeddings(documents: ChunkWithFileContext[]): Promise<void> {
		logger.info(`Generating embeddings for ${documents.length} document chunks.`);
		const BATCH_SIZE_EMBEDDING = 25; // As per EMBEDDING_API_BATCH_SIZE in config

		for (let i = 0; i < documents.length; i += BATCH_SIZE_EMBEDDING) {
			const batch = documents.slice(i, i + BATCH_SIZE_EMBEDDING);
			const textsToEmbed = batch.map((c) => c.contextualized_chunk_content);

			const embeddings = await this.embeddingService.generateEmbeddings(textsToEmbed, 'RETRIEVAL_DOCUMENT');

			embeddings.forEach((embedding, index) => {
				if (embedding) {
					batch[index].embedding = embedding;
				} else {
					logger.warn(`Failed to generate embedding for chunk starting at line ${batch[index].source_location.start_line} in ${batch[index].filePath}`);
				}
			});
		}
		logger.info('Finished generating embeddings for all chunks.');
	}

	private async generateContextualizedChunks(files: CodeFile[]): Promise<ChunkWithFileContext[]> {
		const allChunks: ChunkWithFileContext[] = [];
		for (const file of files) {
			const chunksForFile = await generateContextualizedChunks(file.filePath, file.content, file.language);
			for (const chunk of chunksForFile) {
				allChunks.push({
					...chunk,
					filePath: file.filePath,
					language: file.language,
				});
			}
		}
		return allChunks;
	}


	async search(query: string, maxResults = 10): Promise<SearchResult[]> {
		await this.ensureDataStoreExists();
		logger.info({ query, maxResults }, `Performing search in data store: ${this.dataStoreId}`);
		return this.runSearchInternal(query, maxResults);
	}

	private async runSearchInternal(query: string, maxResults: number): Promise<SearchResult[]> {
		const servingConfigPath = this.searchClient.projectLocationCollectionDataStoreServingConfigPath(
			this.project,
			this.location,
			this.collection,
			this.dataStoreId,
			'default_config',
		);

		const queryEmbedding = await getEmbeddingService().generateEmbedding(query, 'CODE_RETRIEVAL_QUERY');
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

		const [response] = (await this.searchClient.search(searchRequest, {
			autoPaginate: false,
		})) as [google.cloud.discoveryengine.v1beta.ISearchResponse, any, any];

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

	private async ensureDataStoreExists(): Promise<void> {
		if (this.dataStorePath) return;

		const parent = `projects/${this.project}/locations/${this.location}/collections/${this.collection}`;
		const prospectivePath = `${parent}/dataStores/${this.dataStoreId}`;

		try {
			await this.dataStoreClient.getDataStore({ name: prospectivePath });
			logger.info(`Data store "${this.dataStoreId}" already exists.`);
		} catch (error: any) {
			if (error.code === 5) {
				// gRPC code for NOT_FOUND
				logger.warn(`Data store "${this.dataStoreId}" not found. Creating...`);
				const [operation] = await this.dataStoreClient.createDataStore({
					parent,
					dataStoreId: this.dataStoreId,
					dataStore: {
						displayName: `Repo: ${this.dataStoreId}`,
						industryVertical: 'GENERIC',
						solutionTypes: [google.cloud.discoveryengine.v1beta.SolutionType.SOLUTION_TYPE_SEARCH],
						contentConfig: 'NO_CONTENT',
					},
				});
				await operation.promise();
				logger.info(`Successfully created data store "${this.dataStoreId}".`);
			} else {
				logger.error({ error }, `Failed to get or create data store "${this.dataStoreId}".`);
				throw error;
			}
		}
		this.dataStorePath = prospectivePath;
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
