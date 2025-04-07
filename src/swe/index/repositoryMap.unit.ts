import path from 'path'; // Adjust path as needed
import chai, { expect } from 'chai';
import chaiSubset from 'chai-subset';
import ignore, { Ignore } from 'ignore'; // Import ignore and Ignore type
import mock from 'mock-fs';
import sinon from 'sinon';
import { FileSystemService } from '#functions/storage/fileSystemService';
import * as tokens from '#llm/tokens'; // Import the module containing countTokens
import { File, Folder, buildFolderStructure } from './repositoryMap';

// Enable chai-subset
chai.use(chaiSubset);

describe('buildFolderStructure', () => {
	let fileSystemService: FileSystemService;
	let countTokensStub: sinon.SinonStub;

	// Define the mock file system structure
	const mockFileSystemStructure = {
		'/mock-repo': {
			'file1.txt': 'hello world', // 2 tokens
			'file2.js': 'console.log("test");', // 3 tokens
			empty_dir: {},
			sub_dir: {
				'sub_file1.ts': 'interface Foo {}', // 3 tokens
				nested_dir: {
					'nested_file.md': '# Header', // 2 tokens
				},
				// Optional: Nested .gitignore - Let's test this later if needed
				// '.gitignore': 'nested_dir/'
			},
			'.gitignore': '*.log\nignored_dir/\nignored_file.txt\n.git/\n', // Added .git/ here explicitly
			'ignored_file.txt': 'ignore me', // 2 tokens (ignored)
			'file3.log': 'log entry', // 2 tokens (ignored)
			ignored_dir: {
				'should_be_ignored.txt': 'definitely ignore', // 2 tokens (ignored)
			},
			'.git': {
				// Should be ignored by .gitignore and default behavior
				config: 'some git config',
				HEAD: 'ref: refs/heads/main',
			},
		},
		// Mock git executable path if FileSystemService relies on it internally for gitignore checks
		// Adjust path based on your system or how FileSystemService finds git
		'/usr/bin/git': '',
	};

	beforeEach(async () => {
		// 1. Stub countTokens
		// Mock implementation: counts space-separated words
		countTokensStub = sinon.stub(tokens, 'countTokens').callsFake(async (fileContent: string) => {
			return fileContent.split(/\s+/).filter(Boolean).length;
		});

		// 2. Set up mock-fs
		mock(mockFileSystemStructure);

		// 3. Instantiate FileSystemService pointing to the mock repo root
		// Need to ensure FileSystemService can find the mock git executable if it uses it
		// We might need to adjust FileSystemService or mock its internal git calls if '/usr/bin/git' isn't sufficient
		fileSystemService = new FileSystemService('/mock-repo');

		// Ensure the FileSystemService picks up the .git directory for gitignore logic
		// This might require mocking internal methods of FileSystemService if it relies on external git commands heavily
		// For now, assume loadGitignoreRules works correctly with mock-fs
		// We might need to explicitly add the git root if detection fails in mock-fs
		sinon.stub(fileSystemService, 'getVcsRoot').returns('/mock-repo'); // Force detection of git root

		// Stub loadGitignoreRules to simulate reading the mock .gitignore
		sinon.stub(fileSystemService, 'loadGitignoreRules').callsFake(async (startPath: string, gitRoot: string | null): Promise<Ignore> => {
			const ig = ignore();
			// logger.debug(`Stub loadGitignoreRules called with: startPath='${startPath}', gitRoot='${gitRoot}'`); // Optional: Add for debugging stub calls

			// Always add the default .git ignore rule first
			ig.add('.git/');

			// Determine if we are processing the root directory based on the test setup
			// Resolve startPath relative to the *basePath* of the FileSystemService for accurate comparison with gitRoot
			const resolvedStartPath = path.resolve(fileSystemService.basePath, startPath);
			const isRoot = resolvedStartPath === gitRoot;
			// logger.debug(`Stub loadGitignoreRules: resolvedStartPath='${resolvedStartPath}', gitRoot='${gitRoot}', isRoot=${isRoot}`); // Debugging line

			// Add rules from the root .gitignore ONLY if processing the root directory
			if (isRoot) {
				// logger.debug(`Stub loadGitignoreRules: Adding root rules for '${startPath}'`); // Optional: Add for debugging stub calls
				// Explicitly add each pattern from the mock .gitignore
				ig.add('*.log');
				ig.add('ignored_dir/'); // Ensure trailing slash for directories
				ig.add('ignored_file.txt');
			} else {
				// logger.debug(`Stub loadGitignoreRules: Not adding root rules for '${startPath}'`); // Optional: Add for debugging stub calls
				// For nested directories in this test, we assume no nested .gitignore files.
				// The .git/ rule is already added.
			}

			return ig;
		});
	});

	afterEach(() => {
		// Restore the stub and mock file system
		sinon.restore();
		mock.restore();
	});

	it('should build basic structure and calculate token counts correctly', async () => {
		const rootFolder = await buildFolderStructure('.', fileSystemService);

		// Assert root folder properties
		expect(rootFolder.name).to.equal('.'); // path.basename('/mock-repo') might return 'mock-repo', but '.' is expected from code
		expect(rootFolder.tokens).to.equal(3); // file1.txt (2) + file2.js (1)
		expect(rootFolder.totalFiles).to.equal(4); // file1, file2, sub_file1, nested_file

		// Assert top-level files using containSubset for flexibility
		expect(rootFolder.files).to.containSubset([
			{ name: 'file1.txt', tokens: 2 },
			// Change expected tokens for file2.js from 3 to 1 based on stub behavior
			{ name: 'file2.js', tokens: 1 },
		]);
		// Ensure exact match for files array length (no ignored files included)
		expect(rootFolder.files).to.have.lengthOf(2);

		// Assert top-level subfolders
		expect(rootFolder.subFolders).to.containSubset([{ name: 'empty_dir' }, { name: 'sub_dir' }]);
		// Ensure exact match for subfolders array length (no ignored folders included)
		expect(rootFolder.subFolders).to.have.lengthOf(2);

		// Check empty directory details
		const emptyDir = rootFolder.subFolders.find((f) => f.name === 'empty_dir');
		expect(emptyDir).to.deep.equal({
			name: 'empty_dir',
			subFolders: [],
			files: [],
			tokens: 0,
			totalTokens: 0,
			totalFiles: 0,
		});
	});

	it('should handle nested structure and calculate total tokens correctly', async () => {
		const rootFolder = await buildFolderStructure('.', fileSystemService);

		const subDir = rootFolder.subFolders.find((f) => f.name === 'sub_dir');
		expect(subDir).to.exist;
		const nestedDir = subDir?.subFolders.find((f) => f.name === 'nested_dir');
		expect(nestedDir).to.exist;

		// Assert sub_dir details
		expect(subDir).to.containSubset({
			name: 'sub_dir',
			files: [{ name: 'sub_file1.ts', tokens: 3 }],
			tokens: 3,
			totalTokens: 5, // 3 (sub_dir files) + 2 (nested_dir total)
			totalFiles: 2, // sub_file1.ts + nested_file.md
		});
		expect(subDir?.files).to.have.lengthOf(1);
		expect(subDir?.subFolders).to.have.lengthOf(1);

		// Assert nested_dir details
		expect(nestedDir).to.containSubset({
			name: 'nested_dir',
			files: [{ name: 'nested_file.md', tokens: 2 }],
			tokens: 2,
			totalTokens: 2,
			totalFiles: 1, // nested_file.md
		});
		expect(nestedDir?.files).to.have.lengthOf(1);
		expect(nestedDir?.subFolders).to.be.empty;

		// Assert root folder's totalTokens
		// Root tokens (3) + empty_dir total (0) + sub_dir total (5) = 8
		expect(rootFolder.totalTokens).to.equal(8);
		expect(rootFolder.totalFiles).to.equal(4); // file1 + file2 + sub_file1 + nested_file
	});

	it('should respect .gitignore rules', async () => {
		const rootFolder = await buildFolderStructure('.', fileSystemService);

		// Check ignored files are not present
		expect(rootFolder.files.find((f) => f.name === 'ignored_file.txt')).to.be.undefined;
		expect(rootFolder.files.find((f) => f.name === 'file3.log')).to.be.undefined;

		// Check ignored folders are not present
		expect(rootFolder.subFolders.find((f) => f.name === 'ignored_dir')).to.be.undefined;
		expect(rootFolder.subFolders.find((f) => f.name === '.git')).to.be.undefined;

		// Verify token counts are correct, implying ignored files were excluded
		expect(rootFolder.tokens).to.equal(3); // Only file1.txt (2) and file2.js (1)
		expect(rootFolder.totalTokens).to.equal(8); // Root (3) + empty (0) + sub_dir (5)
		expect(rootFolder.totalFiles).to.equal(4); // file1 + file2 + sub_file1 + nested_file
	});

	it('should handle an empty directory correctly', async () => {
		// Setup specific mock for this test
		mock({ '/empty-test-dir': {} });
		const fss = new FileSystemService('/empty-test-dir');
		// Stub getVcsRoot for this specific instance if needed, though likely not necessary for empty dir
		sinon.stub(fss, 'getVcsRoot').returns(null); // No git repo here

		const result = await buildFolderStructure('.', fss);

		expect(result).to.deep.equal({
			name: '.', // Assuming '.' based on current implementation
			subFolders: [],
			files: [],
			tokens: 0,
			totalTokens: 0,
			totalFiles: 0,
		});

		// Restore mock specifically for this test case if not relying on afterEach
		mock.restore();
	});

	it('should build structure correctly when starting from a specific subdirectory', async () => {
		// Uses the main mock structure defined in beforeEach
		const subDirStructure = await buildFolderStructure('sub_dir', fileSystemService);

		// The root of the returned structure should be 'sub_dir'
		expect(subDirStructure.name).to.equal('sub_dir');

		// Assert structure, tokens, and files match the 'sub_dir' part from previous tests
		expect(subDirStructure).to.containSubset({
			name: 'sub_dir',
			files: [{ name: 'sub_file1.ts', tokens: 3 }],
			tokens: 3,
			totalTokens: 5, // 3 (sub_dir) + 2 (nested_dir)
			totalFiles: 2, // sub_file1 + nested_file
			subFolders: [
				{
					name: 'nested_dir',
					files: [{ name: 'nested_file.md', tokens: 2 }],
					tokens: 2,
					totalTokens: 2,
					totalFiles: 1,
					subFolders: [], // nested_dir has no subfolders
				},
			],
		});
		expect(subDirStructure.files).to.have.lengthOf(1);
		expect(subDirStructure.subFolders).to.have.lengthOf(1);
		expect(subDirStructure.subFolders[0].files).to.have.lengthOf(1);
	});
});
