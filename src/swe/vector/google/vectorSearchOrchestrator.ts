import * as path from 'node:path';
import pLimit from 'p-limit';
import pino from 'pino';
import { span } from '#o11y/trace';
import { ASTChunker } from '../chunking/astChunker';
import { readFilesToIndex } from '../codeLoader';
import { batchIndexFiles } from '../core/batchIndexer';
import { logChunksToDisk } from '../core/chunkLogger';
import { LLMCodeTranslator } from '../core/codeTranslator';
import {
	RerankingConfig,
	VectorStoreConfig,
	addOrUpdateVectorConfig,
	buildGoogleVectorServiceConfig,
	loadVectorConfig,
	printConfigSummary,
} from '../core/config';
import { LLMContextualizer } from '../core/contextualizer';
import type { IReranker } from '../core/interfaces';
import {
	ContextualizedChunk,
	EmbeddedChunk,
	FileInfo,
	IVectorSearchOrchestrator,
	ProgressCallback,
	RawChunk,
	SearchResult,
	VectorSearchOptions,
} from '../core/interfaces';
import { createReranker } from '../reranking';
import { MerkleSynchronizer } from '../sync/merkleSynchronizer';
import { DiscoveryEngineAdapter } from './discoveryEngineAdapter';
import { GcpQuotaCircuitBreaker } from './gcpQuotaCircuitBreaker';
import {
	CIRCUIT_BREAKER_FAILURE_THRESHOLD,
	CIRCUIT_BREAKER_RETRY_INTERVAL_MS,
	CIRCUIT_BREAKER_SUCCESS_THRESHOLD,
	FILE_PROCESSING_PARALLEL_BATCH_SIZE,
} from './googleVectorConfig';
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
	private _reranker: IReranker | null = null;
	private _rerankerConfig: RerankingConfig | null = null;
	private readonly DEFAULT_CONFIG = {
		chunking: {
			dualEmbedding: false,
			contextualChunking: false,
		},
	};

	// Circuit breaker for LLM services (contextualization, translation)
	private llmCircuitBreaker: GcpQuotaCircuitBreaker;

	constructor(googleConfig: GoogleVectorServiceConfig, config?: VectorStoreConfig) {
		this.googleConfig = googleConfig;
		this.config = config || this.DEFAULT_CONFIG;

		// Create shared circuit breaker for LLM services
		this.llmCircuitBreaker = new GcpQuotaCircuitBreaker({
			serviceName: 'LLM Service',
			retryIntervalMs: CIRCUIT_BREAKER_RETRY_INTERVAL_MS,
			failureThreshold: CIRCUIT_BREAKER_FAILURE_THRESHOLD,
			successThreshold: CIRCUIT_BREAKER_SUCCESS_THRESHOLD,
		});

		// Initialize components
		this.chunker = new ASTChunker();
		this.contextualizer = new LLMContextualizer(undefined, this.llmCircuitBreaker);
		this.translator = new LLMCodeTranslator(undefined, this.llmCircuitBreaker);
		this.embedder = new VertexEmbedderAdapter(googleConfig);
		this.dualEmbedder = new DualEmbeddingGenerator(this.embedder);
		this.vectorStore = new DiscoveryEngineAdapter(googleConfig);
		this.synchronizer = new MerkleSynchronizer(this.config.includePatterns);
		// Reranker is created lazily via getReranker()
	}

	/**
	 * Get or create reranker based on current config
	 * Returns null if reranking is disabled
	 */
	private getReranker(): IReranker | null {
		const config = this.config.search?.reranking;
		if (!config) return null;

		// Check if we need to create/recreate reranker
		if (!this._reranker || !this.configsEqual(this._rerankerConfig, config)) {
			this._reranker = createReranker(config, this.googleConfig, this.config.ollama);
			this._rerankerConfig = config;
		}
		return this._reranker;
	}

	/**
	 * Check if two reranking configs are equivalent
	 */
	private configsEqual(a: RerankingConfig | null, b: RerankingConfig | null): boolean {
		if (a === b) return true;
		if (!a || !b) return false;
		return a.provider === b.provider && a.model === b.model && a.topK === b.topK;
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
		// Reranker will be recreated lazily on next search if config changed
		this._reranker = null;
		this._rerankerConfig = null;

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

		// Mark repository as indexed in config
		addOrUpdateVectorConfig(repoRoot, { ...this.config, indexed: true });

		const duration = Date.now() - startTime;
		logger.info({ duration, fileCount: filesToIndex.length }, 'Repository indexing completed, indexed=true set');
	}

	/**
	 * Batch-friendly repository indexing with resumable state file.
	 * Intended for long-running initial indexing where partial progress may need to resume.
	 */
	async indexRepositoryBatch(
		repoRoot: string,
		options?: {
			subFolder?: string;
			config?: VectorStoreConfig;
			stateFilePath?: string;
			concurrency?: number;
			continueOnError?: boolean;
			onProgress?: ProgressCallback;
		},
	): Promise<void> {
		// Load config
		this.config = options?.config ? { ...this.DEFAULT_CONFIG, ...options.config } : loadVectorConfig(repoRoot);
		printConfigSummary(this.config);

		// rebuild google config and components
		this.googleConfig = buildGoogleVectorServiceConfig(this.config);
		this.embedder = new VertexEmbedderAdapter(this.googleConfig);
		this.dualEmbedder = new DualEmbeddingGenerator(this.embedder);
		this.vectorStore = new DiscoveryEngineAdapter(this.googleConfig);
		// Reranker will be recreated lazily on next search if config changed
		this._reranker = null;
		this._rerankerConfig = null;
		this.chunker = new ASTChunker();
		this.contextualizer = new LLMContextualizer(undefined, this.llmCircuitBreaker);
		this.translator = new LLMCodeTranslator(undefined, this.llmCircuitBreaker);

		await this.vectorStore.initialize(this.config);

		const codeFiles = await readFilesToIndex(repoRoot, options?.subFolder || './', this.config.includePatterns);
		if (!codeFiles.length) {
			logger.info('No files to index');
			return;
		}

		const files: FileInfo[] = await Promise.all(
			codeFiles.map(async (cf) => {
				const fs = require('node:fs/promises');
				const stat = await fs.stat(path.join(repoRoot, cf.filePath));
				const extension = path.extname(cf.filePath);
				return {
					filePath: path.join(repoRoot, cf.filePath),
					relativePath: cf.filePath,
					language: this.detectLanguage(extension),
					content: cf.content,
					size: stat.size,
					lastModified: stat.mtime,
				};
			}),
		);

		await batchIndexFiles(
			files,
			{
				chunker: this.chunker,
				contextualizer: this.contextualizer,
				translator: this.translator,
				embedder: this.dualEmbedder,
				vectorStore: this.vectorStore,
				logChunks: this.config.logChunks ? logChunksToDisk : undefined,
			},
			{
				config: this.config,
				concurrency: options?.concurrency,
				continueOnError: options?.continueOnError ?? true,
				progress: options?.onProgress,
				repoRoot,
				stateFilePath: options?.stateFilePath,
			},
		);
	}

	async search(query: string, options?: VectorSearchOptions): Promise<SearchResult[]> {
		const maxResults = options?.maxResults || 10;

		// Resolve reranking configuration
		const rerankConfig = this.config.search?.reranking;
		const useReranking = !!rerankConfig;
		const rerankingTopK = rerankConfig?.topK ?? 50;

		logger.info({ query, maxResults, reranking: useReranking, rerankingProvider: rerankConfig?.provider }, 'Performing search');

		// Generate query embedding
		const queryEmbedding = await this.dualEmbedder.generateQueryEmbedding(query, this.config);

		// Search vector store (get more results if reranking is enabled)
		const searchLimit = useReranking ? Math.max(maxResults * 2, rerankingTopK) : maxResults;
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

		if (useReranking && filteredResults.length > 0) {
			const reranker = this.getReranker();
			if (reranker) {
				logger.info({ inputCount: filteredResults.length, maxResults, rerankingTopK }, 'Applying reranking');
				finalResults = await reranker.rerank(query, filteredResults, maxResults);
			} else {
				finalResults = filteredResults.slice(0, maxResults);
			}
		} else {
			// Limit to maxResults if not reranking
			finalResults = filteredResults.slice(0, maxResults);
		}

		logger.info({ resultCount: finalResults.length, reranked: useReranking }, 'Search completed');

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
					const chunks = await this.processFile(fileInfo, repoRoot, stats, onProgress);

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
	private async processFile(fileInfo: FileInfo, repoRoot: string, stats: IndexingStats, onProgress?: ProgressCallback): Promise<EmbeddedChunk[]> {
		try {
			let chunks: Array<RawChunk | ContextualizedChunk>;

			// With contextual chunking enabled, LLM does both chunking and contextualization in one call
			if (this.config.chunking?.contextualChunking) {
				onProgress?.({
					phase: 'contextualizing',
					currentFile: fileInfo.filePath,
					filesProcessed: stats.filesProcessed,
					totalFiles: stats.fileCount,
				});

				// Single-call LLM chunking + contextualization (no AST chunking needed)
				chunks = await this.contextualizer.contextualize([], fileInfo, this.config);

				if (chunks.length === 0) {
					logger.info({ filePath: fileInfo.filePath }, 'No chunks generated from LLM');
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
					logger.info({ filePath: fileInfo.filePath }, 'No chunks generated');
					return [];
				}

				chunks = rawChunks;
			}

			// Log chunks to disk if enabled
			if (this.config.logChunks) {
				await logChunksToDisk(chunks, fileInfo.filePath, repoRoot);
			}

			// 3. Translation (optional, based on config)
			let naturalLanguageDescriptions: string[] = [];

			if (this.config.chunking?.dualEmbedding) {
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
	 * Rate limiting and circuit breaker protection handled at the embedding service layer
	 */
	private async generateEmbeddings(
		chunks: Array<RawChunk | ContextualizedChunk>,
		naturalLanguageDescriptions: string[],
		fileInfo: FileInfo,
	): Promise<EmbeddedChunk[]> {
		const embeddingPromises = chunks.map(async (chunk, i) => {
			try {
				// Get the text to embed (contextualized if available)
				const textToEmbed = 'contextualizedContent' in chunk ? chunk.contextualizedContent : chunk.content;

				const nlDescription = naturalLanguageDescriptions[i] || '';

				// Generate embeddings (dual or single)
				const embeddings = await this.dualEmbedder.generateDualEmbeddings(textToEmbed, nlDescription || textToEmbed, this.config);

				return {
					filePath: fileInfo.filePath,
					language: fileInfo.language,
					chunk,
					embedding: this.config.chunking?.dualEmbedding ? embeddings.naturalLanguageEmbedding : embeddings.codeEmbedding,
					secondaryEmbedding: this.config.chunking?.dualEmbedding ? embeddings.codeEmbedding : undefined,
					naturalLanguageDescription: nlDescription || undefined,
				};
			} catch (error) {
				logger.warn({ error, filePath: fileInfo.filePath, chunkIndex: i }, 'Failed to generate embedding for chunk');
				return null;
			}
		});

		const results = await Promise.all(embeddingPromises);

		// Filter out failed embeddings (null values)
		return results.filter((result) => result !== null) as EmbeddedChunk[];
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
