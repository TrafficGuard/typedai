import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import pLimit from 'p-limit';
import { DEFAULT_VECTOR_CONFIG, VectorStoreConfig } from './config';
import { ContextualizedChunk, EmbeddedChunk, FileInfo, IChunker, ICodeTranslator, IContextualizer, ProgressCallback, RawChunk } from './interfaces';

export interface BatchIndexerDeps {
	chunker: IChunker;
	contextualizer: IContextualizer;
	translator: ICodeTranslator;
	embedder: {
		generateDualEmbeddings(
			content: string,
			nlText: string,
			config: VectorStoreConfig,
		): Promise<{ codeEmbedding: number[]; naturalLanguageEmbedding: number[] }>;
	};
	vectorStore: {
		indexChunks(chunks: EmbeddedChunk[]): Promise<void>;
	};
	logChunks?: (chunks: Array<RawChunk | ContextualizedChunk>, filePath: string, repoRoot: string) => Promise<void>;
}

export interface BatchIndexerOptions {
	config?: VectorStoreConfig;
	concurrency?: number;
	continueOnError?: boolean;
	progress?: ProgressCallback;
	repoRoot?: string;
	stateFilePath?: string;
}

export interface BatchIndexStats {
	fileCount: number;
	filesProcessed: number;
	failedFiles: string[];
	totalChunks: number;
	failedChunks: number;
}

export interface BatchIndexResult {
	stats: BatchIndexStats;
}

export async function batchIndexFiles(files: FileInfo[], deps: BatchIndexerDeps, options: BatchIndexerOptions = {}): Promise<BatchIndexResult> {
	if (!files?.length) return { stats: emptyStats() };

	const config = options.config ?? DEFAULT_VECTOR_CONFIG;
	const concurrency = Math.max(1, options.concurrency ?? 3);
	const continueOnError = options.continueOnError ?? false;
	const state = await loadState(options.stateFilePath);
	const limit = pLimit(concurrency);
	const stats: BatchIndexStats = {
		fileCount: files.length,
		filesProcessed: state.completed.size,
		failedFiles: [],
		totalChunks: 0,
		failedChunks: 0,
	};

	const tasks = files.map((fileInfo, index) =>
		limit(async () => {
			if (state.completed.has(fileInfo.filePath)) return;

			options.progress?.({
				phase: 'loading',
				currentFile: fileInfo.relativePath || fileInfo.filePath,
				filesProcessed: stats.filesProcessed,
				totalFiles: stats.fileCount,
			});

			try {
				const contextualized = await contextualizeFile(fileInfo, deps, config, options);
				if (!contextualized.length) {
					stats.filesProcessed++;
					return;
				}

				const embedded = await embedChunks(contextualized, fileInfo, deps, config, options);
				if (embedded.length === 0) {
					stats.failedChunks += contextualized.length;
					stats.filesProcessed++;
					return;
				}

				options.progress?.({
					phase: 'indexing',
					currentFile: fileInfo.relativePath || fileInfo.filePath,
					filesProcessed: stats.filesProcessed,
					totalFiles: stats.fileCount,
					chunksProcessed: embedded.length,
				});

				await deps.vectorStore.indexChunks(embedded);
				stats.totalChunks += embedded.length;
				stats.filesProcessed++;
				await recordState(options.stateFilePath, fileInfo.filePath);
			} catch (error) {
				stats.failedFiles.push(fileInfo.filePath);
				if (!continueOnError) throw error;
			}
		}),
	);

	await Promise.all(tasks);

	return { stats };
}

function emptyStats(): BatchIndexStats {
	return { fileCount: 0, filesProcessed: 0, failedFiles: [], totalChunks: 0, failedChunks: 0 };
}

async function loadState(stateFilePath?: string): Promise<{ completed: Set<string> }> {
	if (!stateFilePath) return { completed: new Set() };

	try {
		const content = await fs.readFile(stateFilePath, 'utf-8');
		const completed = new Set<string>();
		content
			.split('\n')
			.map((line) => line.trim())
			.filter(Boolean)
			.forEach((line) => {
				try {
					const parsed = JSON.parse(line);
					if (parsed?.filePath && parsed.status === 'success') completed.add(parsed.filePath as string);
				} catch {}
			});
		return { completed };
	} catch {
		return { completed: new Set() };
	}
}

async function recordState(stateFilePath: string | undefined, filePath: string): Promise<void> {
	if (!stateFilePath) return;
	const dir = path.dirname(stateFilePath);
	await fs.mkdir(dir, { recursive: true });
	const line = `${JSON.stringify({ filePath, status: 'success', at: new Date().toISOString() })}\n`;
	await fs.appendFile(stateFilePath, line, 'utf-8');
}

async function contextualizeFile(
	fileInfo: FileInfo,
	deps: BatchIndexerDeps,
	config: VectorStoreConfig,
	options: BatchIndexerOptions,
): Promise<Array<RawChunk | ContextualizedChunk>> {
	if (config.chunking?.contextualChunking) {
		options.progress?.({
			phase: 'contextualizing',
			currentFile: fileInfo.relativePath || fileInfo.filePath,
			filesProcessed: 0,
			totalFiles: 0,
		});
		return await deps.contextualizer.contextualize([], fileInfo, config);
	}

	options.progress?.({
		phase: 'chunking',
		currentFile: fileInfo.relativePath || fileInfo.filePath,
		filesProcessed: 0,
		totalFiles: 0,
	});

	const rawChunks = await deps.chunker.chunk(fileInfo, config);
	if (!rawChunks.length) return [];

	return rawChunks;
}

async function embedChunks(
	chunks: Array<RawChunk | ContextualizedChunk>,
	fileInfo: FileInfo,
	deps: BatchIndexerDeps,
	config: VectorStoreConfig,
	options: BatchIndexerOptions,
): Promise<EmbeddedChunk[]> {
	const repoRoot = options.repoRoot ?? process.cwd();

	if (config.logChunks && deps.logChunks) {
		await deps.logChunks(chunks, fileInfo.filePath, repoRoot);
	}

	let naturalLanguageDescriptions: string[] = [];
	if (config.chunking?.dualEmbedding) {
		options.progress?.({
			phase: 'translating',
			currentFile: fileInfo.relativePath || fileInfo.filePath,
			filesProcessed: 0,
			totalFiles: 0,
			chunksProcessed: 0,
			totalChunks: chunks.length,
		});
		naturalLanguageDescriptions = await deps.translator.translateBatch(chunks, fileInfo);
	}

	options.progress?.({
		phase: 'embedding',
		currentFile: fileInfo.relativePath || fileInfo.filePath,
		filesProcessed: 0,
		totalFiles: 0,
		chunksProcessed: 0,
		totalChunks: chunks.length,
	});

	const embedded = await Promise.all(
		chunks.map(async (chunk, i) => {
			try {
				const textToEmbed = 'contextualizedContent' in chunk ? chunk.contextualizedContent : chunk.content;
				const nlText = config.chunking?.dualEmbedding ? naturalLanguageDescriptions[i] || textToEmbed : textToEmbed;
				const { codeEmbedding, naturalLanguageEmbedding } = await deps.embedder.generateDualEmbeddings(textToEmbed, nlText, config);

				return {
					filePath: fileInfo.filePath,
					language: fileInfo.language,
					chunk,
					embedding: config.chunking?.dualEmbedding ? naturalLanguageEmbedding : codeEmbedding,
					secondaryEmbedding: config.chunking?.dualEmbedding ? codeEmbedding : undefined,
					naturalLanguageDescription: config.chunking?.dualEmbedding ? nlText : undefined,
				} as EmbeddedChunk;
			} catch (error) {
				return null;
			}
		}),
	);

	const successful = embedded.filter(Boolean) as EmbeddedChunk[];
	const failedCount = chunks.length - successful.length;
	if (failedCount > 0 && options.progress) {
		options.progress({
			phase: 'embedding',
			currentFile: fileInfo.relativePath || fileInfo.filePath,
			filesProcessed: 0,
			totalFiles: 0,
			chunksProcessed: successful.length,
			totalChunks: chunks.length,
			message: 'Some embeddings failed',
		});
	}

	return successful;
}
