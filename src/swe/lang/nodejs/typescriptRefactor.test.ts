import { join, normalize, resolve, sep } from 'node:path';
import { expect } from 'chai';
import mock from 'mock-fs';
import sinon from 'sinon';
import { setupConditionalLoggerOutput } from '#test/testUtils';

// Leave the .only in for now while we're building this functionality
describe('TypeScriptRefactor', () => {
	setupConditionalLoggerOutput();

	// Use resolve to ensure absolute paths for mock-fs keys
	const repoRoot = resolve('/mock-repo');
	const testCwd = join(repoRoot, 'sub_dir'); // Current working directory inside the repo for tests

	const mockFileSystemStructure = {
		[repoRoot]: {
			// Root level files
			'file1.txt': 'hello world',
			sub_dir: {},
			'.git': {
				config: 'some git config',
				HEAD: 'ref: refs/heads/main',
			},
		},
	};

	beforeEach(() => {
		mock(mockFileSystemStructure, { createCwd: false }); // Prevent mock-fs from creating CWD
	});

	afterEach(() => {
		sinon.restore();
		mock.restore();
	});
});
