import { VectorStoreConfig } from './config';

/**
 * Core interfaces for the vector search system
 * These interfaces provide abstraction for different implementations
 */

/**
 * Source location for a chunk within a file
 */
export interface ChunkSourceLocation {
	startLine: number;
	endLine: number;
	startCharOffset?: number;
	endCharOffset?: number;
}

/**
 * Raw chunk from AST-based or LLM-based chunking
 */
export interface RawChunk {
	content: string;
	sourceLocation: ChunkSourceLocation;
	chunkType: string; // e.g., 'function', 'class', 'import', 'block'
	metadata?: Record<string, any>;
}

/**
 * Chunk with contextual information added
 */
export interface ContextualizedChunk extends RawChunk {
	context: string; // LLM-generated context explaining the chunk
	contextualizedContent: string; // context + original content
}

/**
 * Chunk with file-level context
 */
export interface ChunkWithFile {
	filePath: string;
	language: string;
	chunk: RawChunk | ContextualizedChunk;
}

/**
 * Embedded chunk ready for vector store
 */
export interface EmbeddedChunk extends ChunkWithFile {
	/** Primary embedding (code or natural language) */
	embedding: number[];

	/** Secondary embedding (if dual embedding enabled) */
	secondaryEmbedding?: number[];

	/** Natural language description (if dual embedding enabled) */
	naturalLanguageDescription?: string;
}

/**
 * Search result from vector store
 */
export interface SearchResult {
	id: string;
	score: number;
	document: {
		filePath: string;
		functionName?: string;
		className?: string;
		startLine: number;
		endLine: number;
		language: string;
		naturalLanguageDescription?: string;
		originalCode: string;
		context?: string;
	};
	metadata?: {
		originalScore?: number;
		rerankingScore?: number;
		[key: string]: any;
	};
}

/**
 * File information for indexing
 */
export interface FileInfo {
	filePath: string;
	relativePath: string;
	language: string;
	content: string;
	size: number;
	lastModified: Date;
}

/**
 * Progress callback for long-running operations
 */
export interface ProgressInfo {
	phase: 'loading' | 'chunking' | 'contextualizing' | 'translating' | 'embedding' | 'indexing';
	currentFile?: string;
	filesProcessed: number;
	totalFiles: number;
	chunksProcessed?: number;
	totalChunks?: number;
	message?: string;
}

export type ProgressCallback = (progress: ProgressInfo) => void;

/**
 * Chunker interface - splits files into semantic chunks
 */
export interface IChunker {
	/**
	 * Chunk a file into semantic pieces
	 */
	chunk(file: FileInfo, config: VectorStoreConfig): Promise<RawChunk[]>;

	/**
	 * Get supported file extensions
	 */
	getSupportedExtensions(): string[];
}

/**
 * Contextualizer interface - adds context to chunks
 */
export interface IContextualizer {
	/**
	 * Add context to chunks using LLM
	 */
	contextualize(chunks: RawChunk[], fileInfo: FileInfo, config: VectorStoreConfig): Promise<ContextualizedChunk[]>;
}

/**
 * Code translator interface - converts code to natural language
 */
export interface ICodeTranslator {
	/**
	 * Translate code to natural language description
	 */
	translate(chunk: RawChunk | ContextualizedChunk, fileInfo: FileInfo): Promise<string>;

	/**
	 * Batch translate multiple chunks
	 */
	translateBatch(chunks: Array<RawChunk | ContextualizedChunk>, fileInfo: FileInfo): Promise<string[]>;
}

/**
 * Embedder interface - generates vector embeddings
 */
export interface IEmbedder {
	/**
	 * Generate embedding for a single text
	 */
	embed(text: string, taskType?: string): Promise<number[]>;

	/**
	 * Generate embeddings for multiple texts (batched)
	 */
	embedBatch(texts: string[], taskType?: string): Promise<number[][]>;

	/**
	 * Get embedding dimension
	 */
	getDimension(): number;

	/**
	 * Get model name
	 */
	getModel(): string;
}

/**
 * Vector store interface - storage and search
 */
export interface IVectorStore {
	/**
	 * Initialize the vector store
	 */
	initialize(config: VectorStoreConfig): Promise<void>;

	/**
	 * Index a batch of embedded chunks
	 */
	indexChunks(chunks: EmbeddedChunk[]): Promise<void>;

	/**
	 * Delete chunks by file path
	 */
	deleteByFilePath(filePath: string): Promise<void>;

	/**
	 * Search for similar chunks
	 */
	search(query: string, queryEmbedding: number[], maxResults: number, config: VectorStoreConfig): Promise<SearchResult[]>;

	/**
	 * Purge all data from the vector store
	 */
	purge(): Promise<void>;

	/**
	 * Get statistics about the vector store
	 */
	getStats(): Promise<{
		totalDocuments: number;
		totalChunks: number;
		storageSize?: number;
	}>;
}

/**
 * Synchronizer interface - incremental updates
 */
export interface ISynchronizer {
	/**
	 * Detect changes in repository
	 */
	detectChanges(repoRoot: string): Promise<{
		added: string[];
		modified: string[];
		deleted: string[];
	}>;

	/**
	 * Save snapshot of current state
	 */
	saveSnapshot(repoRoot: string, files: string[]): Promise<void>;

	/**
	 * Load previous snapshot
	 */
	loadSnapshot(repoRoot: string): Promise<string[] | null>;
}

/**
 * Reranker interface - post-search refinement
 */
export interface IReranker {
	/**
	 * Rerank search results
	 */
	rerank(query: string, results: SearchResult[], topK: number): Promise<SearchResult[]>;
}

/**
 * Search options for vector search operations
 * These can override config defaults at search-time
 */
export interface VectorSearchOptions {
	/** Maximum number of results to return */
	maxResults?: number;
	/** Filter results by file paths (partial match) */
	fileFilter?: string[];
	/** Filter results by programming language */
	languageFilter?: string[];
	/** Override config's hybridSearch setting for this query */
	hybridSearch?: boolean;
	/** Override config's reranking setting for this query */
	reranking?: boolean;
}

/**
 * Main orchestrator interface
 */
export interface IVectorSearchOrchestrator {
	/**
	 * Index a repository (full or incremental)
	 */
	indexRepository(
		repoRoot: string,
		options?: {
			subFolder?: string;
			incremental?: boolean;
			config?: VectorStoreConfig;
			onProgress?: ProgressCallback;
		},
	): Promise<void>;

	/**
	 * Search the indexed repository
	 */
	search(query: string, options?: VectorSearchOptions): Promise<SearchResult[]>;

	/**
	 * Get configuration
	 */
	getConfig(): VectorStoreConfig;

	/**
	 * Update configuration
	 */
	updateConfig(config: Partial<VectorStoreConfig>): void;
}
