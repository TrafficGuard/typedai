// Import DocumentServiceClient type explicitly
import type { DocumentServiceClient } from '@google-cloud/discoveryengine';
// Changed 'import type' to 'import' because enum values are used
import { google } from '@google-cloud/discoveryengine/build/protos/protos';
import { struct } from 'pb-util'; // Helper for converting JS objects to Struct proto
import pino from 'pino';
import { settleAllWithInput, sleep } from '#utils/async-utils';
import { INDEXER_EMBEDDING_PROCESSING_BATCH_SIZE, getDiscoveryEngineDataStorePath, getDocumentServiceClient } from '../config';
import { type CodeFile, loadCodeFiles } from '../processing/codeLoader';
import { type ContextualizedChunkItem, generateContextualizedChunksFromFile } from '../processing/unifiedChunkContextualizer';
import { type TextEmbeddingService, getEmbeddingService } from './embedder';

const logger = pino({ name: 'Indexer' });

const MAX_RETRIES = 3;
const INITIAL_RETRY_DELAY_MS = 1000; // 1 second
const RETRY_DELAY_MULTIPLIER = 2; // For exponential backoff

const BATCH_SIZE = 100; // Max documents per ImportDocuments request (check API limits)
const FILE_PROCESSING_PARALLEL_BATCH_SIZE = 5;

/**
 * Creates a unique ID for a code chunk document.
 * Example: base64(filePath:functionName:startLine)
 * @param filePath The path to the file.
 * @param functionName The name of the function, if applicable.
 * @param startLine The starting line number of the chunk.
 * @returns A unique string ID.
 */
function createDocumentId(filePath: string, functionName: string | undefined, startLine: number): string {
	const identifier = `${filePath}:${functionName || 'file'}:${startLine}`;
	// Use base64 encoding for safe IDs
	return Buffer.from(identifier).toString('base64url');
}

interface ProcessedChunkForEmbedding {
	embeddingContent: string;
	metadata: Record<string, any>;
	filePath: string;
	functionName?: string;
	startLine: number;
	lexicalSearchContent: string;
}

/**
 * Processes a single code file to extract and contextualize code chunks using the unified contextualizer.
 * @param file The code file to process.
 * @param globalFailedChunksCounter An object to track the count of chunks that fail processing across all files (currently unused here, primarily for embedding failures).
 * @returns A promise that resolves to an array of processed chunks ready for embedding, or an empty array if processing fails.
 */
async function processFileAndGetContextualizedChunks(
	file: CodeFile,
	globalFailedChunksCounter: { count: number },
): Promise<ProcessedChunkForEmbedding[]> {
	logger.info(`Starting unified processing for file: ${file.filePath}`);
	const processedChunksForEmbedding: ProcessedChunkForEmbedding[] = [];

	try {
		const contextualizedItems: ContextualizedChunkItem[] = await generateContextualizedChunksFromFile(file.filePath, file.content, file.language);

		for (const item of contextualizedItems) {
			const processedChunk: ProcessedChunkForEmbedding = {
				embeddingContent: item.contextualized_chunk_content,
				lexicalSearchContent: item.contextualized_chunk_content,
				metadata: {
					file_path: file.filePath,
					function_name: item.chunk_type || undefined,
					start_line: item.source_location.start_line,
					end_line: item.source_location.end_line,
					language: file.language,
					natural_language_description: item.generated_context, // This is the "situating context"
					chunk_specific_context: item.generated_context, // Also the "situating context"
					original_code: item.original_chunk_content,
				},
				filePath: file.filePath,
				functionName: item.chunk_type || undefined,
				startLine: item.source_location.start_line,
			};
			processedChunksForEmbedding.push(processedChunk);
		}

		logger.info(`Finished unified processing for file: ${file.filePath}. Found ${processedChunksForEmbedding.length} processed chunks for embedding.`);
		return processedChunksForEmbedding;
	} catch (fileProcessingError: any) {
		logger.error(
			{ err: { message: fileProcessingError.message, stack: fileProcessingError.stack }, filePath: file.filePath },
			`Critical error processing file ${file.filePath} using unified chunk contextualizer. Skipping this file.`,
		);
		return []; // Return empty array, promise will be fulfilled
	}
}

/**
 * Prepares a Discovery Engine Document proto from a processed chunk.
 * @param processedChunk The processed chunk data ready for embedding.
 * @param embedding The generated vector embedding.
 * @returns A Discovery Engine Document object.
 */
function prepareDocumentProto(processedChunk: ProcessedChunkForEmbedding, embedding: number[]): google.cloud.discoveryengine.v1beta.IDocument {
	const docId = createDocumentId(processedChunk.filePath, processedChunk.functionName, processedChunk.startLine);

	// Convert metadata JS object to Google Struct proto
	const jsonData = struct.encode(processedChunk.metadata);

	const document: google.cloud.discoveryengine.v1beta.IDocument = {
		id: docId,
		// Use `structData` for queryable/filterable metadata.
		// Use `jsonData` for storing larger blobs of retrievable data (check field usage).
		structData: jsonData,
		// Alternatively, store some key fields directly if schema is defined in Discovery Engine
		// content: {
		//     mimeType: 'application/json', // Or text/plain if embeddingContent is simple text
		//     uri: '', // Not using URI for direct content upload
		//     rawBytes: Buffer.from(contextualizedChunk.embeddingContent) // If embedding text directly
		// },
		// Embeddings are typically added via specific fields or configurations
		// depending on the exact Discovery Engine API version and setup (e.g., custom attributes or dedicated embedding fields).
		// This example assumes embeddings are handled by the service based on configuration
		// or need to be added to a specific field in `structData` or a dedicated field if available.
		// For Vertex AI Vector Search (often backing Discovery Engine), you might put it in structData:
		// jsonData.fields['embedding'] = { values: embedding.map(value => ({ numberValue: value })) };
		// --> Let's assume for now we put it in structData for simplicity.
		// Note: Check Discovery Engine documentation for the correct way to index vectors.
		// It might involve configuring the data store schema to recognize an 'embedding' field.
	};

	// Add embedding to structData (adjust field name 'embedding_vector' as needed based on schema)
	if (document.structData?.fields) {
		if (embedding.length > 0) {
			document.structData.fields.embedding_vector = {
				listValue: {
					values: embedding.map((value) => ({ numberValue: value })),
				},
			};
		} else {
			logger.warn(`No embedding generated for doc ${docId}`);
		}

		if (processedChunk.lexicalSearchContent && processedChunk.lexicalSearchContent.trim() !== '') {
			document.structData.fields.lexical_search_text = { stringValue: processedChunk.lexicalSearchContent };
		} else {
			logger.warn(`Document ID ${docId} has empty lexicalSearchContent. Not adding lexical_search_text field.`);
		}
	} else {
		logger.warn(`structData or structData.fields missing for doc ${docId}. Cannot add embedding or lexical_search_text.`);
	}

	return document;
}

/**
 * Orchestrates the code indexing pipeline.
 * Loads, processes, embeds, and indexes code chunks into Discovery Engine.
 * @param sourceDir The root directory of the source code to index.
 */
export async function runIndexingPipeline(sourceDir: string): Promise<void> {
	logger.info(`Starting indexing pipeline for directory: ${sourceDir}`);

	const failedFilesCount = { count: 0 };
	const failedChunksCount = { count: 0 }; // Tracks chunks failed pre-embedding or during embedding

	const client = getDocumentServiceClient();
	const parentPath = getDiscoveryEngineDataStorePath(); // Path to the data store branch
	const embedderService = getEmbeddingService();

	// 1. Load Code Files
	const codeFiles = await loadCodeFiles(sourceDir);
	if (codeFiles.length === 0) {
		logger.warn('No code files found to index.');
		return;
	}
	logger.info(`Loaded ${codeFiles.length} code files.`);

	let totalChunks = 0;
	let successfullyProcessedAndEmbeddedChunks = 0; // Chunks that made it to a documentProto
	const documentsToIndex: google.cloud.discoveryengine.v1beta.IDocument[] = [];
	const processedChunksReadyForEmbedding: ProcessedChunkForEmbedding[] = [];

	async function processAndIndexEmbeddingBatch(
		chunksToProcess: ProcessedChunkForEmbedding[],
		service: TextEmbeddingService,
		documentsTarget: google.cloud.discoveryengine.v1beta.IDocument[],
		globalFailedChunksCounter: { count: number },
	): Promise<void> {
		if (chunksToProcess.length === 0) {
			return;
		}
		logger.info(`Processing batch of ${chunksToProcess.length} processed chunks for embedding...`);

		const textsToEmbed = chunksToProcess.map((c) => c.embeddingContent);
		const embeddingsBatchResults = await service.generateEmbeddings(textsToEmbed, 'CODE_RETRIEVAL_DOCUMENT');

		let successfullyEmbeddedInBatch = 0;
		for (let i = 0; i < embeddingsBatchResults.length; i++) {
			const embeddingVector = embeddingsBatchResults[i];
			const currentProcessedChunk = chunksToProcess[i];

			if (embeddingVector && embeddingVector.length > 0) {
				const docProto = prepareDocumentProto(currentProcessedChunk, embeddingVector);
				documentsTarget.push(docProto);
				logger.debug(`Prepared document for indexing: ${docProto.id}`);
				successfullyEmbeddedInBatch++;
			} else {
				logger.warn(
					`Skipping chunk ${createDocumentId(currentProcessedChunk.filePath, currentProcessedChunk.functionName, currentProcessedChunk.startLine)} due to embedding failure or empty embedding.`,
				);
				globalFailedChunksCounter.count++; // Increment global failed count
			}
		}
		successfullyProcessedAndEmbeddedChunks += successfullyEmbeddedInBatch;
		logger.info(
			`Successfully embedded and prepared ${successfullyEmbeddedInBatch} documents from batch of ${chunksToProcess.length}. Total prepared: ${successfullyProcessedAndEmbeddedChunks}`,
		);
		chunksToProcess.length = 0; // Clear the array for the next batch
	}

	// Process files in parallel batches
	for (let i = 0; i < codeFiles.length; i += FILE_PROCESSING_PARALLEL_BATCH_SIZE) {
		const fileBatch = codeFiles.slice(i, i + FILE_PROCESSING_PARALLEL_BATCH_SIZE);
		logger.info(`Processing a batch of ${fileBatch.length} files in parallel (batch starting at index ${i})...`);

		const settledFileResults = await settleAllWithInput(fileBatch, (currentFile) => processFileAndGetContextualizedChunks(currentFile, failedChunksCount));

		const chunksFromBatch: ProcessedChunkForEmbedding[] = [];
		for (const result of settledFileResults.fulfilledInputs) {
			// result is [originalInput, resolvedValue]
			// const [fileProcessed, chunksFromThisFile] = result; // originalInput is fileProcessed
			const chunksFromThisFile = result[1]; // resolvedValue is ProcessedChunkForEmbedding[]
			if (chunksFromThisFile.length > 0) {
				chunksFromBatch.push(...chunksFromThisFile);
			}
		}
		processedChunksReadyForEmbedding.push(...chunksFromBatch);
		totalChunks += chunksFromBatch.length; // Accumulate total processed chunks

		for (const result of settledFileResults.rejected) {
			const { input: fileFailed, reason } = result;
			logger.error(
				{ err: reason, filePath: fileFailed.filePath },
				`File ${fileFailed.filePath} failed during batched parallel processing (settleAllWithInput rejected). This typically means an error outside the helper's main try-catch.`,
			);
			failedFilesCount.count++;
		}

		// Check if current embedding batch is ready or if it's the last file batch
		if (
			processedChunksReadyForEmbedding.length >= INDEXER_EMBEDDING_PROCESSING_BATCH_SIZE ||
			(i + FILE_PROCESSING_PARALLEL_BATCH_SIZE >= codeFiles.length && processedChunksReadyForEmbedding.length > 0)
		) {
			await processAndIndexEmbeddingBatch(processedChunksReadyForEmbedding, embedderService, documentsToIndex, failedChunksCount);
			// After processing embeddings, check if documentsToIndex needs to be flushed to Discovery Engine
			if (documentsToIndex.length >= BATCH_SIZE || (i + FILE_PROCESSING_PARALLEL_BATCH_SIZE >= codeFiles.length && documentsToIndex.length > 0)) {
				logger.info(`Indexing batch of ${documentsToIndex.length} documents to Discovery Engine...`);
				await importDocumentsBatch(client, parentPath, documentsToIndex);
				documentsToIndex.length = 0; // Clear the Discovery Engine batch array
			}
		}
	}
	// Note: The final calls to processAndIndexEmbeddingBatch and importDocumentsBatch are handled within the loop's logic now.

	logger.info(
		`File processing summary: Total files: ${codeFiles.length}, Successfully processed files (began chunking): ${codeFiles.length - failedFilesCount.count}, Failed/skipped files (promise rejected or helper returned empty): ${failedFilesCount.count}.`,
	);
	logger.info(
		`Chunk processing summary: Total chunks from successfully processed files: ${totalChunks}, Successfully embedded & prepared for indexing: ${successfullyProcessedAndEmbeddedChunks}, Failed/skipped chunks (pre-embedding or during embedding): ${failedChunksCount.count}.`,
	);
	logger.info(
		`Indexing pipeline completed. Successfully prepared ${successfullyProcessedAndEmbeddedChunks} chunks from ${codeFiles.length - failedFilesCount.count} files for indexing.`,
	);
}

/**
 * Imports a batch of documents into Discovery Engine.
 * @param client The DocumentServiceClient instance.
 * @param parentPath The resource path of the data store branch.
 * @param documents The array of document protos to import.
 */
async function importDocumentsBatch(
	client: DocumentServiceClient,
	parentPath: string,
	documents: google.cloud.discoveryengine.v1beta.IDocument[],
): Promise<void> {
	const functionName = 'importDocumentsBatch';
	const request: google.cloud.discoveryengine.v1beta.IImportDocumentsRequest = {
		parent: parentPath,
		// Use inlineSource for direct data upload
		inlineSource: {
			documents: documents,
		},
		// Choose reconciliationMode (e.g., INCREMENTAL or FULL)
		// INCREMENTAL: Adds/updates documents based on ID.
		// FULL: Replaces existing documents in the branch (use with caution).
		reconciliationMode: google.cloud.discoveryengine.v1beta.ImportDocumentsRequest.ReconciliationMode.INCREMENTAL,
		// Error handling config (optional)
		// errorConfig: { gcsPrefix: 'gs://your-bucket/import-errors' }
	};

	for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
		try {
			logger.info(
				{ functionName, attempt: attempt + 1, maxRetries: MAX_RETRIES, parentPath, documentCount: documents.length },
				`Attempting to import ${documents.length} documents (Attempt ${attempt + 1}/${MAX_RETRIES})...`,
			);
			const [operation] = await client.importDocuments(request);
			logger.info({ functionName, operationName: operation.name }, `ImportDocuments operation started: ${operation.name}`);

			if (operation.error) {
				logger.error(
					{ functionName, operationName: operation.name, error: operation.error, documentCount: documents.length },
					`ImportDocuments operation for ${documents.length} documents failed immediately after start. This is treated as a non-retryable issue for this batch.`,
				);
				// Construct a new error to include more context if desired
				const opError = new Error(`Import operation ${operation.name} failed immediately: ${JSON.stringify(operation.error)}`);
				// opError.details = operation.error; // Or similar if you want to attach the original error object
				throw opError;
			}
			// If successful, exit the retry loop and the function.
			// Optionally wait for the operation to complete
			// const [response] = await operation.promise();
			// logger.info(`ImportDocuments operation completed: ${JSON.stringify(response)}`);
			// Note: Long-running operations might take time. Consider background polling or status checks.
			// For simplicity here, we log the start and move on. Check operation status separately if needed.
			return;
		} catch (apiError: any) {
			const delay = INITIAL_RETRY_DELAY_MS * RETRY_DELAY_MULTIPLIER ** attempt;
			logger.error(
				{
					functionName,
					err: { message: apiError.message, stack: apiError.stack, details: apiError.details }, // Assuming apiError might have 'details'
					attempt: attempt + 1,
					maxRetries: MAX_RETRIES,
					delay,
					documentCount: documents.length,
				},
				`API call failed for importDocumentsBatch (Attempt ${attempt + 1}/${MAX_RETRIES}). Retrying in ${delay}ms...`,
			);

			if (attempt < MAX_RETRIES - 1) {
				await sleep(delay);
			} else {
				logger.error(
					{
						functionName,
						err: { message: apiError.message, stack: apiError.stack, details: apiError.details },
						documentCount: documents.length,
						firstDocId: documents[0]?.id, // Log first doc ID for batch identification
					},
					`All ${MAX_RETRIES} retries failed for importDocumentsBatch. Rethrowing error.`,
				);
				throw apiError; // Rethrow the error to be handled by the caller of importDocumentsBatch
			}
		}
	}
}

// Example usage (called from index.ts)
// runIndexingPipeline('/path/to/your/codebase')
//   .then(() => console.log('Indexing finished.'))
//   .catch(err => console.error('Indexing failed:', err));
