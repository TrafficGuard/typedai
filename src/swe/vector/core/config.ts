import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * Core vector store configuration for repository indexing
 */
export interface VectorStoreConfig {
	/** Enable dual embedding (code + natural language translation) - ~12% better retrieval */
	dualEmbedding: boolean;

	/** Enable contextual chunking (LLM-generated context) - ~49-67% better retrieval */
	contextualChunking: boolean;

	/** Chunk size in characters (default: 2500) */
	chunkSize?: number;

	/** Chunk overlap in characters (default: 300) */
	chunkOverlap?: number;

	/** Chunking strategy: 'ast' (fast, semantic) or 'llm' (slow, high quality) */
	chunkStrategy?: 'ast' | 'llm';

	/** Embedding provider: 'vertex' | 'openai' | 'voyage' | 'cohere' */
	embeddingProvider?: string;

	/** Embedding model name */
	embeddingModel?: string;

	/** Enable hybrid search (vector + BM25 lexical) */
	hybridSearch?: boolean;

	/** Enable reranking for search results */
	reranking?: boolean;

	/** Reranking model (default: 'semantic-ranker-512@latest') */
	rerankingModel?: string;

	/** Number of candidates to rerank (default: 50, max: 200) */
	rerankingTopK?: number;

	/** File/directory patterns to include (glob patterns, e.g., ['src/**', 'lib/**']) */
	includePatterns?: string[];

	/** Maximum file size in bytes to index (default: 1MB) */
	maxFileSize?: number;

	/** Supported file extensions to index */
	fileExtensions?: string[];
}

/**
 * Default configuration - fast and cost-effective
 */
export const DEFAULT_VECTOR_CONFIG: VectorStoreConfig = {
	dualEmbedding: false,
	contextualChunking: false,
	chunkSize: 2500,
	chunkOverlap: 300,
	chunkStrategy: 'ast',
	embeddingProvider: 'vertex',
	embeddingModel: 'gemini-embedding-001',
	hybridSearch: true,
	reranking: false,
	maxFileSize: 1024 * 1024, // 1MB
	fileExtensions: ['.ts', '.tsx', '.js', '.jsx', '.py', '.java', '.cpp', '.c', '.h', '.go', '.rs', '.rb', '.php', '.cs', '.swift', '.kt'],
};

/**
 * High quality configuration - enables all quality features
 */
export const HIGH_QUALITY_CONFIG: VectorStoreConfig = {
	...DEFAULT_VECTOR_CONFIG,
	dualEmbedding: true,
	contextualChunking: true,
	reranking: true,
};

/**
 * Load vector store configuration from repository
 * Checks for .vectorconfig.json or vectorStore field in package.json
 */
export function loadVectorConfig(repoRoot: string): VectorStoreConfig {
	// Try .vectorconfig.json first
	const vectorConfigPath = path.join(repoRoot, '.vectorconfig.json');
	if (fs.existsSync(vectorConfigPath)) {
		try {
			const configContent = fs.readFileSync(vectorConfigPath, 'utf-8');
			const config = JSON.parse(configContent);
			return { ...DEFAULT_VECTOR_CONFIG, ...config };
		} catch (error) {
			console.warn(`Failed to parse .vectorconfig.json: ${error}`);
		}
	}

	// Try package.json vectorStore field
	const packageJsonPath = path.join(repoRoot, 'package.json');
	if (fs.existsSync(packageJsonPath)) {
		try {
			const packageContent = fs.readFileSync(packageJsonPath, 'utf-8');
			const packageJson = JSON.parse(packageContent);
			if (packageJson.vectorStore) {
				return { ...DEFAULT_VECTOR_CONFIG, ...packageJson.vectorStore };
			}
		} catch (error) {
			console.warn(`Failed to parse package.json: ${error}`);
		}
	}

	// Return default config
	return DEFAULT_VECTOR_CONFIG;
}

/**
 * Save vector store configuration to repository
 */
export function saveVectorConfig(repoRoot: string, config: VectorStoreConfig): void {
	const vectorConfigPath = path.join(repoRoot, '.vectorconfig.json');
	fs.writeFileSync(vectorConfigPath, JSON.stringify(config, null, 2), 'utf-8');
}

/**
 * Validate vector store configuration
 */
export function validateVectorConfig(config: VectorStoreConfig): { valid: boolean; errors: string[] } {
	const errors: string[] = [];

	if (config.chunkSize && config.chunkSize < 100) {
		errors.push('chunkSize must be at least 100 characters');
	}

	if (config.chunkSize && config.chunkSize > 10000) {
		errors.push('chunkSize should not exceed 10000 characters');
	}

	if (config.chunkOverlap && config.chunkOverlap < 0) {
		errors.push('chunkOverlap must be non-negative');
	}

	if (config.chunkOverlap && config.chunkSize && config.chunkOverlap >= config.chunkSize) {
		errors.push('chunkOverlap must be less than chunkSize');
	}

	if (config.chunkStrategy && !['ast', 'llm'].includes(config.chunkStrategy)) {
		errors.push("chunkStrategy must be 'ast' or 'llm'");
	}

	if (config.maxFileSize && config.maxFileSize < 1024) {
		errors.push('maxFileSize must be at least 1KB');
	}

	return {
		valid: errors.length === 0,
		errors,
	};
}

/**
 * Get estimated cost per file based on configuration
 * Returns cost estimate in USD
 */
export function estimateCostPerFile(config: VectorStoreConfig, avgFileSize = 5000): number {
	let cost = 0;

	// Base embedding cost (~$0.00001 per 1K tokens)
	const tokensPerFile = avgFileSize / 4; // rough estimate: 4 chars per token
	cost += (tokensPerFile / 1000) * 0.00001;

	// Dual embedding doubles the embedding cost
	if (config.dualEmbedding) {
		cost += (tokensPerFile / 1000) * 0.00001; // code-to-english translation
		cost += (tokensPerFile / 1000) * 0.00001; // second embedding
	}

	// Contextual chunking adds LLM cost
	if (config.contextualChunking) {
		// Assume 5 chunks per file, each needing context generation
		const chunksPerFile = 5;
		const tokensPerContextGeneration = avgFileSize + 100; // full file + context prompt
		cost += ((chunksPerFile * tokensPerContextGeneration) / 1000) * 0.00001;
	}

	return cost;
}

/**
 * Print configuration summary
 */
export function printConfigSummary(config: VectorStoreConfig): void {
	console.log('Vector Store Configuration:');
	console.log('━'.repeat(50));
	console.log(`  Dual Embedding: ${config.dualEmbedding ? '✓ Enabled' : '✗ Disabled'}`);
	console.log(`  Contextual Chunking: ${config.contextualChunking ? '✓ Enabled' : '✗ Disabled'}`);
	console.log(`  Chunk Strategy: ${config.chunkStrategy || 'ast'}`);
	console.log(`  Chunk Size: ${config.chunkSize || 2500} chars`);
	console.log(`  Chunk Overlap: ${config.chunkOverlap || 300} chars`);
	console.log(`  Embedding Provider: ${config.embeddingProvider || 'vertex'}`);
	console.log(`  Embedding Model: ${config.embeddingModel || 'gemini-embedding-001'}`);
	console.log(`  Hybrid Search: ${config.hybridSearch ? '✓ Enabled' : '✗ Disabled'}`);
	console.log(`  Reranking: ${config.reranking ? '✓ Enabled' : '✗ Disabled'}`);
	console.log('━'.repeat(50));

	// Show quality and cost estimates
	const quality = (config.dualEmbedding ? 12 : 0) + (config.contextualChunking ? 60 : 0);
	const costMultiplier = 1 + (config.dualEmbedding ? 2 : 0) + (config.contextualChunking ? 5 : 0);

	console.log(`  Estimated Quality Improvement: ~${quality}%`);
	console.log(`  Estimated Cost Multiplier: ${costMultiplier}x`);
	console.log(`  Estimated Cost per File: ~$${estimateCostPerFile(config).toFixed(6)}`);
	console.log('━'.repeat(50));
}
