import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import pLimit from 'p-limit';
import { logger } from '#o11y/logger';
import { span } from '#o11y/trace';
import { ASTChunker } from '../chunking/astChunker';
import { readFilesToIndex } from '../codeLoader';
import { LLMCodeTranslator } from '../core/codeTranslator';
import type { RerankingConfig, VectorStoreConfig } from '../core/config';
import { addOrUpdateVectorConfig, loadVectorConfig, printConfigSummary } from '../core/config';
import { buildGoogleVectorServiceConfig } from '../core/config';
import { LLMContextualizer } from '../core/contextualizer';
import type { IReranker } from '../core/interfaces';
import type {
	ContextualizedChunk,
	EmbeddedChunk,
	FileInfo,
	IVectorSearchOrchestrator,
	ProgressCallback,
	RawChunk,
	SearchResult,
	VectorSearchOptions,
} from '../core/interfaces';
import { FILE_PROCESSING_PARALLEL_BATCH_SIZE } from '../google/googleVectorConfig';
import type { GoogleVectorServiceConfig } from '../google/googleVectorConfig';
import { DualEmbeddingGenerator, VertexEmbedderAdapter } from '../google/vertexEmbedderAdapter';
import { createReranker } from '../reranking';
import { MerkleSynchronizer } from '../sync/merkleSynchronizer';
import { AlloyDBAdapter } from './alloydbAdapter';
import type { AlloyDBConfig } from './alloydbConfig';
import { buildAlloyDBConfig } from './alloydbConfig';

interface IndexingStats {
	fileCount: number;
	filesProcessed: number;
	failedFiles: string[];
	totalChunks: number;
	failedChunks: number;
}

/**
 * AlloyDB vector search orchestrator
 * Implements configurable pipeline: chunking → contextualization → embedding → indexing
 * Uses AlloyDB automated embeddings for simplified embedding management
 * Supports incremental updates via Merkle sync
 */
export class AlloyDBOrchestrator implements IVectorSearchOrchestrator {
	private config: VectorStoreConfig;
	private alloydbConfig: AlloyDBConfig;
	private googleConfig: GoogleVectorServiceConfig; // For Vertex AI embedding (if dual embedding)
	private repoIdentifier: string;

	// Components
	private chunker: ASTChunker;
	private contextualizer: LLMContextualizer;
	private translator: LLMCodeTranslator;
	private embedder: VertexEmbedderAdapter; // Only for dual embedding (code embedding)
	private dualEmbedder: DualEmbeddingGenerator;
	private vectorStore: AlloyDBAdapter;
	private synchronizer: MerkleSynchronizer;
	private _reranker: IReranker | null = null;
	private _rerankerConfig: RerankingConfig | null = null;

	constructor(repoIdentifier: string, alloydbConfig: AlloyDBConfig, config?: VectorStoreConfig) {
		this.repoIdentifier = repoIdentifier;
		this.alloydbConfig = alloydbConfig;
		this.config = config || {
			chunking: {
				dualEmbedding: false,
				contextualChunking: false,
			},
		};

		// Build Google config for reranking and dual embedding support
		this.googleConfig = buildGoogleVectorServiceConfig(this.config);

		// Initialize components
		this.chunker = new ASTChunker();
		this.contextualizer = new LLMContextualizer();
		this.translator = new LLMCodeTranslator();
		this.embedder = new VertexEmbedderAdapter(this.googleConfig);
		this.dualEmbedder = new DualEmbeddingGenerator(this.embedder);
		this.vectorStore = new AlloyDBAdapter(repoIdentifier, alloydbConfig);
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

		// Rebuild configs from merged VectorStoreConfig
		this.alloydbConfig = buildAlloyDBConfig(this.config);
		this.googleConfig = buildGoogleVectorServiceConfig(this.config);

		// Recreate components with updated config
		this.embedder = new VertexEmbedderAdapter(this.googleConfig);
		this.dualEmbedder = new DualEmbeddingGenerator(this.embedder);
		this.vectorStore = new AlloyDBAdapter(this.repoIdentifier, this.alloydbConfig);
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

			// Delete removed files from vector store (transactional)
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

	async search(query: string, options?: VectorSearchOptions): Promise<SearchResult[]> {
		const maxResults = options?.maxResults || 10;

		// Resolve reranking configuration
		const rerankConfig = this.config.search?.reranking;
		const useReranking = !!rerankConfig;
		const rerankingTopK = rerankConfig?.topK ?? 50;
		const useHybridSearch = options?.hybridSearch ?? this.config.search?.hybridSearch ?? true;

		logger.info({ query, maxResults, reranking: useReranking, rerankingProvider: rerankConfig?.provider, hybridSearch: useHybridSearch }, 'Performing search');

		const requiresQueryEmbedding = !this.vectorStore.supportsAutomatedEmbeddings();
		const queryEmbedding = requiresQueryEmbedding ? await this.dualEmbedder.generateQueryEmbedding(query, this.config) : [];

		// Search vector store (get more results if reranking is enabled)
		const searchLimit = useReranking ? Math.max(maxResults * 2, rerankingTopK) : maxResults;

		// Create a config with the effective hybridSearch value for this query
		const searchConfig = { ...this.config, search: { ...this.config.search, hybridSearch: useHybridSearch } };
		const results = await this.vectorStore.search(query, queryEmbedding, searchLimit, searchConfig);

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
	 *
	 * Embedding Strategy:
	 * - If AlloyDB automated embeddings are available (preview feature): AlloyDB generates embeddings automatically
	 * - If not available (e.g., AlloyDB Omni): Manual embedding via Vertex AI
	 */
	private async processFile(fileInfo: FileInfo, stats: IndexingStats, onProgress?: ProgressCallback): Promise<EmbeddedChunk[]> {
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

			// Generate embeddings for contextualized chunks
			// Note: If AlloyDB automated embeddings are available, this will be ignored
			// If not (e.g., AlloyDB Omni), these embeddings will be used
			const requiresManualEmbedding = !this.vectorStore.supportsAutomatedEmbeddings();
			let primaryEmbeddings: number[][] = [];
			let codeEmbeddings: number[][] = [];

			onProgress?.({
				phase: 'embedding',
				currentFile: fileInfo.filePath,
				filesProcessed: stats.filesProcessed,
				totalFiles: stats.fileCount,
				chunksProcessed: 0,
				totalChunks: chunks.length,
			});

			// Generate embeddings for contextualized content (used if auto-embedding unavailable)
			const contextualizedTexts = chunks.map((chunk) => ('contextualizedContent' in chunk ? chunk.contextualizedContent : chunk.content));
			if (requiresManualEmbedding) {
				primaryEmbeddings = await this.embedder.embedBatch(contextualizedTexts, 'RETRIEVAL_DOCUMENT');
			} else {
				primaryEmbeddings = contextualizedTexts.map(() => []);
			}

			// Dual embedding: generate code embedding for separate column (optional)
			if (this.config.chunking?.dualEmbedding) {
				const codeTexts = chunks.map((chunk) => chunk.content);
				codeEmbeddings = await this.embedder.embedBatch(codeTexts, 'RETRIEVAL_DOCUMENT');
				logger.debug({ chunkCount: chunks.length }, 'Generated dual embeddings (contextual + code)');
			} else {
				logger.debug({ chunkCount: chunks.length }, 'Generated contextual embeddings');
			}

			// Build EmbeddedChunk objects
			const embeddedChunks: EmbeddedChunk[] = chunks.map((chunk, index) => ({
				filePath: fileInfo.filePath,
				language: fileInfo.language,
				chunk,
				embedding: primaryEmbeddings[index], // Used if AlloyDB auto-embedding unavailable
				secondaryEmbedding: this.config.chunking?.dualEmbedding ? codeEmbeddings[index] : undefined,
			}));

			return embeddedChunks;
		} catch (error) {
			logger.error({ error, filePath: fileInfo.filePath }, 'Failed to process file');
			throw error;
		}
	}

	/**
	 * Load a file from disk
	 */
	private async loadFile(repoRoot: string, filePath: string): Promise<FileInfo> {
		const fullPath = path.join(repoRoot, filePath);
		const content = await fs.readFile(fullPath, 'utf-8');
		const stats = await fs.stat(fullPath);

		// Detect language from file extension
		const ext = path.extname(filePath);
		const language = this.detectLanguage(ext);

		return {
			filePath,
			relativePath: filePath,
			language,
			content,
			size: stats.size,
			lastModified: stats.mtime,
		};
	}

	/**
	 * Detect programming language from file extension
	 */
	private detectLanguage(extension: string): string {
		const languageMap: Record<string, string> = {
			'.ts': 'typescript',
			'.tsx': 'typescript',
			'.js': 'javascript',
			'.jsx': 'javascript',
			'.py': 'python',
			'.java': 'java',
			'.cpp': 'cpp',
			'.c': 'c',
			'.h': 'c',
			'.go': 'go',
			'.rs': 'rust',
			'.rb': 'ruby',
			'.php': 'php',
			'.cs': 'csharp',
			'.swift': 'swift',
			'.kt': 'kotlin',
		};

		return languageMap[extension.toLowerCase()] || 'unknown';
	}

	/**
	 * Close all connections
	 */
	async close(): Promise<void> {
		await this.vectorStore.close();
	}
}
