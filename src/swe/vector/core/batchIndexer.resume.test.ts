import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { expect } from 'chai';
import { describe, it } from 'mocha';
import { setupConditionalLoggerOutput } from '#test/testUtils';
import { BatchIndexerDeps, batchIndexFiles } from './batchIndexer';
import { DEFAULT_VECTOR_CONFIG } from './config';
import { ContextualizedChunk, FileInfo, RawChunk } from './interfaces';

const createFile = async (dir: string, name: string): Promise<FileInfo> => {
	const full = path.join(dir, name);
	await fs.writeFile(full, `code-${name}`, 'utf-8');
	const stat = await fs.stat(full);
	return {
		filePath: full,
		relativePath: name,
		language: 'typescript',
		content: `code-${name}`,
		size: stat.size,
		lastModified: stat.mtime,
	};
};

const mkChunk = (content: string): RawChunk => ({ content, sourceLocation: { startLine: 1, endLine: 1 }, chunkType: 'file' });

class FailingChunker {
	constructor(private failOn?: string) {}
	async chunk(file: FileInfo): Promise<RawChunk[]> {
		if (this.failOn && file.filePath.includes(this.failOn)) throw new Error('planned failure');
		return [mkChunk(file.content)];
	}
	getSupportedExtensions(): string[] {
		return ['.ts'];
	}
}

class StubContextualizer {
	async contextualize(chunks: RawChunk[], file: FileInfo): Promise<ContextualizedChunk[]> {
		return chunks.map((c) => ({
			...c,
			context: `ctx-${file.relativePath}`,
			contextualizedContent: `ctx:${c.content}`,
		}));
	}
}

class StubTranslator {
	async translateBatch(chunks: Array<RawChunk | ContextualizedChunk>): Promise<string[]> {
		return chunks.map((c) => `nl-${'contextualizedContent' in c ? c.contextualizedContent : c.content}`);
	}
}

class StubEmbedder {
	async generateDualEmbeddings(content: string, nlText: string) {
		return { codeEmbedding: [content.length], naturalLanguageEmbedding: [nlText.length] };
	}
}

class RecordingStore {
	public indexed: string[] = [];
	async indexChunks(chunks: any[]): Promise<void> {
		this.indexed.push(...chunks.map((c) => c.filePath));
	}
}

const deps = (failOn?: string): BatchIndexerDeps => ({
	chunker: new FailingChunker(failOn) as any,
	contextualizer: new StubContextualizer() as any,
	translator: new StubTranslator() as any,
	embedder: new StubEmbedder(),
	vectorStore: new RecordingStore(),
});

describe('batchIndexFiles resume flow', () => {
	setupConditionalLoggerOutput();

	it('reuses state file to skip completed work across runs', async () => {
		const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'vector-batch-resume-'));
		const files = [await createFile(dir, 'one.ts'), await createFile(dir, 'two.ts')];
		const statePath = path.join(dir, 'state.jsonl');

		// First run fails on the second file after first is recorded
		let threw = false;
		try {
			await batchIndexFiles(files, deps('two.ts'), {
				config: { ...DEFAULT_VECTOR_CONFIG, chunking: { ...DEFAULT_VECTOR_CONFIG.chunking, dualEmbedding: true } },
				stateFilePath: statePath,
				continueOnError: false,
				concurrency: 1,
			});
		} catch (e) {
			threw = true;
		}
		expect(threw).to.be.true;

		const firstState = await fs.readFile(statePath, 'utf-8');
		expect(firstState).to.contain('one.ts');
		expect(firstState).to.not.contain('two.ts');

		// Second run resumes and only processes the remaining file
		const depSet = deps();
		await batchIndexFiles(files, depSet, {
			config: { ...DEFAULT_VECTOR_CONFIG, chunking: { ...DEFAULT_VECTOR_CONFIG.chunking, dualEmbedding: true } },
			stateFilePath: statePath,
			continueOnError: true,
			concurrency: 2,
		});

		const store = depSet.vectorStore as RecordingStore;
		expect(store.indexed).to.have.length(1);
		expect(store.indexed[0]).to.include('two.ts');

		const combinedState = await fs.readFile(statePath, 'utf-8');
		expect(combinedState).to.contain('one.ts');
		expect(combinedState).to.contain('two.ts');
	});
});
