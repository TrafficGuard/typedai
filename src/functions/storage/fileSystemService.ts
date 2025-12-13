import { execSync } from 'node:child_process';
import { access, existsSync, lstat, mkdir, readFile, readdir, rename, stat, unlink, writeFile } from 'node:fs';
import path, { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import ignore, { type Ignore } from 'ignore';
import type Pino from 'pino';
import { agentContext } from '#agent/agentContext';
import { TYPEDAI_FS } from '#app/appDirs';
import { parseArrayParameterValue } from '#functionSchema/functionUtils';
import { LlmTools } from '#functions/llmTools';
import { Git } from '#functions/scm/git';
import { countTokens } from '#llm/tokens';
import { logger } from '#o11y/logger';
import { getActiveSpan } from '#o11y/trace';
import { FileNotFound } from '#shared/errors';
import type { FileSystemNode, IFileSystemService } from '#shared/files/fileSystemService';
import type { VersionControlSystem } from '#shared/scm/versionControlSystem';
import { arg, spawnCommand } from '#utils/exec';
import { formatXmlContent } from '#utils/xml-utils';

const fs = {
	readFile: promisify(readFile),
	stat: promisify(stat),
	readdir: promisify(readdir),
	access: promisify(access),
	mkdir: promisify(mkdir),
	lstat: promisify(lstat),
	writeFile: promisify(writeFile),
	unlink: promisify(unlink),
	rename: promisify(rename),
};

// import fg from 'fast-glob';
// const globAsync = promisify(glob);

type FileFilter = (filename: string) => boolean;

// Cache paths to Git repositories and .gitignore files
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
export class FileSystemService implements IFileSystemService {
	/** The filesystem path */
	private workingDirectory = '';
	private basePath: string;
	private vcs: VersionControlSystem | null = null;
	log: Pino.Logger;

	// Returns true when the absolute path is inside a directory the service
	// should always allow: the original basePath OR the current workingDirectory OR the current Git repository root.
	private isPathAllowed(absPath: string): boolean {
		const vcsRoot = this.getVcsRoot(); // may be null
		return absPath.startsWith(this.basePath) || absPath.startsWith(this.workingDirectory) || (vcsRoot !== null && absPath.startsWith(vcsRoot));
	}

	/**
	 * @param basePath The root folder allowed to be accessed by this file system instance. This should only be accessed by system level
	 * functions. Generally getWorkingDirectory() should be used
	 */
	constructor(readonly basePathArg?: string) {
		this.basePath = basePathArg ?? process.cwd();

		const args = process.argv;
		const fsArg = args.find((arg) => arg.startsWith('--fs='));
		const fsEnvVar = process.env[TYPEDAI_FS];
		if (!basePathArg && fsArg) {
			const fsPath = fsArg.slice(5);
			if (existsSync(fsPath)) {
				this.basePath = fsPath;
				logger.info(`Setting basePath to ${fsPath}`);
			} else {
				throw new Error(`Invalid -fs arg value. ${fsPath} does not exist`);
			}
		} else if (!basePathArg && fsEnvVar) {
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

	getBasePath(): string {
		return this.basePath;
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
		if (dir === '/') dir = this.basePath; // A more sane behaviour if the agent provides '/'
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
		logger.debug(`setWorkingDirectory ${this.workingDirectory}`);
		this.vcs = null; // lazy loaded in getVcs()
	}

	async rename(filePath: string, newPath: string): Promise<void> {
		const serviceCwd = this.getWorkingDirectory();

		const oldAbsPath = path.isAbsolute(filePath) ? filePath : path.resolve(serviceCwd, filePath);
		const newAbsPath = path.isAbsolute(newPath) ? newPath : path.resolve(serviceCwd, newPath);

		if (!this.isPathAllowed(oldAbsPath)) {
			throw new Error(
				`Source path '${filePath}' (resolved to ${oldAbsPath}) is outside the allowed directories (basePath: ${this.basePath}, workingDirectory: ${this.workingDirectory}).`,
			);
		}
		if (!this.isPathAllowed(newAbsPath)) {
			throw new Error(
				`Destination path '${newPath}' (resolved to ${newAbsPath}) is outside the allowed directories (basePath: ${this.basePath}, workingDirectory: ${this.workingDirectory}).`,
			);
		}

		try {
			// Check if source exists. fs.rename will also throw but this gives a clearer error.
			await fs.access(oldAbsPath);
		} catch (e) {
			throw new FileNotFound(`Source file or directory not found: ${filePath}`);
		}

		try {
			// Ensure parent directory of the new path exists, as fs.rename doesn't create it.
			const newParentPath = path.dirname(newAbsPath);
			await fs.mkdir(newParentPath, { recursive: true });

			await fs.rename(oldAbsPath, newAbsPath);
			this.log.debug(`Renamed '${filePath}' to '${newPath}'`);
		} catch (error) {
			this.log.error(`Error renaming from '${filePath}' to '${newPath}': ${error.message}`);
			throw error;
		}
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
	 * @param storeToMemory if the file contents should be stored to memory. The key will be in the format file-contents-<FileSystem.workingDirectory>-<dirPath>. Defaults to false.
	 * @returns the contents of the file(s) in format <file_contents path="dir/file1">file1 contents</file_contents><file_contents path="dir/file2">file2 contents</file_contents>
	 */
	async getFileContentsRecursivelyAsXml(dirPath: string, storeToMemory = false, filter: (path: string) => boolean = () => true): Promise<string> {
		const filenames = (await this.listFilesRecursively(dirPath)).filter(filter);
		const contents = await this.readFilesAsXml(filenames);
		const agent = agentContext();
		if (storeToMemory && agent) agent.memory[`file-contents-${join(this.getWorkingDirectory(), dirPath)}`] = contents;
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
		// ripgrep returns 1 if no matches are found, and doesn't return any output
		if (!results.stdout && !results.stderr) return '';

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
		if (results.exitCode > 0) throw new Error(`${results.stdout}${results.stderr}`);
		return compactRipgrepOutput(results.stdout);
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

		// The root for calculating relative paths should be the git root, not always the CWD.
		const recursionRoot = gitRoot ?? this.workingDirectory;
		const files: string[] = await this.listFilesRecurse(recursionRoot, startPath, ig, useGitIgnore, gitRoot);
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
			const fullPath = path.join(dirPath, dirent.name);
			const relativePath = path.relative(rootPath, fullPath);

			// A path is invalid for the `ignore` library if it's absolute or starts with `../`.
			// This happens when `fullPath` is not inside `rootPath`. In this case,
			// .gitignore rules from within `rootPath` should not apply, so we don't ignore it.
			const isInvalidForIgnore = relativePath.startsWith('..') || path.isAbsolute(relativePath);

			let shouldIgnore = false;
			if (useGitIgnore && !isInvalidForIgnore) {
				shouldIgnore = dirent.isDirectory() ? mergedIg.ignores(relativePath) || mergedIg.ignores(`${relativePath}/`) : mergedIg.ignores(relativePath);
			}

			if (!shouldIgnore) {
				if (dirent.isDirectory()) {
					files.push(...(await this.listFilesRecurse(rootPath, fullPath, mergedIg, useGitIgnore, gitRoot, filter)));
				} else {
					files.push(fullPath);
				}
			}
		}
		return files;
	}

	/**
	 * Gets the contents of a local file on the file system. If the user has only provided a filename you may need to find the full path using the searchFilesMatchingName function.
	 * @param filePath The file path to read the contents of (e.g. src/index.ts)
	 * @returns the contents of the file
	 */
	async readFile(filePath: string): Promise<string> {
		this.log.debug({ func: 'readFile', filePath, cwd: this.getWorkingDirectory(), basePath: this.basePath }, 'Reading file');
		let absolutePathToRead: string;

		if (path.isAbsolute(filePath)) {
			absolutePathToRead = path.normalize(filePath);
		} else {
			absolutePathToRead = path.resolve(this.getWorkingDirectory(), filePath);
		}

		// Security check:
		if (!this.isPathAllowed(absolutePathToRead)) {
			this.log.warn(
				{ absolutePathToRead, basePath: this.basePath, workingDirectory: this.workingDirectory },
				'Path is outside the allowed directories. Denying access.',
			);
			throw new FileNotFound(`File ${filePath} (resolved to ${absolutePathToRead}) is outside the allowed directories.`);
		}

		try {
			// Ensure file actually exists before reading, fs.readFile might not give a clear ENOENT
			// await fs.access(absolutePathToRead); // fs.readFile will throw if it doesn't exist.
			const contents = (await fs.readFile(absolutePathToRead)).toString();
			getActiveSpan()?.setAttributes({ resolvedPath: absolutePathToRead, size: contents.length });
			return contents;
		} catch (e: any) {
			// Log the error with more context
			this.log.warn(
				{ path: filePath, resolvedPath: absolutePathToRead, cwd: this.getWorkingDirectory(), error: e.message, code: e.code },
				'Error during readFile',
			);
			throw new FileNotFound(
				`File ${filePath} (resolved to ${absolutePathToRead}) does not exist or cannot be read. CWD: ${this.getWorkingDirectory()}`,
				e.code,
			);
		}
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
	 * @param {Array<string | string[]>} filePaths The files paths to read the contents of
	 * @returns {Promise<string>} the contents of the file(s) in format <file_contents path="dir/file1">file1 contents</file_contents><file_contents path="dir/file2">file2 contents</file_contents>
	 */
	async readFilesAsXml(filePaths: string | string[], includeTokenCount = false): Promise<string> {
		if (!Array.isArray(filePaths)) {
			filePaths = parseArrayParameterValue(filePaths);
		}
		const fileContents: Map<string, string> = await this.readFiles(filePaths);
		return this.formatFileContentsAsXml(fileContents, includeTokenCount);
	}

	async formatFileContentsAsXml(fileContents: Map<string, string>, includeTokenCount = false): Promise<string> {
		let result = '';

		for (const [path, contents] of fileContents) {
			const tokens = includeTokenCount ? ` tokens="${await countTokens(contents)}"` : '';
			result += `<file_content file_path="${path}"${tokens}>${formatXmlContent(contents)}</file_content>\n`;
		}
		return result;
	}

	/**
	 * Check if a file exists. A filePath starts with / is it relative to FileSystem.basePath, otherwise its relative to FileSystem.workingDirectory
	 * @param filePath The file path to check
	 * @returns true if the file exists, else false
	 */
	async fileExists(filePath: string): Promise<boolean> {
		this.log.debug({ func: 'fileExists', filePath, cwd: this.getWorkingDirectory(), basePath: this.basePath }, 'Checking file existence');
		let absolutePathToCheck: string;

		if (path.isAbsolute(filePath)) {
			absolutePathToCheck = path.normalize(filePath);
		} else {
			absolutePathToCheck = path.resolve(this.getWorkingDirectory(), filePath);
		}

		// Security check:
		if (!this.isPathAllowed(absolutePathToCheck)) {
			this.log.warn(
				{ absolutePathToCheck, basePath: this.basePath, workingDirectory: this.workingDirectory },
				'Path is outside the allowed directories. Denying access.',
			);
			return false;
		}

		try {
			// Use the local fs object which is promisified and should be mocked in tests
			await fs.access(absolutePathToCheck);
			this.log.debug({ absolutePathToCheck }, 'fileExists check successful');
			return true;
		} catch (error) {
			// Log the error message for more context, but still return false
			this.log.debug({ absolutePathToCheck, error: error.message }, 'fileExists check failed (fs.access error or file not found)');
			return false;
		}
	}

	async directoryExists(dirPath: string): Promise<boolean> {
		this.log.debug({ func: 'directoryExists', dirPath, cwd: this.getWorkingDirectory(), basePath: this.basePath }, 'Checking directory existence');
		let absolutePathToCheck: string;

		if (path.isAbsolute(dirPath)) {
			absolutePathToCheck = path.normalize(dirPath);
		} else {
			absolutePathToCheck = path.resolve(this.getWorkingDirectory(), dirPath);
		}

		// Security check:
		if (!this.isPathAllowed(absolutePathToCheck)) {
			this.log.warn(
				{ absolutePathToCheck, basePath: this.basePath, workingDirectory: this.workingDirectory },
				'Path is outside the allowed directories. Denying access.',
			);
			return false;
		}

		try {
			// Use the local fs object which is promisified
			const stats = await fs.stat(absolutePathToCheck);
			const isDirectory = stats.isDirectory();
			this.log.debug({ absolutePathToCheck, isDirectory }, 'directoryExists stat successful');
			return isDirectory;
		} catch (error) {
			this.log.debug({ absolutePathToCheck, error: error.message }, 'directoryExists stat failed (error or path not found/not a directory)');
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
		const serviceCwd = this.getWorkingDirectory();
		let resolvedPath: string;

		if (path.isAbsolute(filePath)) {
			resolvedPath = path.normalize(filePath);
		} else {
			resolvedPath = path.resolve(serviceCwd, filePath);
		}

		// Security check
		if (!this.isPathAllowed(resolvedPath)) {
			this.log.error(
				{ resolvedPath, basePath: this.basePath, workingDirectory: this.workingDirectory },
				'Path is outside the allowed directories. Denying write.',
			);
			throw new Error(`Cannot write file ${filePath} (resolved to ${resolvedPath}). Path is outside allowed directories.`);
		}

		this.log.debug(`Writing file "${filePath}" (resolved: "${resolvedPath}") with ${contents.length} chars`);
		const parentPath = path.dirname(resolvedPath);
		await fs.mkdir(parentPath, { recursive: true });
		await fs.writeFile(resolvedPath, contents);
	}

	async deleteFile(filePath: string): Promise<void> {
		const fileSystemPath = filePath.startsWith(this.basePath) ? filePath : join(this.getWorkingDirectory(), filePath);
		logger.debug(`Deleting file "${filePath}" from ${fileSystemPath}`);
		try {
			await fs.unlink(fileSystemPath);
		} catch (error: any) {
			if (error.code !== 'ENOENT') {
				logger.error(`Failed to delete file ${fileSystemPath}: ${error}`);
				throw error;
			}
			// If file doesn't exist, it's not an error for a delete operation.
			logger.debug(`File not found, skipping delete: ${fileSystemPath}`);
		}
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
			const fileName = isFile && parts.length ? parts[parts.length - 1]! : '';

			if (!tree[dirPath]) tree[dirPath] = [];

			if (isFile) tree[dirPath].push(fileName);
		});

		return tree;
	}

	/**
	 * Generates a hierarchical representation of the file system structure starting from a given path,
	 * respecting .gitignore rules if enabled.
	 *
	 * @param dirPath The starting directory path, relative to the working directory or absolute. Defaults to the working directory.
	 * @param useGitIgnore Whether to respect .gitignore rules. Defaults to true.
	 * @returns A Promise resolving to the root FileSystemNode representing the requested directory structure, or null if the path is not a directory.
	 */
	async getFileSystemNodes(dirPath = './', useGitIgnore = true): Promise<FileSystemNode | null> {
		const serviceWorkingDir = this.getWorkingDirectory();
		this.log.debug(`getFileSystemNodes cwd: ${serviceWorkingDir}, requested path: ${dirPath}, useGitIgnore: ${useGitIgnore}`);

		const startPathAbs = path.isAbsolute(dirPath) ? dirPath : path.resolve(serviceWorkingDir, dirPath);

		// Security check: Ensure the resolved path is within the basePath
		if (!startPathAbs.startsWith(this.basePath)) {
			this.log.warn(`Attempted to access path outside basePath: ${startPathAbs} (input: ${dirPath})`);
			return null; // Or throw an error, depending on desired strictness
		}

		let startStat: any;
		try {
			startStat = await fs.lstat(startPathAbs);
		} catch (e) {
			this.log.warn(`Path not found or inaccessible: ${startPathAbs} (input: ${dirPath})`);
			return null; // Path doesn't exist
		}

		if (!startStat.isDirectory()) {
			this.log.warn(`Path is not a directory: ${startPathAbs} (input: ${dirPath})`);
			return null; // Path is a file, not a directory
		}

		const gitRoot = useGitIgnore ? this.getVcsRoot() : null;
		// Load ignore rules applicable *at* the starting directory level initially
		const rootIg: Ignore = useGitIgnore ? await this.loadGitignoreRules(startPathAbs, gitRoot) : ignore();

		const rootNode: FileSystemNode = {
			// Ensure path is relative to the service's working directory
			path: path.relative(serviceWorkingDir, startPathAbs) || '.', // Use '.' if startPathAbs is the working dir
			name: path.basename(startPathAbs),
			type: 'directory',
			children: [],
		};

		// Start the recursive build from the resolved absolute path
		rootNode.children = await this.buildNodeTreeRecursive(startPathAbs, serviceWorkingDir, rootIg, useGitIgnore, gitRoot);

		return rootNode;
	}

	/**
	 * Recursive helper function to build the FileSystemNode tree.
	 * @param currentPathAbs Absolute path of the directory currently being processed.
	 * @param serviceWorkingDir Absolute path of the service's working directory (for relative path calculation).
	 * @param parentIg Ignore rules inherited from the parent directory.
	 * @param useGitIgnore Whether to respect .gitignore rules.
	 * @param gitRoot Absolute path to the git repository root, if applicable.
	 * @returns A Promise resolving to an array of FileSystemNode children for the current directory.
	 */
	async buildNodeTreeRecursive(
		currentPathAbs: string,
		serviceWorkingDir: string,
		parentIg: Ignore,
		useGitIgnore: boolean,
		gitRoot: string | null,
	): Promise<FileSystemNode[]> {
		const children: FileSystemNode[] = [];
		let currentLevelIg = parentIg; // Start with rules from parent

		// Load .gitignore rules specific to this directory, if applicable, and combine them
		if (useGitIgnore) {
			try {
				// Check if a .gitignore exists *in this specific directory*
				const gitIgnorePath = path.join(currentPathAbs, '.gitignore');
				await fs.access(gitIgnorePath); // Check existence first

				// If it exists, load its rules. loadGitignoreRules handles caching.
				// We only need the rules *from this level*, not cumulative from root again.
				const specificIg = ignore();
				const lines = (await fs.readFile(gitIgnorePath, 'utf8'))
					.split('\n')
					.map((line) => line.trim())
					.filter((line) => line.length && !line.startsWith('#'));
				specificIg.add(lines);

				// Combine parent rules with specific rules for this directory
				// ignore.js handles precedence: later rules override earlier ones if conflicting.
				currentLevelIg = ignore().add(parentIg).add(specificIg);
			} catch {
				// No .gitignore in this specific directory, or not accessible.
				// Keep using the rules inherited from the parent (currentLevelIg = parentIg).
			}
		}

		try {
			const dirents = await fs.readdir(currentPathAbs, { withFileTypes: true });

			for (const dirent of dirents) {
				const direntName = dirent.name;
				// Always ignore .git directory
				if (useGitIgnore && direntName === '.git') {
					continue;
				}

				const direntPathAbs = path.join(currentPathAbs, direntName);
				// Calculate path relative to the *service's working directory* for ignore checks and node path
				const direntPathRel = path.relative(serviceWorkingDir, direntPathAbs);

				// Check if the item should be ignored using the combined rules for this level
				// Need to check both the path and the path ending with '/' for directories
				if (useGitIgnore && (currentLevelIg.ignores(direntPathRel) || (dirent.isDirectory() && currentLevelIg.ignores(`${direntPathRel}/`)))) {
					// this.log.trace(`Ignoring ${direntPathRel}`);
					continue; // Skip ignored item
				}

				const node: FileSystemNode = {
					path: direntPathRel, // Path relative to service working dir
					name: direntName,
					type: dirent.isDirectory() ? 'directory' : 'file',
				};

				if (dirent.isDirectory()) {
					// Recursively get children for subdirectories, passing down the combined ignore rules for this level
					node.children = await this.buildNodeTreeRecursive(direntPathAbs, serviceWorkingDir, currentLevelIg, useGitIgnore, gitRoot);
				}

				children.push(node);
			}
		} catch (error) {
			// Log error but potentially continue if possible, or rethrow depending on desired behavior
			this.log.error(`Error reading directory ${currentPathAbs}: ${error.message}`);
			// Depending on strictness, you might want to throw here or return partial results
			// For now, just log and return the children found so far
		}

		// Sort children: directories first, then files, alphabetically within each group
		children.sort((a, b) => {
			if (a.type === b.type) {
				return a.name.localeCompare(b.name); // Alphabetical sort within type
			}
			return a.type === 'directory' ? -1 : 1; // Directories first
		});

		return children;
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
			// Use execSync directly from node:child_process to break the recursive dependency on execCmdSync.
			// execSync throws an error if the command fails (e.g., not a git repo), which is handled by the catch block.
			const gitRoot = execSync('git rev-parse --show-toplevel', {
				cwd: this.workingDirectory,
				encoding: 'utf8',
				stdio: 'pipe', // Prevent command output from polluting the console
				env: { ...process.env, PATH: `${process.env.PATH}:/bin:/usr/bin` }, // Ensure git is in PATH
			}).trim();

			if (!gitRoot) return null; // Handle case where command succeeds but output is empty

			logger.debug(`Adding git root ${gitRoot} for working dir ${this.workingDirectory}`);
			gitRootMapping.set(this.workingDirectory, gitRoot);

			return gitRoot;
		} catch (e) {
			// This is an expected failure case when not in a git repository.
			// Log at debug level to avoid cluttering logs with non-error information.
			logger.debug(`'git rev-parse' failed in '${this.workingDirectory}', indicating it's not a git repository or git is not installed.`);
			return null;
		}
	}
}

/**
 * Compacts the output of ripgrep by outputting the filename only once per match
 * @param raw
 * @returns
 */
function compactRipgrepOutput(raw: string): string {
	if (!raw.trim()) return raw;
	const out: string[] = [];
	let currentFile: string | undefined;

	for (const line of raw.split('\n')) {
		if (line === '--') {
			// section separator
			out.push('--');
			currentFile = undefined; // force header on next real line
			continue;
		}
		const match = /^(.+?)([:\-])(.*)$/.exec(line); // filePath + ':' | '-' + rest
		if (!match) {
			out.push(line);
			continue;
		} // defensive – keep as is
		const [, file, delim, rest] = match;

		if (file !== currentFile) {
			// new file ⇒ print header once
			currentFile = file;
			out.push(`${file}:`);
		}
		out.push(`${delim} ${rest!.trimStart()}`); // keep “- ” or “: ” indicator
	}
	return out.join('\n');
}
