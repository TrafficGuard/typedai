import pLimit from 'p-limit';
import pino from 'pino';
import { span } from '#o11y/trace';
import { ASTChunker } from '../chunking/astChunker';
import { readFilesToIndex } from '../codeLoader';
import { LLMCodeTranslator } from '../core/codeTranslator';
import { VectorStoreConfig, buildGoogleVectorServiceConfig, loadVectorConfig, printConfigSummary } from '../core/config';
import { LLMContextualizer } from '../core/contextualizer';
import { ContextualizedChunk, EmbeddedChunk, FileInfo, IVectorSearchOrchestrator, ProgressCallback, RawChunk, SearchResult } from '../core/interfaces';
import { MerkleSynchronizer } from '../sync/merkleSynchronizer';
import { DiscoveryEngineAdapter } from './discoveryEngineAdapter';
import { GoogleReranker } from './googleRerank';
import { FILE_PROCESSING_PARALLEL_BATCH_SIZE } from './googleVectorConfig';
import { GoogleVectorServiceConfig } from './googleVectorConfig';
import { DualEmbeddingGenerator, VertexEmbedderAdapter } from './vertexEmbedderAdapter';

const logger = pino({ name: 'VectorSearchOrchestrator' });

interface IndexingStats {
	fileCount: number;
	filesProcessed: number;
	failedFiles: string[];
	totalChunks: number;
	failedChunks: number;
}

/**
 * Main orchestrator for vector search
 * Implements configurable pipeline: chunking → contextualization → translation → embedding → indexing
 * Supports incremental updates via Merkle sync
 */
export class VectorSearchOrchestrator implements IVectorSearchOrchestrator {
	private config: VectorStoreConfig;
	private googleConfig: GoogleVectorServiceConfig;

	// Components
	private chunker: ASTChunker;
	private contextualizer: LLMContextualizer;
	private translator: LLMCodeTranslator;
	private embedder: VertexEmbedderAdapter;
	private dualEmbedder: DualEmbeddingGenerator;
	private vectorStore: DiscoveryEngineAdapter;
	private synchronizer: MerkleSynchronizer;
	private reranker: GoogleReranker;

	constructor(googleConfig: GoogleVectorServiceConfig, config?: VectorStoreConfig) {
		this.googleConfig = googleConfig;
		this.config = config || {
			dualEmbedding: false,
			contextualChunking: false,
		};

		// Initialize components
		this.chunker = new ASTChunker();
		this.contextualizer = new LLMContextualizer();
		this.translator = new LLMCodeTranslator();
		this.embedder = new VertexEmbedderAdapter(googleConfig);
		this.dualEmbedder = new DualEmbeddingGenerator(this.embedder);
		this.vectorStore = new DiscoveryEngineAdapter(googleConfig);
		this.synchronizer = new MerkleSynchronizer(this.config.includePatterns);
		this.reranker = new GoogleReranker(googleConfig, {
			model: this.config.rerankingModel,
		});
	}

	@span()
	async indexRepository(
		repoRoot: string,
		options?: {
			subFolder?: string;
			incremental?: boolean;
			config?: VectorStoreConfig;
			onProgress?: ProgressCallback;
		},
	): Promise<void> {
		const startTime = Date.now();

		// Load config from repository if not provided
		if (!options?.config) {
			this.config = loadVectorConfig(repoRoot);
		} else {
			this.config = { ...this.config, ...options.config };
		}

		printConfigSummary(this.config);

		// Rebuild Google config from merged VectorStoreConfig (allows per-config GCP settings)
		this.googleConfig = buildGoogleVectorServiceConfig(this.config);

		// Recreate components with updated config
		this.embedder = new VertexEmbedderAdapter(this.googleConfig);
		this.dualEmbedder = new DualEmbeddingGenerator(this.embedder);
		this.vectorStore = new DiscoveryEngineAdapter(this.googleConfig);
		this.reranker = new GoogleReranker(this.googleConfig, {
			model: this.config.rerankingModel,
		});

		// Initialize vector store
		await this.vectorStore.initialize(this.config);

		logger.info({ repoRoot, incremental: options?.incremental }, 'Starting repository indexing');

		// Get files to index
		let filesToIndex: string[];

		if (options?.incremental) {
			// Incremental update using Merkle sync
			logger.info('Performing incremental update using Merkle sync');
			const changes = await this.synchronizer.detectChanges(repoRoot);

			filesToIndex = [...changes.added, ...changes.modified];

			// Delete removed files from vector store
			for (const deletedFile of changes.deleted) {
				await this.vectorStore.deleteByFilePath(deletedFile);
			}

			logger.info(
				{
					added: changes.added.length,
					modified: changes.modified.length,
					deleted: changes.deleted.length,
				},
				'Incremental changes detected',
			);

			if (filesToIndex.length === 0) {
				logger.info('No files to index, exiting');
				return;
			}
		} else {
			// Full indexing
			logger.info('Performing full repository indexing');
			const codeFiles = await readFilesToIndex(repoRoot, options?.subFolder || './', this.config.includePatterns);
			filesToIndex = codeFiles.map((f) => f.filePath);
			logger.info({ fileCount: codeFiles.length }, 'Loaded code files');
		}

		if (filesToIndex.length === 0) {
			logger.info('No files to index');
			return;
		}

		// Index files
		await this.indexFiles(repoRoot, filesToIndex, options?.onProgress);

		// Save snapshot for incremental updates
		await this.synchronizer.saveSnapshot(repoRoot, filesToIndex);

		const duration = Date.now() - startTime;
		logger.info({ duration, fileCount: filesToIndex.length }, 'Repository indexing completed');
	}

	async search(
		query: string,
		options?: {
			maxResults?: number;
			fileFilter?: string[];
			languageFilter?: string[];
		},
	): Promise<SearchResult[]> {
		const maxResults = options?.maxResults || 10;

		logger.info({ query, maxResults, reranking: this.config.reranking }, 'Performing search');

		// Generate query embedding
		const queryEmbedding = await this.dualEmbedder.generateQueryEmbedding(query, this.config);

		// Search vector store (get more results if reranking is enabled)
		const rerankingTopK = this.config.rerankingTopK || 50;
		const searchLimit = this.config.reranking ? Math.max(maxResults * 2, rerankingTopK) : maxResults;
		const results = await this.vectorStore.search(query, queryEmbedding, searchLimit, this.config);

		// Apply filters if provided
		let filteredResults = results;

		if (options?.fileFilter && options.fileFilter.length > 0) {
			filteredResults = filteredResults.filter((r) => options.fileFilter!.some((filter) => r.document.filePath.includes(filter)));
		}

		if (options?.languageFilter && options.languageFilter.length > 0) {
			filteredResults = filteredResults.filter((r) => options.languageFilter!.includes(r.document.language));
		}

		// Apply reranking if enabled
		let finalResults = filteredResults;

		if (this.config.reranking && filteredResults.length > 0) {
			logger.info({ inputCount: filteredResults.length, maxResults, rerankingTopK }, 'Applying reranking');
			finalResults = await this.reranker.rerank(query, filteredResults, maxResults);
		} else {
			// Limit to maxResults if not reranking
			finalResults = filteredResults.slice(0, maxResults);
		}

		logger.info({ resultCount: finalResults.length, reranked: this.config.reranking }, 'Search completed');

		return finalResults;
	}

	getConfig(): VectorStoreConfig {
		return this.config;
	}

	updateConfig(config: Partial<VectorStoreConfig>): void {
		this.config = { ...this.config, ...config };
		logger.info({ config: this.config }, 'Configuration updated');
	}

	/**
	 * Index multiple files in parallel
	 */
	private async indexFiles(repoRoot: string, filePaths: string[], onProgress?: ProgressCallback): Promise<void> {
		const stats: IndexingStats = {
			fileCount: filePaths.length,
			filesProcessed: 0,
			failedFiles: [],
			totalChunks: 0,
			failedChunks: 0,
		};

		const limit = pLimit(FILE_PROCESSING_PARALLEL_BATCH_SIZE);

		logger.info({ fileCount: filePaths.length, concurrency: FILE_PROCESSING_PARALLEL_BATCH_SIZE }, 'Starting parallel file indexing');

		const processingPromises = filePaths.map((filePath) =>
			limit(async () => {
				try {
					onProgress?.({
						phase: 'loading',
						currentFile: filePath,
						filesProcessed: stats.filesProcessed,
						totalFiles: stats.fileCount,
					});

					// Load file
					const fileInfo = await this.loadFile(repoRoot, filePath);

					// Process file through pipeline
					const chunks = await this.processFile(fileInfo, stats, onProgress);

					if (chunks.length > 0) {
						// Index chunks
						onProgress?.({
							phase: 'indexing',
							currentFile: filePath,
							filesProcessed: stats.filesProcessed,
							totalFiles: stats.fileCount,
							chunksProcessed: chunks.length,
						});

						await this.vectorStore.indexChunks(chunks);
						stats.totalChunks += chunks.length;
					}

					stats.filesProcessed++;

					logger.debug({ filePath, chunkCount: chunks.length }, 'File indexed successfully');
				} catch (error) {
					stats.failedFiles.push(filePath);
					logger.error({ error, filePath }, 'Failed to process file');
				}
			}),
		);

		await Promise.all(processingPromises);

		logger.info(
			{
				filesProcessed: stats.filesProcessed,
				failedFiles: stats.failedFiles.length,
				totalChunks: stats.totalChunks,
				failedChunks: stats.failedChunks,
			},
			'File indexing completed',
		);
	}

	/**
	 * Process a single file through the complete pipeline
	 */
	private async processFile(fileInfo: FileInfo, stats: IndexingStats, onProgress?: ProgressCallback): Promise<EmbeddedChunk[]> {
		try {
			let chunks: Array<RawChunk | ContextualizedChunk>;

			// With contextual chunking enabled, LLM does both chunking and contextualization in one call
			if (this.config.contextualChunking) {
				onProgress?.({
					phase: 'contextualizing',
					currentFile: fileInfo.filePath,
					filesProcessed: stats.filesProcessed,
					totalFiles: stats.fileCount,
				});

				// Single-call LLM chunking + contextualization (no AST chunking needed)
				chunks = await this.contextualizer.contextualize([], fileInfo, this.config);

				if (chunks.length === 0) {
					logger.debug({ filePath: fileInfo.filePath }, 'No chunks generated from LLM');
					return [];
				}
			} else {
				// Traditional flow: AST-based chunking without contextualization
				onProgress?.({
					phase: 'chunking',
					currentFile: fileInfo.filePath,
					filesProcessed: stats.filesProcessed,
					totalFiles: stats.fileCount,
				});

				const rawChunks = await this.chunker.chunk(fileInfo, this.config);

				if (rawChunks.length === 0) {
					logger.debug({ filePath: fileInfo.filePath }, 'No chunks generated');
					return [];
				}

				chunks = rawChunks;
			}

			// 3. Translation (optional, based on config)
			let naturalLanguageDescriptions: string[] = [];

			if (this.config.dualEmbedding) {
				onProgress?.({
					phase: 'translating',
					currentFile: fileInfo.filePath,
					filesProcessed: stats.filesProcessed,
					totalFiles: stats.fileCount,
					chunksProcessed: 0,
					totalChunks: chunks.length,
				});

				naturalLanguageDescriptions = await this.translator.translateBatch(chunks, fileInfo);
			}

			// 4. Embedding (dual or single based on config)
			onProgress?.({
				phase: 'embedding',
				currentFile: fileInfo.filePath,
				filesProcessed: stats.filesProcessed,
				totalFiles: stats.fileCount,
				chunksProcessed: 0,
				totalChunks: chunks.length,
			});

			const embeddedChunks = await this.generateEmbeddings(chunks, naturalLanguageDescriptions, fileInfo);

			return embeddedChunks;
		} catch (error) {
			logger.error({ error, filePath: fileInfo.filePath }, 'Error processing file');
			return [];
		}
	}

	/**
	 * Generate embeddings for chunks (dual or single based on config)
	 */
	private async generateEmbeddings(
		chunks: Array<RawChunk | ContextualizedChunk>,
		naturalLanguageDescriptions: string[],
		fileInfo: FileInfo,
	): Promise<EmbeddedChunk[]> {
		const embeddedChunks: EmbeddedChunk[] = [];

		for (let i = 0; i < chunks.length; i++) {
			const chunk = chunks[i];

			try {
				// Get the text to embed (contextualized if available)
				const textToEmbed = 'contextualizedContent' in chunk ? chunk.contextualizedContent : chunk.content;

				const nlDescription = naturalLanguageDescriptions[i] || '';

				// Generate embeddings (dual or single)
				const embeddings = await this.dualEmbedder.generateDualEmbeddings(textToEmbed, nlDescription || textToEmbed, this.config);

				embeddedChunks.push({
					filePath: fileInfo.filePath,
					language: fileInfo.language,
					chunk,
					embedding: this.config.dualEmbedding ? embeddings.naturalLanguageEmbedding : embeddings.codeEmbedding,
					secondaryEmbedding: this.config.dualEmbedding ? embeddings.codeEmbedding : undefined,
					naturalLanguageDescription: nlDescription || undefined,
				});
			} catch (error) {
				logger.warn({ error, filePath: fileInfo.filePath, chunkIndex: i }, 'Failed to generate embedding for chunk');
			}
		}

		return embeddedChunks;
	}

	/**
	 * Load file information
	 */
	private async loadFile(repoRoot: string, filePath: string): Promise<FileInfo> {
		const fs = require('node:fs/promises');
		const path = require('node:path');

		const fullPath = path.join(repoRoot, filePath);
		const content = await fs.readFile(fullPath, 'utf-8');
		const stat = await fs.stat(fullPath);
		const ext = path.extname(filePath);
		const language = this.detectLanguage(ext);

		return {
			filePath: fullPath,
			relativePath: filePath,
			language,
			content,
			size: stat.size,
			lastModified: stat.mtime,
		};
	}

	/**
	 * Detect programming language from file extension
	 */
	private detectLanguage(extension: string): string {
		const langMap: Record<string, string> = {
			'.ts': 'typescript',
			'.tsx': 'typescript',
			'.js': 'javascript',
			'.jsx': 'javascript',
			'.py': 'python',
			'.java': 'java',
			'.cpp': 'cpp',
			'.c': 'c',
			'.h': 'cpp',
			'.go': 'go',
			'.rs': 'rust',
			'.rb': 'ruby',
			'.php': 'php',
			'.cs': 'csharp',
			'.swift': 'swift',
			'.kt': 'kotlin',
			'.scala': 'scala',
		};

		return langMap[extension] || 'unknown';
	}

	/**
	 * Purge all documents and reset
	 */
	async purgeAll(): Promise<void> {
		logger.warn('Purging all documents');
		await this.vectorStore.purge();
	}

	/**
	 * Delete data store
	 */
	async deleteDataStore(): Promise<void> {
		logger.warn('Deleting data store');
		await this.vectorStore.deleteDataStore();
	}

	/**
	 * DIAGNOSTIC: List all documents in the data store
	 */
	async listDocuments(pageSize = 100): Promise<any[]> {
		return await this.vectorStore.listDocuments(pageSize);
	}

	/**
	 * DIAGNOSTIC: Get a specific document by ID
	 */
	async getDocument(documentId: string): Promise<any> {
		return await this.vectorStore.getDocument(documentId);
	}

	/**
	 * DIAGNOSTIC: Get data store info
	 */
	async getDataStoreInfo(): Promise<any> {
		return await this.vectorStore.getDataStoreInfo();
	}
}
