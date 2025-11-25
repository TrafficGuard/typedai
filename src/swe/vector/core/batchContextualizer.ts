import { DEFAULT_VECTOR_CONFIG, VectorStoreConfig } from './config';
import { ContextualizedChunk, FileInfo, IChunker, IContextualizer, ProgressCallback } from './interfaces';

export interface BatchContextualizerDeps {
	chunker: IChunker;
	contextualizer: IContextualizer;
}

export interface BatchContextualizerOptions {
	config?: VectorStoreConfig;
	maxConcurrent?: number;
	continueOnError?: boolean;
	progress?: ProgressCallback;
}

export interface BatchContextualizationResult {
	file: FileInfo;
	chunks: ContextualizedChunk[];
}

export interface BatchContextualizationResponse {
	results: BatchContextualizationResult[];
	errors: Array<{ file: FileInfo; error: Error }>;
}

export async function contextualizeFilesBatch(
	files: FileInfo[],
	{ chunker, contextualizer }: BatchContextualizerDeps,
	options: BatchContextualizerOptions = {},
): Promise<BatchContextualizationResponse> {
	if (!files?.length) return { results: [], errors: [] };

	const config = options.config ?? DEFAULT_VECTOR_CONFIG;
	const maxConcurrent = Math.max(1, options.maxConcurrent ?? 3);
	const continueOnError = options.continueOnError ?? false;
	const results: Array<BatchContextualizationResult | undefined> = new Array(files.length);
	const errors: Array<{ file: FileInfo; error: Error }> = [];
	let cursor = 0;

	const reportProgress = (phase: 'chunking' | 'contextualizing', file: FileInfo, filesProcessed: number, chunksProcessed?: number) => {
		if (!options.progress) return;
		options.progress({
			phase,
			currentFile: file.relativePath || file.filePath,
			filesProcessed,
			totalFiles: files.length,
			chunksProcessed,
		});
	};

	const worker = async (): Promise<void> => {
		while (true) {
			const index = cursor;
			if (index >= files.length) return;
			cursor += 1;

			const file = files[index];

			try {
				reportProgress('chunking', file, index);
				const rawChunks = await chunker.chunk(file, config);

				const contextualizedChunks = await contextualizer.contextualize(rawChunks, file, config);
				reportProgress('contextualizing', file, index + 1, contextualizedChunks.length);

				results[index] = { file, chunks: contextualizedChunks };
			} catch (error: any) {
				if (!continueOnError) throw error;
				errors.push({ file, error });
			}
		}
	};

	const workers = Array.from({ length: Math.min(maxConcurrent, files.length) }, () => worker());
	await Promise.all(workers);

	return {
		results: results.filter(Boolean) as BatchContextualizationResult[],
		errors,
	};
}
