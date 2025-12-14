import { expect } from 'chai';
import { describe, it } from 'mocha';
import { setupConditionalLoggerOutput } from '#test/testUtils';
import { contextualizeFilesBatch } from './batchContextualizer';
import { DEFAULT_VECTOR_CONFIG, VectorStoreConfig } from './config';
import { ContextualizedChunk, FileInfo, IChunker, IContextualizer } from './interfaces';

class StubChunker implements IChunker {
	constructor(private failOn?: string) {}

	async chunk(file: FileInfo, _config: VectorStoreConfig) {
		if (this.failOn && file.filePath.includes(this.failOn)) throw new Error('chunk failure');
		return [
			{
				content: `content-${file.filePath}`,
				sourceLocation: { startLine: 1, endLine: 1 },
				chunkType: 'file',
			},
		];
	}

	getSupportedExtensions(): string[] {
		return ['.ts'];
	}
}

class StubContextualizer implements IContextualizer {
	async contextualize(rawChunks: any[], file: FileInfo): Promise<ContextualizedChunk[]> {
		return rawChunks.map((chunk) => ({
			...chunk,
			context: `ctx-${file.filePath}`,
			contextualizedContent: `ctx:${chunk.content}`,
		}));
	}
}

const makeFile = (filePath: string): FileInfo => ({
	filePath,
	relativePath: filePath,
	content: 'code',
	language: 'ts',
	size: 10,
	lastModified: new Date(),
});

describe('contextualizeFilesBatch', () => {
	setupConditionalLoggerOutput();

	it('processes files in batches and preserves order', async () => {
		const files = [makeFile('a.ts'), makeFile('b.ts'), makeFile('c.ts')];
		const progressCalls: string[] = [];

		const { results, errors } = await contextualizeFilesBatch(
			files,
			{ chunker: new StubChunker(), contextualizer: new StubContextualizer() },
			{
				maxConcurrent: 2,
				progress: (p) => {
					progressCalls.push(`${p.phase}:${p.currentFile}:${p.filesProcessed}`);
				},
				config: DEFAULT_VECTOR_CONFIG,
			},
		);

		expect(errors).to.deep.equal([]);
		expect(results.length).to.equal(3);
		expect(results[0].file.filePath).to.equal('a.ts');
		expect(results[1].file.filePath).to.equal('b.ts');
		expect(results[2].file.filePath).to.equal('c.ts');
		expect(results[0].chunks[0].context).to.equal('ctx-a.ts');
		expect(progressCalls.some((c) => c.startsWith('chunking:a.ts'))).to.be.true;
		expect(progressCalls.some((c) => c.startsWith('contextualizing:c.ts'))).to.be.true;
	});

	it('continues on errors when configured', async () => {
		const files = [makeFile('good.ts'), makeFile('bad.ts')];

		const { results, errors } = await contextualizeFilesBatch(
			files,
			{ chunker: new StubChunker('bad'), contextualizer: new StubContextualizer() },
			{ continueOnError: true, config: DEFAULT_VECTOR_CONFIG },
		);

		expect(results.length).to.equal(1);
		expect(results[0].file.filePath).to.equal('good.ts');
		expect(errors.length).to.equal(1);
		expect(errors[0].file.filePath).to.equal('bad.ts');
	});
});
