import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect } from 'chai';
import sinon from 'sinon';

import { agentContextStorage } from '#agent/agentContext';
import * as appDirs from '#app/appDirs';
import { setupConditionalLoggerOutput } from '#test/testUtils';
import { LocalFileStore } from './localFileStore';

describe('LocalFileStore', () => {
	setupConditionalLoggerOutput();
	const testAgentId = 'test-agent-id';
	const sandbox = sinon.createSandbox();
	let basePath: string;
	let localFileStore: LocalFileStore;

	function withContext(func: () => Promise<any>): Promise<any> {
		return agentContextStorage.run({ agentId: testAgentId } as any, () => func());
	}

	beforeEach(async () => {
		basePath = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'localfilestore-'));
		localFileStore = new LocalFileStore(basePath);
	});

	afterEach(async () => {
		await fs.promises.rm(basePath, { recursive: true, force: true });
		sandbox.restore();
	});

	it('should save a file successfully with metadata', async () =>
		withContext(async () => {
			const filename = 'test-file.txt';
			const contents = 'Test content';
			const description = 'Test file description';

			await localFileStore.saveFile(filename, contents, description);

			const fullPath = path.join(localFileStore.basePath, testAgentId, filename);
			const savedContents = await fs.promises.readFile(fullPath, 'utf8');
			expect(savedContents).to.equal(contents);

			const metadataPath = path.join(localFileStore.basePath, testAgentId, '.metadata.json');
			const metadataContents = await fs.promises.readFile(metadataPath, 'utf8');
			const metadata = JSON.parse(metadataContents);
			expect(metadata[filename]).to.exist;
			expect(metadata[filename].description).to.equal(description);
		}));

	it('should retrieve file contents successfully', async () =>
		withContext(async () => {
			const filename = 'test-file.txt';
			const contents = 'Test content';
			const description = 'Test file description';

			await localFileStore.saveFile(filename, contents, description);

			const retrievedContents = await localFileStore.getFile(filename);
			expect(retrievedContents).to.equal(contents);
		}));

	it('should list files with metadata', async () =>
		withContext(async () => {
			const testFiles = [
				{ name: 'test-file1.txt', content: 'Test content 1', description: 'Description 1' },
				{ name: 'test-file2.txt', content: 'Test content 2', description: 'Description 2' },
			];

			// Create test files
			for (const file of testFiles) {
				await localFileStore.saveFile(file.name, file.content, file.description);
			}

			const listedFiles = await localFileStore.listFiles();

			expect(listedFiles).to.have.lengthOf(testFiles.length);
			for (const file of testFiles) {
				const listedFile = listedFiles.find((f) => f.filename === file.name);
				expect(listedFile).to.exist;
				expect(listedFile!.description).to.equal(file.description);
				expect(listedFile!.size).to.above(0);
				expect(listedFile!.lastUpdated).to.match(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
			}
		}));

	it('should throw an error when trying to get a non-existent file', async () => {
		const nonExistentFile = 'non-existent-file.txt';
		try {
			await localFileStore.getFile(nonExistentFile);
			expect(true).to.equal(false, 'Getting a non-existent file should fail');
		} catch (e) {}
	});
});
