import { join, normalize, resolve, sep } from 'node:path';
import { expect } from 'chai';
import mock from 'mock-fs';
import sinon from 'sinon';
import { includeAlternativeAiToolFiles } from './includeAlternativeAiToolFiles';

// Helper to normalize paths in expected results for cross-platform compatibility
const norm = (paths: string[]) => paths.map((p) => normalize(p));

describe('includeAlternativeAiToolFiles', () => {
	// Use resolve to ensure absolute paths for mock-fs keys
	const repoRoot = resolve('/mock-repo');
	const testCwd = join(repoRoot, 'sub_dir'); // Current working directory inside the repo for tests

	const mockFileSystemStructure = {
		[repoRoot]: {
			// Root level files
			'file1.txt': 'hello world',
			'.cursorrules': 'Root cursor rules', // Cursor legacy
			'.aider.conf.yml': "read: 'CONVENTIONS.md'\nother: value", // Aider config (string read)
			'.cursor': {
				// Cursor new rules dir
				rules: {
					'root_rule.mdc': 'Root cursor rule mdc',
					'another_rule.mdc': 'Another root rule',
				},
			},
			'.windsurfrules': 'Root windsurf rules', // Windsurf local
			'CONVENTIONS.md': 'Root conventions', // Aider conventions / Aider read target
			'global_rules.md': 'Global windsurf rules', // Windsurf global (only if repoRoot is vcsRoot)
			'DOCS.md': 'Root DOCS.md', // TypedAI docs
			'QUICKSTART.md': 'Quickstart guide', // Referenced by subdir aider config
			// Sub directory
			sub_dir: {
				'sub_file1.ts': 'interface Foo {}',
				'.cursorrules': 'Subdir cursor rules', // Cursor legacy (should be found for files in sub_dir)
				'CONVENTIONS.md': 'Subdir conventions', // Aider conventions (should be found)
				'DOCS.md': 'Subdir DOCS.md', // TypedAI docs (should be found)
				'.aider.conf.yml': 'read:\n  - ../QUICKSTART.md\n  - non_existent.md', // Aider config (list read, relative path up, non-existent file)

				// Nested directory
				nested_dir: {
					'nested_file.md': '# Header',
					'.windsurfrules': 'Nested windsurf rules', // Windsurf local (should be found for files in nested_dir)
					'DOCS.md': 'Nested DOCS.md', // TypedAI docs (should be found)
				},
			},
			// Git related (should be ignored by function logic, not explicitly by .gitignore parsing)
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

	it('should find no files if none exist', async () => {
		// Use a different structure for this test
		mock.restore();
		const emptyRepoPath = resolve('/empty-repo');
		mock({ [emptyRepoPath]: { 'main.js': '' } });

		const fileSelection = ['main.js'];
		const additions = await includeAlternativeAiToolFiles(fileSelection, {
			cwd: emptyRepoPath,
			vcsRoot: emptyRepoPath,
		});
		expect(additions).to.be.an.instanceOf(Set);
		expect(additions.size).to.equal(0);
	});

	it('should find files in the current directory and parent directories (up to VCS root)', async () => {
		// File selection is relative to CWD (/mock-repo/sub_dir)
		const fileSelection = ['sub_file1.ts'];
		const additions = await includeAlternativeAiToolFiles(fileSelection, {
			cwd: testCwd,
			vcsRoot: repoRoot,
		});

		const expectedPaths = norm([
			// Files relative to testCwd ('sub_dir')
			'.cursorrules', // Found in sub_dir
			'CONVENTIONS.md', // Found in sub_dir
			'DOCS.md', // Found in sub_dir
			'.aider.conf.yml', // Found in sub_dir
			// Files relative to cwd, found in parent ('/')
			`..${sep}.cursorrules`,
			`..${sep}.aider.conf.yml`,
			`..${sep}.cursor${sep}rules${sep}root_rule.mdc`,
			`..${sep}.cursor${sep}rules${sep}another_rule.mdc`,
			`..${sep}.windsurfrules`,
			`..${sep}CONVENTIONS.md`, // Read by root .aider.conf.yml
			`..${sep}global_rules.md`, // Found in vcsRoot
			`..${sep}DOCS.md`,
			`..${sep}QUICKSTART.md`, // Read by sub_dir .aider.conf.yml
		]);

		expect(additions).to.be.an.instanceOf(Set);
		expect(norm(Array.from(additions))).to.have.members(expectedPaths);
		expect(additions.size).to.equal(expectedPaths.length);
	});

	it('should find files for a file in a nested directory, including all ancestors', async () => {
		// File selection relative to CWD (/mock-repo/sub_dir)
		const fileSelection = [`nested_dir${sep}nested_file.md`];
		const additions = await includeAlternativeAiToolFiles(fileSelection, {
			cwd: testCwd,
			vcsRoot: repoRoot,
		});

		const expectedPaths = norm([
			// Files relative to testCwd ('sub_dir')
			`nested_dir${sep}.windsurfrules`, // Found in nested_dir
			`nested_dir${sep}DOCS.md`, // Found in nested_dir
			'.cursorrules', // Found in sub_dir
			'CONVENTIONS.md', // Found in sub_dir
			'DOCS.md', // Found in sub_dir
			'.aider.conf.yml', // Found in sub_dir
			// Files relative to cwd, found in parent ('/')
			`..${sep}.cursorrules`,
			`..${sep}.aider.conf.yml`,
			`..${sep}.cursor${sep}rules${sep}root_rule.mdc`,
			`..${sep}.cursor${sep}rules${sep}another_rule.mdc`,
			`..${sep}.windsurfrules`,
			`..${sep}CONVENTIONS.md`, // Read by root .aider.conf.yml
			`..${sep}global_rules.md`, // Found in vcsRoot
			`..${sep}DOCS.md`,
			`..${sep}QUICKSTART.md`, // Read by sub_dir .aider.conf.yml
		]);

		expect(additions).to.be.an.instanceOf(Set);
		expect(norm(Array.from(additions))).to.have.members(expectedPaths);
		expect(additions.size).to.equal(expectedPaths.length);
	});

	it('should handle multiple files in the selection across different directories', async () => {
		// Files relative to CWD (/mock-repo/sub_dir)
		const fileSelection = ['sub_file1.ts', `nested_dir${sep}nested_file.md`, `..${sep}file1.txt`];
		const additions = await includeAlternativeAiToolFiles(fileSelection, {
			cwd: testCwd,
			vcsRoot: repoRoot,
		});

		// Expected paths should be the union of files found for all selected files' hierarchies
		const expectedPaths = norm([
			// Files relative to testCwd ('sub_dir')
			`nested_dir${sep}.windsurfrules`, // Found in nested_dir (from nested_file)
			`nested_dir${sep}DOCS.md`, // Found in nested_dir (from nested_file)
			'.cursorrules', // Found in sub_dir (from sub_file1, nested_file)
			'CONVENTIONS.md', // Found in sub_dir (from sub_file1, nested_file)
			'DOCS.md', // Found in sub_dir (from sub_file1, nested_file)
			'.aider.conf.yml', // Found in sub_dir (from sub_file1, nested_file)
			// Files relative to cwd, found in parent ('/') (from all files)
			`..${sep}.cursorrules`,
			`..${sep}.aider.conf.yml`,
			`..${sep}.cursor${sep}rules${sep}root_rule.mdc`,
			`..${sep}.cursor${sep}rules${sep}another_rule.mdc`,
			`..${sep}.windsurfrules`,
			`..${sep}CONVENTIONS.md`, // Read by root .aider.conf.yml
			`..${sep}global_rules.md`, // Found in vcsRoot
			`..${sep}DOCS.md`,
			`..${sep}QUICKSTART.md`, // Read by sub_dir .aider.conf.yml
		]);

		expect(additions).to.be.an.instanceOf(Set);
		expect(norm(Array.from(additions))).to.have.members(expectedPaths);
		expect(additions.size).to.equal(expectedPaths.length); // Set handles duplicates automatically
	});

	it('should not add files that are already present in the initial file selection', async () => {
		// Files relative to CWD (/mock-repo/sub_dir)
		const fileSelection = [
			'sub_file1.ts',
			'CONVENTIONS.md', // Already selected (exists in sub_dir)
			`..${sep}.cursorrules`, // Already selected (exists in root)
		];
		const additions = await includeAlternativeAiToolFiles(fileSelection, {
			cwd: testCwd,
			vcsRoot: repoRoot,
		});

		const expectedPaths = norm([
			// Files relative to testCwd ('sub_dir')
			'.cursorrules', // Found in sub_dir (NOT the one from selection)
			// 'CONVENTIONS.md' - Excluded as it was in fileSelection
			'DOCS.md', // Found in sub_dir
			'.aider.conf.yml', // Found in sub_dir
			// Files relative to cwd, found in parent ('/')
			// `..${sep}.cursorrules` - Excluded as it was in fileSelection
			`..${sep}.aider.conf.yml`,
			`..${sep}.cursor${sep}rules${sep}root_rule.mdc`,
			`..${sep}.cursor${sep}rules${sep}another_rule.mdc`,
			`..${sep}.windsurfrules`,
			`..${sep}CONVENTIONS.md`, // Read by root .aider.conf.yml
			`..${sep}global_rules.md`, // Found in vcsRoot
			`..${sep}DOCS.md`,
			`..${sep}QUICKSTART.md`, // Read by sub_dir .aider.conf.yml
		]);

		expect(additions).to.be.an.instanceOf(Set);
		expect(norm(Array.from(additions))).to.have.members(expectedPaths);
		expect(additions.size).to.equal(expectedPaths.length);

		// Verify the excluded files are not present
		expect(additions.has(normalize('CONVENTIONS.md'))).to.be.false;
		expect(additions.has(normalize(`..${sep}.cursorrules`))).to.be.false;
	});

	it('should handle empty or whitespace-only file selections gracefully', async () => {
		const fileSelection = ['', '   '];
		const additions = await includeAlternativeAiToolFiles(fileSelection, {
			cwd: testCwd,
			vcsRoot: repoRoot,
		});
		// Should still find files based on CWD and VCS root hierarchy
		const expectedPaths = norm([
			// Files relative to testCwd ('sub_dir')
			'.cursorrules',
			'CONVENTIONS.md',
			'DOCS.md',
			'.aider.conf.yml',
			// Files relative to cwd, found in parent ('/')
			`..${sep}.cursorrules`,
			`..${sep}.aider.conf.yml`,
			`..${sep}.cursor${sep}rules${sep}root_rule.mdc`,
			`..${sep}.cursor${sep}rules${sep}another_rule.mdc`,
			`..${sep}.windsurfrules`,
			`..${sep}CONVENTIONS.md`, // Read by root .aider.conf.yml
			`..${sep}global_rules.md`, // Found in vcsRoot
			`..${sep}DOCS.md`,
			`..${sep}QUICKSTART.md`, // Read by sub_dir .aider.conf.yml
		]);
		expect(additions).to.be.an.instanceOf(Set);
		expect(norm(Array.from(additions))).to.have.members(expectedPaths);
		expect(additions.size).to.equal(expectedPaths.length);
	});

	it('should handle file paths outside the VCS root', async () => {
		// Setup outside VCS root
		mock.restore();
		const outsideDir = resolve('/outside');
		mock({
			[outsideDir]: {
				'outer_file.txt': '',
				'DOCS.md': 'Outer docs',
			},
			[repoRoot]: {
				// Keep repo structure for comparison
				'file1.txt': '',
				'DOCS.md': 'Repo Root DOCS.md',
				sub_dir: {
					'sub_file1.ts': '',
					'DOCS.md': 'Subdir DOCS.md',
				},
			},
		});

		const currentTestCwd = join(repoRoot, 'sub_dir'); // CWD inside repo

		// Selection includes a file inside and one outside (absolute path)
		const fileSelection = ['sub_file1.ts', join(outsideDir, 'outer_file.txt')];
		const additions = await includeAlternativeAiToolFiles(fileSelection, {
			cwd: currentTestCwd,
			vcsRoot: repoRoot,
		});

		// Should find docs relative to sub_file1.ts up to repo root
		// Should find docs relative to outer_file.txt up to filesystem root, stopping traversal above VCS root if defined.
		// It will check the CWD and VCS root folders regardless.
		// It will also check the parents of /outside/outer_file.txt up to the root '/'.
		const expectedPaths = norm([
			// From sub_file1.ts hierarchy (relative to currentTestCwd: /mock-repo/sub_dir)
			'DOCS.md', // sub_dir/DOCS.md
			`..${sep}DOCS.md`, // mock-repo/DOCS.md (Repo Root DOCS.md)
			// From /outside/outer_file.txt hierarchy (relative to currentTestCwd: /mock-repo/sub_dir)
			// relative('/mock-repo/sub_dir', '/outside/DOCS.md') -> '../../outside/DOCS.md'
			`..${sep}..${sep}outside${sep}DOCS.md`, // /outside/DOCS.md
		]);

		expect(additions).to.be.an.instanceOf(Set);
		expect(norm(Array.from(additions))).to.have.members(expectedPaths);
		expect(additions.size).to.equal(expectedPaths.length);
	});

	it('should correctly parse .aider.conf.yml with string and list "read" properties', async () => {
		// File selection relative to CWD (/mock-repo/sub_dir)
		const fileSelection = ['sub_file1.ts']; // Triggers checks in sub_dir and root
		const additions = await includeAlternativeAiToolFiles(fileSelection, {
			cwd: testCwd,
			vcsRoot: repoRoot,
		});

		// Check specifically for files read via .aider.conf.yml
		// Root config reads: 'CONVENTIONS.md' -> ../CONVENTIONS.md relative to testCwd
		// Subdir config reads: ['../QUICKSTART.md', 'non_existent.md'] -> ../QUICKSTART.md relative to CWD

		const expectedAiderReadPaths = norm([
			`..${sep}CONVENTIONS.md`, // From root config
			`..${sep}QUICKSTART.md`, // From subdir config
		]);

		const aiderConfigFiles = norm([
			'.aider.conf.yml', // Subdir config file itself
			`..${sep}.aider.conf.yml`, // Root config file itself
		]);

		expect(additions).to.contain.all.keys(aiderConfigFiles);
		expect(additions).to.contain.all.keys(expectedAiderReadPaths);

		// Ensure non_existent.md was not added
		expect(norm(Array.from(additions))).to.not.contain('non_existent.md');
	});
});
