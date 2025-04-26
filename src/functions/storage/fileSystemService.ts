import { existsSync, lstat, mkdir, readFile, stat, writeFile, statSync } from 'node:fs'; // Added statSync
import { resolve } from 'node:path';
import path, { join, relative } from 'node:path';
import { promisify } from 'node:util';
// import ignore, { type Ignore } from 'ignore'; // No longer used directly here
import type Pino from 'pino';
import { agentContext } from '#agent/agentContextLocalStorage';
import { parseArrayParameterValue } from '#functionSchema/functionUtils';
import { Git } from '#functions/scm/git';
import type { VersionControlSystem } from '#functions/scm/versionControlSystem';
import { FileSystemListService } from '#functions/storage/fileSystemListService'; // Import the new service
import { LlmTools } from '#functions/util';
import { logger } from '#o11y/logger';
import { getActiveSpan } from '#o11y/trace';
import { execCmdSync } from '#utils/exec'; // spawnCommand no longer used here
import { CDATA_END, CDATA_START, needsCDATA } from '#utils/xml-utils';
import { TYPEDAI_FS } from '../../appVars';

const fs = {
	readFile: promisify(readFile),
	stat: promisify(stat),
	// readdir: promisify(readdir), // Moved to list service logic
	// access: promisify(access), // No longer used directly here
	mkdir: promisify(mkdir),
	lstat: promisify(lstat),
	writeFile: promisify(writeFile),
};

// CDATA utils needed for readFileAsXML and formatFileContentsAsXml
// import { CDATA_END, CDATA_START, needsCDATA } from '#utils/xml-utils'; // Removed duplicate
// import { TYPEDAI_FS } from '../../appVars'; // Removed duplicate

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
	/** The filesystem path for the root of operations for this service instance. */
	public basePath: string;
	/** The current working directory, relative to which operations are performed. Must be within basePath. */
	private workingDirectory = '';
	/** The service handling file listing and searching. */
	public listService: FileSystemListService;
	/** Version control system instance, lazy-loaded. */
	vcs: VersionControlSystem | null = null;
	/** Logger instance. */
	log: Pino.Logger;

	/**
	 * @param basePath The root folder allowed to be accessed by this file system instance. Defaults to process.cwd() or specific env/args.
	 */
	constructor(basePath?: string) {
		let resolvedBasePath = basePath ?? process.cwd();

		// Override basePath from args or env vars if provided
		const args = process.argv;
		const fsArg = args.find((arg) => arg.startsWith('--fs=')); // e.g., --fs=/path/to/use
		const fsEnvVar = process.env[TYPEDAI_FS]; // Environment variable override

		if (fsArg) {
			const fsPath = fsArg.slice(5);
			if (existsSync(fsPath)) {
				resolvedBasePath = fsPath;
				logger.info(`Overriding basePath with --fs argument: ${fsPath}`);
			} else {
				// Log warning but proceed with default/previous basePath
				logger.warn(`Ignoring invalid --fs arg value: ${fsPath} does not exist.`);
				// Potentially throw an error if the arg must be valid:
				// throw new Error(`Invalid --fs arg value. ${fsPath} does not exist`);
			}
		} else if (fsEnvVar) {
			if (existsSync(fsEnvVar)) {
				resolvedBasePath = fsEnvVar;
				logger.info(`Overriding basePath with ${TYPEDAI_FS} environment variable: ${fsEnvVar}`);
			} else {
				// Log warning but proceed with default/previous basePath
				logger.warn(`Ignoring invalid ${TYPEDAI_FS} env var: ${fsEnvVar} does not exist.`);
				// Potentially throw an error if the env var must be valid:
				// throw new Error(`Invalid ${TYPEDAI_FS} env var. ${fsEnvVar} does not exist`);
			}
		}

		this.basePath = path.resolve(resolvedBasePath); // Ensure basePath is absolute and normalized
		this.workingDirectory = this.basePath; // Start working directory at the base path
		this.log = logger.child({ FileSystemBasePath: this.basePath });
		this.listService = new FileSystemListService(this); // Initialize the list service, passing this instance
		this.log.info(`FileSystemService initialized. BasePath: ${this.basePath}, WorkingDirectory: ${this.workingDirectory}`);
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
	 * @param dir The new working directory path. Can be absolute or relative to the current working directory.
	 *            Must resolve to a path within the service's `basePath`.
	 */
	setWorkingDirectory(dir: string): void {
		if (!dir) throw new Error('Target directory must be provided');

		let targetPath: string;

		if (path.isAbsolute(dir)) {
			targetPath = path.resolve(dir); // Resolve to normalize (e.g., remove trailing slashes)
		} else {
			// Resolve relative to the current working directory
			targetPath = path.resolve(this.workingDirectory, dir);
		}

		// Security Check: Ensure the target path is within the basePath
		if (!targetPath.startsWith(this.basePath)) {
			throw new Error(`Cannot set working directory outside of base path. Attempted: ${targetPath} (Base: ${this.basePath})`);
		}

		// Check if the target directory exists
		if (!existsSync(targetPath)) {
			throw new Error(`Target working directory "${dir}" (resolved to "${targetPath}") does not exist.`);
		}

		// Check if it's actually a directory
		try {
			const stats = statSync(targetPath); // Use sync version for simplicity here
			if (!stats.isDirectory()) {
				throw new Error(`Target working directory "${targetPath}" is not a directory.`);
			}
		} catch (e) {
			// Handle potential stat errors (e.g., permissions)
			throw new Error(`Error accessing target working directory "${targetPath}": ${e.message}`);
		}

		// Update the working directory
		this.workingDirectory = targetPath;
		this.log.info(`Working directory set to: ${this.workingDirectory}`);

		// Reset VCS instance as the context has changed
		this.vcs = null; // lazy loaded in getVcs()
	}

	/**
	 * Returns the file contents of all the files under the provided directory path
	 * @param dirPath the directory to return all the files contents under
	 * @returns the contents of the file(s) as a Map keyed by the file path relative to the working directory.
	 */
	async getFileContentsRecursively(dirPath: string, useGitIgnore = true): Promise<Map<string, string>> {
		// Delegate listing to the list service
		const filenames = await this.listService.listFilesRecursively(dirPath, useGitIgnore);
		// Read the listed files using the current service's readFiles method
		return await this.readFiles(filenames);
	}

	/**
	 * Returns the file contents of all the files recursively under the provided directory path
	 * @param dirPath the directory to return all the files contents under
	 * @param storeToMemory if the file contents should be stored to memory. The key will be in the format file-contents-<FileSystem.workingDirectory>-<dirPath>
	 * @returns the contents of the file(s) in format <file_contents path="dir/file1">...</file_contents><file_contents path="dir/file2">...</file_contents>
	 */
	async getFileContentsRecursivelyAsXml(dirPath: string, storeToMemory: boolean, filter: (path: string) => boolean = () => true): Promise<string> {
		// Delegate listing to the list service
		const filenames = (await this.listService.listFilesRecursively(dirPath)).filter(filter);
		// Read files using this service's readFilesAsXml method
		const contents = await this.readFilesAsXml(filenames);
		// Store in memory if requested
		if (storeToMemory) {
			// Ensure key reflects the actual directory path used for listing relative to working dir
			const memoryKeyPath = path.normalize(dirPath); // Normalize './' etc.
			// Use path.join to create a platform-independent key if needed, though relative path might be sufficient
			const fullMemoryKeyPath = path.join(this.getWorkingDirectory(), memoryKeyPath);
			agentContext().memory[`file-contents-${fullMemoryKeyPath}`] = contents; // Use full path for key? Or relative? Let's stick to relative for now.
			// Reverting to relative path based on original code's apparent intent:
			agentContext().memory[`file-contents-${memoryKeyPath}`] = contents;
		}
		return contents;
	}

	// --- Methods below are kept in FileSystemService ---
	// searchFilesMatchingContents, searchExtractsMatchingContents, searchFilesMatchingName,
	// listFilesInDirectory, listFilesRecursively, listFilesRecurse, loadGitignoreRules,
	// listFolders, getAllFoldersRecursively, getFileSystemTree, getFileSystemTreeStructure
	// are now primarily handled by FileSystemListService.

	/**
	 * Gets the contents of a local file on the file system. If the user has only provided a filename you may need to find the full path using the searchFilesMatchingName function.
	 * @param filePath The file path to read the contents of (e.g. src/index.ts)
	 * @returns the contents of the file as a string.
	 */
	async readFile(filePath: string): Promise<string> {
		this.log.debug(`readFile requested for: ${filePath}`);
		let absolutePathToRead: string;
		const serviceCwd = this.getWorkingDirectory();

		// Determine the absolute path
		if (path.isAbsolute(filePath)) {
			absolutePathToRead = path.resolve(filePath); // Normalize
		} else {
			absolutePathToRead = path.resolve(serviceCwd, filePath);
		}

		// Security Check: Ensure the path is within the basePath
		if (!absolutePathToRead.startsWith(this.basePath)) {
			throw new Error(`Access denied: Cannot read file outside of base path: ${absolutePathToRead} (requested: ${filePath})`);
		}

		this.log.debug(`Attempting to read absolute path: ${absolutePathToRead}`);
		getActiveSpan()?.setAttributes({
			'file.path.requested': filePath,
			'file.path.absolute': absolutePathToRead,
			'file.path.relative': path.relative(serviceCwd, absolutePathToRead),
		});

		try {
			// Use the promisified fs.readFile
			const contents = await fs.readFile(absolutePathToRead, 'utf8');
			getActiveSpan()?.setAttribute('file.size', contents.length);
			return contents;
		} catch (error) {
			if (error.code === 'ENOENT') {
				this.log.warn(`File not found: ${absolutePathToRead} (requested: ${filePath})`);
				// Consider if searching by name should happen here or be explicit in the caller/agent
				throw new Error(`File not found: ${filePath}`);
			} else {
				this.log.error(`Error reading file ${absolutePathToRead}: ${error}`);
				throw new Error(`Error reading file ${filePath}: ${error.message}`);
			}
		}
	}

	/**
	 * Gets the contents of a local file on the file system and returns it in XML tags
	 * @param filePath The file path (relative or absolute) to read the contents of.
	 * @returns the contents of the file wrapped in XML tags, using the path relative to the working directory in the attribute.
	 */
	async readFileAsXML(filePath: string): Promise<string> {
		const contents = await this.readFile(filePath); // readFile handles path resolution, security, and reading
		// Determine the relative path for the XML attribute based on the resolved path
		const serviceCwd = this.getWorkingDirectory();
		const absolutePath = path.isAbsolute(filePath) ? path.resolve(filePath) : path.resolve(serviceCwd, filePath);
		const relativePath = path.relative(serviceCwd, absolutePath);

		const cdata = needsCDATA(contents);
		return cdata
			? `<file_content file_path="${relativePath}">${CDATA_START}\n${contents}\n${CDATA_END}</file_content>\n`
			: `<file_content file_path="${relativePath}">\n${contents}\n</file_content>\n`;
	}

	/**
	 * Gets the contents of multiple local files. Input paths can be absolute or relative.
	 * @param filePaths An array of file paths to read. Paths can be relative to the working directory or absolute.
	 * @returns A Map where keys are file paths relative to the working directory and values are file contents. Skips files outside basePath or unreadable files.
	 */
	async readFiles(filePaths: string[]): Promise<Map<string, string>> {
		const mapResult = new Map<string, string>();
		const serviceCwd = this.getWorkingDirectory();

		for (const inputPath of filePaths) {
			try {
				// Use the single readFile method which handles resolution, security, and errors
				const contents = await this.readFile(inputPath);

				// Determine the relative path for the map key, consistent with readFileAsXML
				const absolutePath = path.isAbsolute(inputPath) ? path.resolve(inputPath) : path.resolve(serviceCwd, inputPath);
				const relativeKey = path.relative(serviceCwd, absolutePath);
				mapResult.set(relativeKey, contents);
			} catch (error) {
				// Log the error from readFile and continue with the next file
				this.log.warn(`Skipping file in readFiles due to error: ${error.message} (input: ${inputPath})`);
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
	 * Checks if a file exists at the given path (relative or absolute).
	 * @param filePath The file path to check. Path can be relative to the working directory or absolute.
	 * @returns true if the file exists and is accessible within the basePath, false otherwise.
	 */
	async fileExists(filePath: string): Promise<boolean> {
		this.log.debug(`fileExists check requested for: ${filePath}`);
		let absolutePathToCheck: string;
		const serviceCwd = this.getWorkingDirectory();

		// Determine the absolute path
		if (path.isAbsolute(filePath)) {
			absolutePathToCheck = path.resolve(filePath);
		} else {
			absolutePathToCheck = path.resolve(serviceCwd, filePath);
		}

		// Security Check: Ensure the path is within the basePath
		if (!absolutePathToCheck.startsWith(this.basePath)) {
			this.log.warn(`fileExists check outside basePath denied: ${absolutePathToCheck} (requested: ${filePath})`);
			return false; // File is outside allowed scope
		}

		this.log.debug(`Checking existence of absolute path: ${absolutePathToCheck}`);
		try {
			// Use stat to check existence and accessibility
			await fs.stat(absolutePathToCheck);
			this.log.debug(`File exists: ${absolutePathToCheck}`);
			return true;
		} catch (error) {
			if (error.code === 'ENOENT') {
				this.log.debug(`File does not exist: ${absolutePathToCheck}`);
			} else {
				// Log other errors (like permission errors) but still return false
				this.log.warn(`Error checking file existence for ${absolutePathToCheck}: ${error.message}`);
			}
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
	 * Writes content to a file. Creates parent directories if needed. Overwrites if file exists.
	 * @param filePath The file path (relative or absolute). Must resolve to a path within `basePath`.
	 * @param contents The string content to write.
	 */
	async writeFile(filePath: string, contents: string): Promise<void> {
		this.log.debug(`writeFile requested for: ${filePath}`);
		let absolutePathToWrite: string;
		const serviceCwd = this.getWorkingDirectory();

		// Determine the absolute path
		if (path.isAbsolute(filePath)) {
			absolutePathToWrite = path.resolve(filePath);
		} else {
			absolutePathToWrite = path.resolve(serviceCwd, filePath);
		}

		// Security Check: Ensure the path is within the basePath
		if (!absolutePathToWrite.startsWith(this.basePath)) {
			throw new Error(`Access denied: Cannot write file outside of base path: ${absolutePathToWrite} (requested: ${filePath})`);
		}

		this.log.debug(`Attempting to write to absolute path: ${absolutePathToWrite}`);
		getActiveSpan()?.setAttributes({
			'file.path.requested': filePath,
			'file.path.absolute': absolutePathToWrite,
			'file.path.relative': path.relative(serviceCwd, absolutePathToWrite),
			'file.size': contents.length, // Log size being written
		});

		try {
			// Ensure parent directory exists
			const parentPath = path.dirname(absolutePathToWrite);
			// Check if parent is different from file path itself (handles writing to root case if ever needed, though unlikely)
			if (parentPath !== absolutePathToWrite) {
				// Use the promisified mkdir
				await fs.mkdir(parentPath, { recursive: true });
			}

			// Write the file using the promisified writeFile
			await fs.writeFile(absolutePathToWrite, contents, 'utf8');
			this.log.info(`Successfully wrote file: ${absolutePathToWrite}`);
		} catch (error) {
			this.log.error(`Error writing file ${absolutePathToWrite}: ${error}`);
			throw new Error(`Error writing file ${filePath}: ${error.message}`);
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

	// --- VCS Methods ---

	getVcs(): VersionControlSystem {
		if (!this.vcs) {
			if (this.getVcsRoot()) this.vcs = new Git(this);
		}
		if (!this.vcs) throw new Error('Not in a version controlled directory');
		return this.vcs;
	}

	/**
	 * Gets the root directory of the Git repository containing the current working directory.
	 * Returns null if not in a Git repository or if git command fails.
	 * Caches results based on working directory.
	 */
	getVcsRoot(): string | null {
		const currentWd = this.getWorkingDirectory();

		// Check cache first
		// The cache key is the working directory path.
		if (FileSystemService.gitRootCache.has(currentWd)) {
			const cachedValue = FileSystemService.gitRootCache.get(currentWd);
			// Return null if explicitly cached as null, otherwise return the cached path
			return cachedValue === undefined ? null : cachedValue;
		}

		// Check if the working directory actually exists before running git command
		if (!existsSync(currentWd)) {
			this.log.warn(`Working directory ${currentWd} does not exist. Cannot determine Git root.`);
			FileSystemService.gitRootCache.set(currentWd, null); // Cache the null result
			return null;
		}

		// Execute Git command to find the root
		try {
			// Run command *in* the working directory
			const result = execCmdSync('git rev-parse --show-toplevel', currentWd);

			// Check exitCode first, then error object
			if (result.exitCode !== 0 || result.error) {
				// Common case: not a git repo (exit code 128)
				if (result.stderr?.includes('not a git repository')) {
					this.log.debug(`Directory ${currentWd} is not within a Git repository.`);
				} else {
					// Other errors
					this.log.warn(result.stderr || result.error?.message, `Git command failed in ${currentWd}. Cannot determine Git root.`);
				}
				FileSystemService.gitRootCache.set(currentWd, null); // Cache the null result
				return null;
			}

			const gitRoot = result.stdout.trim();
			this.log.debug(`Determined Git root for ${currentWd} is ${gitRoot}`);
			FileSystemService.gitRootCache.set(currentWd, gitRoot); // Cache the found root path
			return gitRoot;
		} catch (e) {
			this.log.error(e, `Error executing git command in ${currentWd}`);
			FileSystemService.gitRootCache.set(currentWd, null); // Cache null on unexpected error
			return null;
		}
	}

	// Static cache for Git roots to avoid re-running the command frequently
	// Key: Absolute working directory path, Value: Absolute Git root path or null
	private static gitRootCache = new Map<string, string | null>();
}

// Helper function (consider moving to utils if used elsewhere)
// import { statSync } from 'node:fs'; // Already imported at the top
