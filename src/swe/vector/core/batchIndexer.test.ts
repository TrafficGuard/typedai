import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { expect } from 'chai';
import { describe, it } from 'mocha';
import { BatchIndexerDeps, batchIndexFiles } from './batchIndexer';
import { DEFAULT_VECTOR_CONFIG } from './config';
import { ContextualizedChunk, FileInfo, RawChunk } from './interfaces';

const makeFile = (filePath: string, language = 'typescript'): FileInfo => ({
	filePath,
	relativePath: filePath,
	language,
	content: `code-${filePath}`,
	size: 10,
	lastModified: new Date(),
});

const rawChunk = (content: string): RawChunk => ({
	content,
	sourceLocation: { startLine: 1, endLine: 1 },
	chunkType: 'file',
});

class StubChunker {
	constructor(private failOn?: string) {}

	async chunk(file: FileInfo): Promise<RawChunk[]> {
		if (this.failOn && file.filePath.includes(this.failOn)) throw new Error('chunk error');
		return [rawChunk(`chunk-${file.filePath}`)];
	}

	getSupportedExtensions(): string[] {
		return ['.ts'];
	}
}

class StubContextualizer {
	async contextualize(_chunks: RawChunk[], file: FileInfo): Promise<ContextualizedChunk[]> {
		return [
			{
				...rawChunk(`ctx-${file.filePath}`),
				context: `context-${file.filePath}`,
				contextualizedContent: `ctx-content-${file.filePath}`,
			},
		];
	}
}

class StubTranslator {
	async translateBatch(chunks: Array<RawChunk | ContextualizedChunk>): Promise<string[]> {
		return chunks.map((c) => `nl-${'contextualizedContent' in c ? c.contextualizedContent : c.content}`);
	}
}

class StubEmbedder {
	async generateDualEmbeddings(content: string, nlText: string): Promise<{ codeEmbedding: number[]; naturalLanguageEmbedding: number[] }> {
		return {
			codeEmbedding: [content.length],
			naturalLanguageEmbedding: [nlText.length],
		};
	}
}

class StubVectorStore {
	public indexed: any[] = [];

	async indexChunks(chunks: any[]): Promise<void> {
		this.indexed.push(...chunks);
	}
}

const baseDeps = (): BatchIndexerDeps => ({
	chunker: new StubChunker() as any,
	contextualizer: new StubContextualizer() as any,
	translator: new StubTranslator() as any,
	embedder: new StubEmbedder(),
	vectorStore: new StubVectorStore(),
});

describe('batchIndexFiles', () => {
	it('indexes files concurrently and preserves stats', async () => {
		const files = [makeFile('a.ts'), makeFile('b.ts')];
		const deps = baseDeps();
		const progress: string[] = [];

		const { stats } = await batchIndexFiles(files, deps, {
			config: { ...DEFAULT_VECTOR_CONFIG, chunking: { ...DEFAULT_VECTOR_CONFIG.chunking, dualEmbedding: true, contextualChunking: true } },
			concurrency: 2,
			progress: (p) => {
				if (p.phase && p.currentFile) progress.push(`${p.phase}:${p.currentFile}`);
			},
		});

		expect(stats.fileCount).to.equal(2);
		expect(stats.filesProcessed).to.equal(2);
		expect(stats.failedFiles).to.deep.equal([]);
		expect((deps.vectorStore as StubVectorStore).indexed.length).to.equal(2);
		expect(progress.some((p) => p.startsWith('contextualizing:a.ts'))).to.be.true;
	});

	it('continues on error when configured', async () => {
		const files = [makeFile('ok.ts'), makeFile('fail.ts')];
		const deps = baseDeps();
		deps.chunker = new StubChunker('fail') as any;

		const { stats } = await batchIndexFiles(files, deps, { config: DEFAULT_VECTOR_CONFIG, continueOnError: true, concurrency: 1 });

		expect(stats.fileCount).to.equal(2);
		expect(stats.filesProcessed).to.equal(1);
		expect(stats.failedFiles).to.deep.equal(['fail.ts']);
		expect(stats.totalChunks).to.equal(1);
	});

	it('skips completed files using a state file', async () => {
		const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'vector-batch-state-'));
		const statePath = path.join(tmpDir, 'state.jsonl');
		await fs.appendFile(statePath, `${JSON.stringify({ filePath: 'done.ts', status: 'success' })}\n`);

		const files = [makeFile('done.ts'), makeFile('todo.ts')];
		const deps = baseDeps();

		const { stats } = await batchIndexFiles(files, deps, {
			config: { ...DEFAULT_VECTOR_CONFIG, chunking: { ...DEFAULT_VECTOR_CONFIG.chunking, contextualChunking: true } },
			stateFilePath: statePath,
			concurrency: 2,
		});

		expect(stats.fileCount).to.equal(2);
		expect(stats.filesProcessed).to.equal(2); // one pre-completed, one processed now
		expect((deps.vectorStore as StubVectorStore).indexed.length).to.equal(1);

		const stateContent = await fs.readFile(statePath, 'utf-8');
		expect(stateContent.split('\n').filter(Boolean).length).to.equal(2);
	});
});
