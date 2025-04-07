import path, { resolve } from 'path';
import { expect } from 'chai';
import { FileSystemService } from './fileSystemService';

describe('FileSystem', () => {
	describe.skip('setWorkingDirectory with fakePath', () => {
		let fileSystem: FileSystemService;
		beforeEach(() => {
			fileSystem = new FileSystemService();
		});

		it('should be able to set a path from the baseDir when the new working directory starts with /', async () => {
			fileSystem.setWorkingDirectory('/otherWorkDir');
			fileSystem.setWorkingDirectory('/newWorkDir');
			expect(fileSystem.getWorkingDirectory()).to.equal('/basePath/newWorkDir');
		});

		it('should be able to set a relative new working directory', async () => {
			const fileSystem = new FileSystemService('/basePath');
			fileSystem.setWorkingDirectory('dir1');
			fileSystem.setWorkingDirectory('dir2');
			expect(fileSystem.getWorkingDirectory()).to.equal('/basePath/dir1/dir2');
		});

		it('should be able to navigate up a directory', async () => {
			const fileSystem = new FileSystemService('/basePath');
			fileSystem.setWorkingDirectory('dir1/dir2');
			fileSystem.setWorkingDirectory('..');
			expect(fileSystem.getWorkingDirectory()).to.equal('/basePath/dir1');
		});

		it('should assume if the new working directory starts with basePath, then its the basePath', async () => {
			const fileSystem = new FileSystemService('/basePath');
			fileSystem.setWorkingDirectory('/basePath/dir1');
			expect(fileSystem.getWorkingDirectory()).to.equal('/basePath/dir1');
		});

		it('should not allow setting the working directory higher than the basePath', () => {
			fileSystem.setWorkingDirectory('dir1');
			fileSystem.setWorkingDirectory('../..');
			expect(resolve(fileSystem.getWorkingDirectory())).to.equal(resolve(fileSystem.basePath));

			fileSystem.setWorkingDirectory('/..');
			expect(resolve(fileSystem.getWorkingDirectory())).to.equal(resolve(fileSystem.basePath));

			fileSystem.setWorkingDirectory('./../..');
			expect(resolve(fileSystem.getWorkingDirectory())).to.equal(resolve(fileSystem.basePath));
		});
	});

	describe('setWorkingDirectory with real project path', () => {
		const fileSystem = new FileSystemService();

		it('should set the real working directory with a relative path', async () => {
			const fileSystem = new FileSystemService();
			fileSystem.setWorkingDirectory('frontend');
			const exists = await fileSystem.fileExists('angular.json');
			expect(exists).to.equal(true);
		});
	});

	describe('fileExists', () => {
		const fileSystem = new FileSystemService();
		it('should return true if a file exists', async () => {
			expect(await fileSystem.fileExists('package.json')).to.be.true;
			expect(await fileSystem.fileExists('/package.json')).to.true;
			expect(await fileSystem.fileExists('./package.json')).to.be.true;
		});
		it('should return false if a file doesnt exist', async () => {
			expect(await fileSystem.fileExists('./apivheoirvaifvjaoiergalenrbna')).to.be.false;
		});

		it('should return the correct result when the working directory has been set', async () => {
			const fileSystem = new FileSystemService();
			fileSystem.setWorkingDirectory('frontend');
			let exists = await fileSystem.fileExists('angular.json');
			expect(exists).to.equal(true);
			exists = await fileSystem.fileExists('src/main.ts');
			expect(exists).to.equal(true);
		});
	});

	describe('listFilesRecursively', () => {
		describe('test filesystem', () => {
			let fileSystem: FileSystemService;
			beforeEach(() => {
				// set the workingDirectory to test/filesystem
				fileSystem = new FileSystemService(path.join(process.cwd(), 'test', 'filesystem'));
			});

			it('should list all files under the filesystem baseDir honouring .gitignore files in current and sub-directories', async () => {
				const files: string[] = await fileSystem.listFilesRecursively();

				expect(files).to.contain('toplevel');
				expect(files).to.contain('dir1/file1a');
				expect(files).to.contain('dir1/file1b');
				expect(files).to.contain('dir1/dir2/dir3/file3a');
				expect(files).not.to.contain('dir1/dir2/file2a'); // dir1/dir2/.gitignore ignore file2a
				expect(files).not.to.contain('dir1/dir2/dir3/file3b'); // .gitignore ignore file3b
			});
			it('should list files and folders in working directory honouring .gitignore in current and parent directory', async () => {
				fileSystem.setWorkingDirectory('dir1/dir2');
				const files: string[] = await fileSystem.listFilesRecursively();
				// file2a is ignored by the .gitignore in the current directory
				// file3b is ignored by the .gitignore in the parent directory
				expect(files).to.deep.equal(['.gitignore', 'dir3/file3a']);
			});
		});
	});

	describe('listFilesInDirectory', () => {
		const fileSystem = new FileSystemService();
		it('should list files and folders only in the current directory', async () => {
			const files: string[] = await fileSystem.listFilesInDirectory('./');
			expect(files).to.include('package.json');
			expect(files).not.to.include('src/index.ts');
		});
		it('should list files and folders in the src directory', async () => {
			let files: string[] = await fileSystem.listFilesInDirectory('./src');
			expect(files).to.include('index.ts');
			expect(files).not.to.include('package.json');

			files = await fileSystem.listFilesInDirectory('src');
			expect(files).to.include('index.ts');
			expect(files).not.to.include('package.json');
		});
		it('should list files in the src directory when the working directory is src', async () => {
			fileSystem.setWorkingDirectory('./src');
			const files: string[] = await fileSystem.listFilesInDirectory('./');
			expect(files).to.include('index.ts');
			expect(files).not.to.include('package.json');
		});
	});

	describe('getMultipleFileContentsAsXml', () => {
		const fileSystem = new FileSystemService();
		it('should include files', async () => {
			const paths = ['package.json', './README.md', 'src/index.ts'];
			const contents: string = await fileSystem.readFilesAsXml(paths);

			expect(contents).to.include('file_content file_path="package.json"');
			expect(contents).to.include('file_content file_path="README.md"');
			expect(contents).to.include('file_content file_path="src/index.ts"');
		});
		it('should include files in the src directory', async () => {
			fileSystem.setWorkingDirectory('./src');
			// Test relative path from CWD (<root>/src)
			const xml1: string = await fileSystem.readFilesAsXml('./index.ts');
			expect(xml1).to.include('file_path="index.ts"');

			// Test path relative to basePath (<root>/index.ts)
			// The resulting file_path should be relative to the CWD (<root>/src)
			// const xml2: string = await fileSystem.readFilesAsXml('/index.ts');
			// expect(xml2).to.include('file_path="index.ts"');

			// Test implicit relative path from CWD (<root>/src)
			const xml3: string = await fileSystem.readFilesAsXml('index.ts');
			expect(xml3).to.include('file_path="index.ts"');
		});
	});

	describe('readFile', () => {
		const fileSystem = new FileSystemService();
		it('should get the file contents for the current directory', async () => {
			const samplePackageJsonContents = '@opentelemetry/instrumentation-http';
			let contents: string = await fileSystem.readFile('package.json');
			expect(contents).to.include(samplePackageJsonContents);
			contents = await fileSystem.readFile('package.json');
			expect(contents).to.include(samplePackageJsonContents);
			contents = await fileSystem.readFile('./package.json');
			expect(contents).to.include(samplePackageJsonContents);
		});
		it('should get the file contents in the working directory', async () => {
			fileSystem.setWorkingDirectory('./src');
			const sampleIndexTsContents = '#fastify/trace-init';
			let contents: string = await fileSystem.readFile('index.ts');
			expect(contents).to.include(sampleIndexTsContents);
			contents = await fileSystem.readFile('./index.ts');
			expect(contents).to.include(sampleIndexTsContents);
		});
	});

	/*
	 * Test with the real filesystem of this project which has nested .gitignores
	 * The server node.js project is at the root folder
	 * The frontend angular project is in the folder frontend
	 *
	 * Need to test that the .gitignore from the frontend subfolder applies to folder/files under it
	 */
	describe('getFileSystemTree', () => {
		it('should respect nested .gitignore files', async () => {
			const fileSystem = new FileSystemService();
			const tree = await fileSystem.getFileSystemTree();

			// Check that root-level .gitignore is respected
			expect(tree).not.to.include('node_modules');

			// Check that frontend/.gitignore is respected
			expect(tree).not.to.include('.angular');

			// Check that some expected files/directories are included
			expect(tree).to.include('package.json');
			expect(tree).to.include('frontend/src/');
		});
	});
});
