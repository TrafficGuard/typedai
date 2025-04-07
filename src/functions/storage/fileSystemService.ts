import { access, existsSync, lstat, mkdir, readFile, readdir, stat, writeFile } from 'node:fs';
import { resolve } from 'node:path';
import path, { join, relative } from 'path';
import { promisify } from 'util';
import ignore, { Ignore } from 'ignore';
import Pino from 'pino';
import { agentContext } from '#agent/agentContextLocalStorage';
import { parseArrayParameterValue } from '#functionSchema/functionUtils';
import { Git } from '#functions/scm/git';
import { VersionControlSystem } from '#functions/scm/versionControlSystem';
import { LlmTools } from '#functions/util';
import { logger } from '#o11y/logger';
import { getActiveSpan } from '#o11y/trace';
import { execCmdSync, spawnCommand } from '#utils/exec';
import { CDATA_END, CDATA_START, needsCDATA } from '#utils/xml-utils';
import { TYPEDAI_FS } from '../../appVars';

const fs = {
	readFile: promisify(readFile),
	stat: promisify(stat),
	readdir: promisify(readdir),
	access: promisify(access),
	mkdir: promisify(mkdir),
	lstat: promisify(lstat),
	writeFile: promisify(writeFile),
};

// import fg from 'fast-glob';
// const globAsync = promisify(glob);

type FileFilter = (filename: string) => boolean;

// Cache paths to Git repositories and .gitignore files
const gitRoots = new Set<string>();
/** Maps a directory to a git root */
const gitRootMapping = new Map<string, string>();
const gitIgnorePaths = new Set<string>();

/**
 * Interface to the file system based for an Agent which maintains the state of the working directory.
 *
 * Provides functions for LLMs to access the file system. Tools should generally use the functions as
 * - They are automatically included in OpenTelemetry tracing
 * - They use the working directory, so TypedAI can perform its actions outside the process running directory.
 *
 * The FileSystem is constructed with the basePath property which is like a virtual root.
 * Then the workingDirectory property is relative to the basePath.
 *
 * The functions which list/search filenames should return the paths relative to the workingDirectory.
 *
 * By default, the basePath is the current working directory of the process.
 */
export class FileSystemService {
	/** The filesystem path */
	private workingDirectory = '';
	vcs: VersionControlSystem | null = null;
	log: Pino.Logger;

	/**
	 * @param basePath The root folder allowed to be accessed by this file system instance. This should only be accessed by system level
	 * functions. Generally getWorkingDirectory() should be used
	 */
	constructor(public basePath?: string) {
		this.basePath ??= process.cwd();

		const args = process.argv;
		const fsArg = args.find((arg) => arg.startsWith('--fs='));
		const fsEnvVar = process.env[TYPEDAI_FS];
		if (fsArg) {
			const fsPath = fsArg.slice(5);
			if (existsSync(fsPath)) {
				this.basePath = fsPath;
				logger.info(`Setting basePath to ${fsPath}`);
			} else {
				throw new Error(`Invalid -fs arg value. ${fsPath} does not exist`);
			}
		} else if (fsEnvVar) {
			if (existsSync(fsEnvVar)) {
				this.basePath = fsEnvVar;
			} else {
				throw new Error(`Invalid ${TYPEDAI_FS} env var. ${fsEnvVar} does not exist`);
			}
		}
		this.workingDirectory = this.basePath;

		this.log = logger.child({ FileSystem: this.basePath });
	}

	toJSON() {
		return {
			basePath: this.basePath,
			workingDirectory: this.workingDirectory,
		};
	}
	fromJSON(obj: any): this | null {
		if (!obj) return null;
		this.basePath = obj.basePath;
		this.workingDirectory = obj.workingDirectory;
		return this;
	}

	/**
	 * @returns the full path of the working directory on the filesystem
	 */
	getWorkingDirectory(): string {
		return this.workingDirectory;
	}

	/**
	 * Set the working directory. The dir argument may be an absolute filesystem path, otherwise relative to the current working directory.
	 * If the dir starts with / it will first be checked as an absolute directory, then as relative path to the working directory.
	 * @param dir the new working directory
	 */
	setWorkingDirectory(dir: string): void {
		if (!dir) throw new Error('dir must be provided');
		let relativeDir = dir;
		let isAbsolute = false;
		// Check absolute directory path
		if (dir.startsWith('/')) {
			if (existsSync(dir)) {
				this.workingDirectory = dir;
				isAbsolute = true;
			} else {
				// try it as a relative path
				relativeDir = dir.substring(1);
			}
		}
		if (!isAbsolute) {
			const relativePath = path.join(this.getWorkingDirectory(), relativeDir);
			if (existsSync(relativePath)) {
				this.workingDirectory = relativePath;
			} else {
				throw new Error(`New working directory ${dir} does not exist (current working directory ${this.workingDirectory})`);
			}
		}

		// After setting the working directory, update the vcs (version control system) property
		logger.info(`setWorkingDirectory ${this.workingDirectory}`);
		this.vcs = null; // lazy loaded in getVcs()
	}

	/**
	 * Returns the file contents of all the files under the provided directory path
	 * @param dirPath the directory to return all the files contents under
	 * @returns the contents of the file(s) as a Map keyed by the file path
	 */
	async getFileContentsRecursively(dirPath: string, useGitIgnore = true): Promise<Map<string, string>> {
		const filenames = await this.listFilesRecursively(dirPath, useGitIgnore);
		return await this.readFiles(filenames);
	}

	/**
	 * Returns the file contents of all the files recursively under the provided directory path
	 * @param dirPath the directory to return all the files contents under
	 * @param storeToMemory if the file contents should be stored to memory. The key will be in the format file-contents-<FileSystem.workingDirectory>-<dirPath>
	 * @returns the contents of the file(s) in format <file_contents path="dir/file1">file1 contents</file_contents><file_contents path="dir/file2">file2 contents</file_contents>
	 */
	async getFileContentsRecursivelyAsXml(dirPath: string, storeToMemory: boolean, filter: (path: string) => boolean = () => true): Promise<string> {
		const filenames = (await this.listFilesRecursively(dirPath)).filter(filter);
		const contents = await this.readFilesAsXml(filenames);
		if (storeToMemory) agentContext().memory[`file-contents-${join(this.getWorkingDirectory(), dirPath)}`] = contents;
		return contents;
	}

	/**
	 * Searches for files on the filesystem (using ripgrep) with contents matching the search regex.
	 * @param contentsRegex the regular expression to search the content all the files recursively for
	 * @returns the list of filenames (with postfix :<match_count>) which have contents matching the regular expression.
	 */
	async searchFilesMatchingContents(contentsRegex: string): Promise<string> {
		// --count Only show count of line matches for each file
		// rg likes this spawnCommand. Doesn't work it others execs
		const results = await spawnCommand(`rg --count ${arg(contentsRegex)}`);
		if (results.stderr.includes('command not found: rg')) {
			throw new Error('Command not found: rg. Install ripgrep');
		}
		if (results.exitCode > 0) throw new Error(results.stderr);
		return results.stdout;
	}

	/**
	 * Searches for files on the filesystem (using ripgrep) with contents matching the search regex.
	 * The number of lines before/after the matching content will be included for context.
	 * The response format will be like
	 * <code>
	 * dir/subdir/filename
	 * 26-foo();
	 * 27-matchedString();
	 * 28-bar();
	 * </code>
	 * @param contentsRegex the regular expression to search the content all the files recursively for
	 * @param linesBeforeAndAfter the number of lines above/below the matching lines to include in the output
	 * @returns the matching lines from each files with additional lines above/below for context.
	 */
	async searchExtractsMatchingContents(contentsRegex: string, linesBeforeAndAfter = 0): Promise<string> {
		// --count Only show count of line matches for each file
		// rg likes this spawnCommand. Doesn't work it others execs
		const results = await spawnCommand(`rg ${arg(contentsRegex)} -C ${linesBeforeAndAfter}`);
		if (results.stderr.includes('command not found: rg')) {
			throw new Error('Command not found: rg. Install ripgrep');
		}
		if (results.exitCode > 0) throw new Error(results.stderr);
		return results.stdout;
	}

	/**
	 * Searches for files on the filesystem where the filename matches the regex.
	 * @param fileNameRegex the regular expression to match the filename.
	 * @returns the list of filenames matching the regular expression.
	 */
	async searchFilesMatchingName(fileNameRegex: string): Promise<string[]> {
		const regex = new RegExp(fileNameRegex);
		const files = await this.listFilesRecursively();
		return files.filter((file) => regex.test(file.substring(file.lastIndexOf(path.sep) + 1)));
	}

	/**
	 * Lists the file and folder names in a single directory.
	 * Folder names will end with a /
	 * @param dirPath the folder to list the files in. Defaults to the working directory
	 * @returns the list of file and folder names
	 */
	async listFilesInDirectory(dirPath = '.'): Promise<string[]> {
		const filter: FileFilter = (name) => true;
		const ig = ignore();

		// Determine the correct path based on whether dirPath is absolute or relative
		let readdirPath: string;
		if (path.isAbsolute(dirPath)) {
			readdirPath = dirPath;
		} else {
			readdirPath = path.join(this.getWorkingDirectory(), dirPath);
		}

		// Load .gitignore rules if present
		const gitIgnorePath = path.join(readdirPath, '.gitignore');
		try {
			await fs.access(gitIgnorePath);
			let lines = await fs.readFile(gitIgnorePath, 'utf8').then((data) => data.split('\n'));
			lines = lines.map((line) => line.trim()).filter((line) => line.length && !line.startsWith('#'), filter);
			ig.add(lines);
			ig.add('.git');
		} catch {
			// .gitignore doesn't exist or is not accessible, proceed without it
			ig.add('.git'); // Still ignore .git even if .gitignore is missing
		}

		const files: string[] = [];

		try {
			const dirents = await fs.readdir(readdirPath, { withFileTypes: true });
			for (const dirent of dirents) {
				const direntName = dirent.isDirectory() ? `${dirent.name}/` : dirent.name;
				// Calculate relative path for ignore check correctly based on the *root* working directory
				const relativePathForIgnore = path.relative(this.getWorkingDirectory(), path.join(readdirPath, dirent.name));

				if (!ig.ignores(relativePathForIgnore) && !ig.ignores(`${relativePathForIgnore}/`)) {
					// Push the base name (file or folder name), not the relative path
					files.push(direntName);
				}
			}
		} catch (error) {
			this.log.error(`Error reading directory: ${readdirPath}`, error);
			throw error; // Re-throw the error to be caught by the caller
		}

		return files;
	}

	/**
	 * List all the files recursively under the given path, excluding any paths in a .gitignore file if it exists
	 * @param dirPath
	 * @returns the list of files
	 */
	async listFilesRecursively(dirPath = './', useGitIgnore = true): Promise<string[]> {
		this.log.debug(`listFilesRecursively cwd: ${this.workingDirectory}`);

		const startPath = path.isAbsolute(dirPath) ? dirPath : path.join(this.getWorkingDirectory(), dirPath);
		// TODO check isn't going higher than this.basePath

		const gitRoot = useGitIgnore ? this.getVcsRoot() : null;
		const ig: Ignore = useGitIgnore ? await this.loadGitignoreRules(startPath, gitRoot) : ignore();

		const files: string[] = await this.listFilesRecurse(this.workingDirectory, startPath, ig, useGitIgnore, gitRoot);
		return files.map((file) => path.relative(this.workingDirectory, file));
	}

	async listFilesRecurse(
		rootPath: string,
		dirPath: string,
		parentIg: Ignore,
		useGitIgnore: boolean,
		gitRoot: string | null,
		filter: (file: string) => boolean = (name) => true,
	): Promise<string[]> {
		const files: string[] = [];

		const ig = useGitIgnore ? await this.loadGitignoreRules(dirPath, gitRoot) : ignore();
		const mergedIg = ignore().add(parentIg).add(ig);

		const dirents = await fs.readdir(dirPath, { withFileTypes: true });
		for (const dirent of dirents) {
			const relativePath = path.relative(rootPath, path.join(dirPath, dirent.name));
			if (dirent.isDirectory()) {
				if (!useGitIgnore || (!mergedIg.ignores(relativePath) && !mergedIg.ignores(`${relativePath}/`))) {
					files.push(...(await this.listFilesRecurse(rootPath, path.join(dirPath, dirent.name), mergedIg, useGitIgnore, gitRoot, filter)));
				}
			} else {
				if (!useGitIgnore || !mergedIg.ignores(relativePath)) {
					files.push(path.join(dirPath, dirent.name));
				}
			}
		}
		return files;
	}

	/**
	 * Gets the contents of a local file on the file system. If the user has only provided a filename you may need to find the full path using the searchFilesMatchingName function.
	 * @param filePath The file path to read the contents of (e.g. src/index.ts)
	 * @returns the contents of the file(s) in format <file_contents path="dir/file1">file1 contents</file_contents><file_contents path="dir/file2">file2 contents</file_contents>
	 */
	async readFile(filePath: string): Promise<string> {
		logger.debug(`readFile ${filePath}`);
		let contents: string;
		const relativeFullPath = path.join(this.getWorkingDirectory(), filePath);
		logger.debug(`Checking ${filePath} and ${relativeFullPath}`);

		try {
			// Check relative to current working directory first using async access
			await fs.access(relativeFullPath);
			getActiveSpan()?.setAttribute('resolvedPath', relativeFullPath);
			contents = (await fs.readFile(relativeFullPath)).toString();
		} catch {
			// If relative fails, check if it's an absolute path
			if (filePath.startsWith('/')) {
				try {
					await fs.access(filePath);
					getActiveSpan()?.setAttribute('resolvedPath', relativeFullPath);
					contents = (await fs.readFile(filePath)).toString();
				} catch (absError) {
					throw new Error(`File ${filePath} does not exist (checked as absolute and relative to ${this.getWorkingDirectory()})`);
				}
			} else {
				throw new Error(`File ${filePath} does not exist (relative to ${this.getWorkingDirectory()})`);
			}
			// try {
			// 	const matches = await this.searchFilesMatchingName(filePath);
			//  if (matches.length === 1) {
			// 		fullPath = matches[0];
			// 	}
			// } catch (e) {
			// 	console.log(e);
			// }
		}

		getActiveSpan()?.setAttribute('size', contents.length);
		return contents;
	}

	/**
	 * Gets the contents of a local file on the file system and returns it in XML tags
	 * @param filePath The file path to read the contents of (e.g. src/index.ts)
	 * @returns the contents of the file(s) in format <file_contents path="dir/file1">file1 contents</file_contents>
	 */
	async readFileAsXML(filePath: string): Promise<string> {
		return `<file_content file_path="${filePath}">\n${await this.readFile(filePath)}\n</file_contents>\n`;
	}

	/**
	 * Gets the contents of a list of local files. Input paths can be absolute or relative to the service's working directory.
	 * @param {Array<string>} filePaths The files paths to read the contents of.
	 * @returns {Promise<Map<string, string>>} the contents of the files in a Map object keyed by the file path *relative* to the service's working directory.
	 */
	async readFiles(filePaths: string[]): Promise<Map<string, string>> {
		const mapResult = new Map<string, string>();
		const serviceCwd = this.getWorkingDirectory();

		for (const inputPath of filePaths) {
			let absolutePathToRead: string;

			// Determine the absolute path to read based on the input path format
			if (path.isAbsolute(inputPath)) {
				// If the input path is already absolute, use it directly.
				// The basePath check later will ensure it's within allowed bounds.
				absolutePathToRead = inputPath;
			} else {
				// If the input path is relative, resolve it against the service's current working directory.
				absolutePathToRead = path.resolve(serviceCwd, inputPath);
			}

			// Prevent reading files outside the intended base directory
			if (!absolutePathToRead.startsWith(this.basePath)) {
				this.log.warn(`Attempted to read file outside basePath: ${absolutePathToRead} (input: ${inputPath})`);
				continue; // Skip this file
			}

			try {
				const contents = await fs.readFile(absolutePathToRead, 'utf8');
				// Always store the key relative to the service's working directory for consistency
				const relativeKey = path.relative(serviceCwd, absolutePathToRead);
				mapResult.set(relativeKey, contents);
			} catch (e) {
				// Log the path we actually tried to read
				this.log.warn(`readFiles Error reading ${absolutePathToRead} (input: ${inputPath}) ${e.message}`);
			}
		}
		return mapResult;
	}

	/**
	 * Gets the contents of a list of files, returning a formatted XML string of all file contents
	 * @param {Array<string>} filePaths The files paths to read the contents of
	 * @returns {Promise<string>} the contents of the file(s) in format <file_contents path="dir/file1">file1 contents</file_contents><file_contents path="dir/file2">file2 contents</file_contents>
	 */
	async readFilesAsXml(filePaths: string | string[]): Promise<string> {
		if (!Array.isArray(filePaths)) {
			filePaths = parseArrayParameterValue(filePaths);
		}
		const fileContents: Map<string, string> = await this.readFiles(filePaths);
		return this.formatFileContentsAsXml(fileContents);
	}

	formatFileContentsAsXml(fileContents: Map<string, string>): string {
		let result = '';

		fileContents.forEach((contents, path) => {
			const cdata = needsCDATA(contents);
			result += cdata
				? `<file_content file_path="${path}">${CDATA_START}\n${contents}\n${CDATA_END}</file_content>\n`
				: `<file_content file_path="${path}">\n${contents}\n</file_content>\n`;
		});
		return result;
	}

	/**
	 * Check if a file exists. A filePath starts with / is it relative to FileSystem.basePath, otherwise its relative to FileSystem.workingDirectory
	 * @param filePath The file path to check
	 * @returns true if the file exists, else false
	 */
	async fileExists(filePath: string): Promise<boolean> {
		// TODO remove the basePath checks. Either absolute or relative to this.cwd
		logger.debug(`fileExists: ${filePath}`);
		// Check if we've been given an absolute path
		if (filePath.startsWith(this.basePath)) {
			try {
				logger.debug(`fileExists check on: ${filePath}`);
				await fs.access(filePath);
				return true;
			} catch {}
		}
		// logger.info(`basePath ${this.basePath}`);
		// logger.info(`this.workingDirectory ${this.workingDirectory}`);
		// logger.info(`getWorkingDirectory() ${this.getWorkingDirectory()}`);
		const path = filePath.startsWith('/') ? resolve(this.basePath, filePath.slice(1)) : resolve(this.workingDirectory, filePath);
		try {
			logger.debug(`fileExists check on: ${path}`);
			await fs.access(path);
			return true;
		} catch {
			return false;
		}
	}

	/**
	 * Writes to a file. If the file path already exists an Error will be thrown. This will create any parent directories required,
	 * @param filePath The file path (either full filesystem path or relative to current working directory)
	 * @param contents The contents to write to the file
	 */
	async writeNewFile(filePath: string, contents: string): Promise<void> {
		if (await this.fileExists(filePath)) throw new Error(`File ${filePath} already exists. Cannot overwrite`);
		await this.writeFile(filePath, contents);
	}

	/**
	 * Writes to a file. If the file exists it will overwrite the contents. This will create any parent directories required,
	 * @param filePath The file path (either full filesystem path or relative to current working directory)
	 * @param contents The contents to write to the file
	 */
	async writeFile(filePath: string, contents: string): Promise<void> {
		const fileSystemPath = filePath.startsWith(this.basePath) ? filePath : join(this.getWorkingDirectory(), filePath);
		logger.debug(`Writing file "${filePath}" to ${fileSystemPath}`);
		const parentPath = path.dirname(fileSystemPath);
		await fs.mkdir(parentPath, { recursive: true });
		await fs.writeFile(fileSystemPath, contents);
	}

	/**
	 * Reads a file, then transforms the contents using a LLM to perform the described changes, then writes back to the file.
	 * @param {string} filePath The file to update
	 * @param {string} descriptionOfChanges A natual language description of the changes to make to the file contents
	 */
	async editFileContents(filePath: string, descriptionOfChanges: string): Promise<void> {
		const contents = await this.readFile(filePath);
		const updatedContent = await new LlmTools().processText(contents, descriptionOfChanges);
		await this.writeFile(filePath, updatedContent);
	}

	async loadGitignoreRules(startPath: string, gitRoot: string | null): Promise<Ignore> {
		const ig = ignore();
		let currentPath = startPath;

		// Continue until git root or filesystem root
		while (true) {
			const gitIgnorePath = path.join(currentPath, '.gitignore');
			const knownGitIgnore = gitIgnorePaths.has(gitIgnorePath);
			let gitignoreExists = false;
			if (knownGitIgnore) {
				gitignoreExists = true;
			} else {
				try {
					await fs.access(gitIgnorePath);
					gitignoreExists = true;
				} catch {
					// File doesn't exist or not accessible
				}
			}

			if (gitignoreExists) {
				const lines = (await fs.readFile(gitIgnorePath, 'utf8'))
					.split('\n')
					.map((line) => line.trim())
					.filter((line) => line.length && !line.startsWith('#'));
				ig.add(lines);

				if (!knownGitIgnore) gitIgnorePaths.add(gitIgnorePath);
			}

			// Check if we've reached the git root directory
			if (gitRoot && currentPath === gitRoot) {
				break;
			}

			// Determine the parent directory
			const parentPath = path.dirname(currentPath);

			// If we've reached the filesystem root, stop
			if (parentPath === currentPath) {
				break;
			}

			// Move to the parent directory for the next iteration
			currentPath = parentPath;
		}

		ig.add('.git');
		return ig;
	}

	async listFolders(dirPath = './'): Promise<string[]> {
		const workingDir = this.getWorkingDirectory();
		if (!path.isAbsolute(dirPath)) {
			dirPath = path.join(workingDir, dirPath);
		}
		try {
			const items = await fs.readdir(dirPath);
			const folders: string[] = [];

			for (const item of items) {
				const itemPath = path.join(dirPath, item);
				const stat = await fs.stat(itemPath);
				if (stat.isDirectory()) {
					folders.push(item); // Return only the subfolder name
				}
			}
			return folders;
		} catch (error) {
			console.error('Error reading directory:', error);
			return [];
		}
	}

	/**
	 * Recursively lists all folders under the given root directory.
	 * @param dir The root directory to start the search from. Defaults to the current working directory.
	 * @returns A promise that resolves to an array of folder paths relative to the working directory.
	 */
	async getAllFoldersRecursively(dir = './'): Promise<string[]> {
		const workingDir = this.getWorkingDirectory();
		const startPath = path.join(workingDir, dir);

		const gitRoot = this.getVcsRoot();
		const ig = await this.loadGitignoreRules(startPath, gitRoot);

		const folders: string[] = [];

		const recurse = async (currentPath: string) => {
			const relativePath = path.relative(workingDir, currentPath);
			if (!relativePath || (!ig.ignores(relativePath) && !ig.ignores(`${relativePath}/`))) {
				folders.push(relativePath);

				const dirents = await fs.readdir(currentPath, { withFileTypes: true });
				for (const dirent of dirents) {
					if (dirent.isDirectory()) {
						const childPath = path.join(currentPath, dirent.name);
						await recurse(childPath);
					}
				}
			}
		};
		await recurse(startPath);
		// Remove the root directory from the list if it was included
		return folders.filter((folder) => folder !== '.');
	}

	/**
	 * Generates a textual representation of a directory tree structure.
	 *
	 * This function uses listFilesRecursively to get all files and directories,
	 * respecting .gitignore rules, and produces an indented string representation
	 * of the file system hierarchy.
	 *
	 * @param {string} dirPath - The path of the directory to generate the tree for, defaulting to working directory
	 * @returns {Promise<string>} A string representation of the directory tree.
	 *
	 * @example
	 * Assuming the following directory structure:
	 * ./
	 *  ├── file1.txt
	 *  ├── images/
	 *  │   ├── logo.png
	 *  └── src/
	 *      └── utils/
	 *          └── helper.js
	 *
	 * The output would be:
	 * file1.txt
	 * images/
	 *   logo.png
	 * src/utils/
	 *   helper.js
	 */
	async getFileSystemTree(dirPath = './'): Promise<string> {
		const files = await this.listFilesRecursively(dirPath);
		const tree = new Map<string, string>();

		files.forEach((file) => {
			const parts = file.split(path.sep);
			const isFile = !file.endsWith('/');
			const dirPath = isFile ? parts.slice(0, -1).join(path.sep) : file;
			const fileName = isFile ? parts[parts.length - 1] : '';

			if (!tree.has(dirPath)) {
				tree.set(dirPath, `${dirPath}${dirPath ? '/' : ''}\n`);
			}

			if (isFile) {
				const existingContent = tree.get(dirPath) || '';
				tree.set(dirPath, `${existingContent}  ${fileName}\n`);
			}
		});

		return Array.from(tree.values()).join('');
	}

	/**
	 * Returns the filesystem structure
	 * @param dirPath
	 * @returns a record with the keys as the folders paths, and the list values as the files in the folder
	 */
	async getFileSystemTreeStructure(dirPath = './'): Promise<Record<string, string[]>> {
		const files = await this.listFilesRecursively(dirPath);
		const tree: Record<string, string[]> = {};

		files.forEach((file) => {
			const parts = file.split(path.sep);
			const isFile = !file.endsWith('/');
			const dirPath = isFile ? parts.slice(0, -1).join(path.sep) : file;
			const fileName = isFile ? parts[parts.length - 1] : '';

			if (!tree[dirPath]) tree[dirPath] = [];

			if (isFile) tree[dirPath].push(fileName);
		});

		return tree;
	}

	getVcs(): VersionControlSystem {
		if (!this.vcs) {
			if (this.getVcsRoot()) this.vcs = new Git(this);
		}
		if (!this.vcs) throw new Error('Not in a version controlled directory');
		return this.vcs;
	}

	/**
	 * Gets the version control service (Git) repository root folder, if the current working directory is in a Git repo, else null.
	 */
	getVcsRoot(): string | null {
		// First, check if workingDirectory is under any known Git roots
		if (gitRoots.has(this.workingDirectory)) return this.workingDirectory;
		// Do we need gitRoots now that we have gitRootMapping?
		const cachedRoot = gitRootMapping.get(this.workingDirectory);
		if (cachedRoot) return cachedRoot;

		// Check if the working directory actually exists before running git command
		// Use the original synchronous existsSync here as it's part of the setup for the sync execCmdSync call
		// if(!existsSync(this.workingDirectory)) {
		//     logger.warn(`Working directory ${this.workingDirectory} does not exist. Cannot determine Git root.`);
		//     return null;
		// }

		// If not found in cache, execute Git command
		try {
			// Use execCmdSync to get the Git root directory synchronously
			// Need to pass the workingDirectory to avoid recursion with the default workingDirectory arg
			const result = execCmdSync('git rev-parse --show-toplevel', this.workingDirectory);
			if (result.error) {
				logger.warn(result.stderr || result.error, `Git command failed in ${this.workingDirectory}. Not a git repository or git not found.`);
				return null;
			}
			const gitRoot = result.stdout.trim();
			logger.debug(`Adding git root ${gitRoot} for working dir ${this.workingDirectory}`);
			gitRoots.add(gitRoot);
			gitRootMapping.set(this.workingDirectory, gitRoot);

			return gitRoot;
		} catch (e) {
			logger.error(e, `Error checking if ${this.workingDirectory} is in a Git repo`);
			// Any unexpected errors also result in null
			return null;
		}
	}
}

/**
 * Sanitise arguments by single quoting and escaping single quotes in the value
 * @param arg command line argument value
 */
function arg(arg: string): string {
	return `'${arg.replace("'", "\\'")}'`;
}
