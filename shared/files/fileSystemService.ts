import type { Ignore } from 'ignore';

import type { VersionControlSystem } from '#shared/scm/versionControlSystem';

export interface FileSystemNode {
	path: string;
	name: string;
	type: 'file' | 'directory';
	children?: FileSystemNode[];
	summary?: string; // Optional summary from indexing agent
}

export interface IFileSystemService {
	toJSON(): { basePath: string; workingDirectory: string };

	fromJSON(obj: any): this | null;

	/**
	 * The base path set from the constructor or environment variables or program args
	 */
	getBasePath(): string;

	/**
	 * @returns the full path of the working directory on the filesystem
	 */
	getWorkingDirectory(): string;

	/**
	 * Set the working directory. The dir argument may be an absolute filesystem path, otherwise relative to the current working directory.
	 * If the dir starts with / it will first be checked as an absolute directory, then as relative path to the working directory.
	 * @param dir the new working directory
	 */
	setWorkingDirectory(dir: string): void;

	/**
	 * Returns the file contents of all the files under the provided directory path
	 * @param dirPath the directory to return all the files contents under
	 * @returns the contents of the file(s) as a Map keyed by the file path
	 */
	getFileContentsRecursively(dirPath: string, useGitIgnore?: boolean): Promise<Map<string, string>>;

	/**
	 * Returns the file contents of all the files recursively under the provided directory path
	 * @param dirPath the directory to return all the files contents under
	 * @param storeToMemory if the file contents should be stored to memory. The key will be in the format file-contents-<FileSystem.workingDirectory>-<dirPath>
	 * @returns the contents of the file(s) in format <file_contents path="dir/file1">file1 contents</file_contents><file_contents path="dir/file2">file2 contents</file_contents>
	 */
	getFileContentsRecursivelyAsXml(dirPath: string, storeToMemory: boolean, filter?: (path: string) => boolean): Promise<string>;

	/**
	 * Searches for files on the filesystem (using ripgrep) with contents matching the search regex.
	 * @param contentsRegex the regular expression to search the content all the files recursively for
	 * @returns the list of filenames (with postfix :<match_count>) which have contents matching the regular expression.
	 */
	searchFilesMatchingContents(contentsRegex: string): Promise<string>;

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
	searchExtractsMatchingContents(contentsRegex: string, linesBeforeAndAfter?: number): Promise<string>;

	/**
	 * Searches for files on the filesystem where the filename matches the regex.
	 * @param fileNameRegex the regular expression to match the filename.
	 * @returns the list of filenames matching the regular expression.
	 */
	searchFilesMatchingName(fileNameRegex: string): Promise<string[]>;

	/**
	 * Lists the file and folder names in a single directory.
	 * Folder names will end with a /
	 * @param dirPath the folder to list the files in. Defaults to the working directory
	 * @returns the list of file and folder names
	 */
	listFilesInDirectory(dirPath?: string): Promise<string[]>;

	/**
	 * List all the files recursively under the given path, excluding any paths in a .gitignore file if it exists
	 * @param dirPath
	 * @returns the list of files
	 */
	listFilesRecursively(dirPath?: string, useGitIgnore?: boolean): Promise<string[]>;

	listFilesRecurse(
		rootPath: string,
		dirPath: string,
		parentIg: Ignore,
		useGitIgnore: boolean,
		gitRoot: string | null,
		filter?: (file: string) => boolean,
	): Promise<string[]>;

	/**
	 * Gets the contents of a local file on the file system. If the user has only provided a filename you may need to find the full path using the searchFilesMatchingName function.
	 * @param filePath The file path to read the contents of (e.g. src/index.ts)
	 * @returns the contents of the file(s) in format <file_contents path="dir/file1">file1 contents</file_contents><file_contents path="dir/file2">file2 contents</file_contents>
	 */
	readFile(filePath: string): Promise<string>;

	/**
	 * Gets the contents of a local file on the file system and returns it in XML tags
	 * @param filePath The file path to read the contents of (e.g. src/index.ts)
	 * @returns the contents of the file(s) in format <file_contents path="dir/file1">file1 contents</file_contents>
	 */
	readFileAsXML(filePath: string): Promise<string>;

	/**
	 * Gets the contents of a list of local files. Input paths can be absolute or relative to the service's working directory.
	 * @param {Array<string>} filePaths The files paths to read the contents of.
	 * @returns {Promise<Map<string, string>>} the contents of the files in a Map object keyed by the file path *relative* to the service's working directory.
	 */
	readFiles(filePaths: string[]): Promise<Map<string, string>>;

	/**
	 * Gets the contents of a list of files, returning a formatted XML string of all file contents
	 * @param {Array<string>} filePaths The files paths to read the contents of
	 * @returns {Promise<string>} the contents of the file(s) in format <file_contents path="dir/file1">file1 contents</file_contents><file_contents path="dir/file2">file2 contents</file_contents>
	 */
	readFilesAsXml(filePaths: string | string[]): Promise<string>;

	formatFileContentsAsXml(fileContents: Map<string, string>): string;

	/**
	 * Check if a file exists. A filePath starts with / is it relative to FileSystem.basePath, otherwise its relative to FileSystem.workingDirectory
	 * @param filePath The file path to check
	 * @returns true if the file exists, else false
	 */
	fileExists(filePath: string): Promise<boolean>;

	directoryExists(dirPath: string): Promise<boolean>;
	/**
	 * Writes to a file. If the file path already exists an Error will be thrown. This will create any parent directories required,
	 * @param filePath The file path (either full filesystem path or relative to current working directory)
	 * @param contents The contents to write to the file
	 */
	writeNewFile(filePath: string, contents: string): Promise<void>;

	/**
	 * Writes to a file. If the file exists it will overwrite the contents. This will create any parent directories required,
	 * @param filePath The file path (either full filesystem path or relative to current working directory)
	 * @param contents The contents to write to the file
	 */
	writeFile(filePath: string, contents: string): Promise<void>;

	/**
	 * Reads a file, then transforms the contents using a LLM to perform the described changes, then writes back to the file.
	 * @param {string} filePath The file to update
	 * @param {string} descriptionOfChanges A natual language description of the changes to make to the file contents
	 */
	editFileContents(filePath: string, descriptionOfChanges: string): Promise<void>;

	loadGitignoreRules(startPath: string, gitRoot: string | null): Promise<Ignore>;

	listFolders(dirPath?: string): Promise<string[]>;

	/**
	 * Recursively lists all folders under the given root directory.
	 * @param dir The root directory to start the search from. Defaults to the current working directory.
	 * @returns A promise that resolves to an array of folder paths relative to the working directory.
	 */
	getAllFoldersRecursively(dir?: string): Promise<string[]>;

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
	getFileSystemTree(dirPath?: string): Promise<string>;

	/**
	 * Returns the filesystem structure
	 * @param dirPath
	 * @returns a record with the keys as the folders paths, and the list values as the files in the folder
	 */
	getFileSystemTreeStructure(dirPath?: string): Promise<Record<string, string[]>>;

	/**
	 * Generates a hierarchical representation of the file system structure starting from a given path,
	 * respecting .gitignore rules if enabled.
	 *
	 * @param dirPath The starting directory path, relative to the working directory or absolute. Defaults to the working directory.
	 * @param useGitIgnore Whether to respect .gitignore rules. Defaults to true.
	 * @returns A Promise resolving to the root FileSystemNode representing the requested directory structure, or null if the path is not a directory.
	 */
	getFileSystemNodes(dirPath?: string, useGitIgnore?: boolean): Promise<FileSystemNode | null>;

	/**
	 * Recursive helper function to build the FileSystemNode tree.
	 * @param currentPathAbs Absolute path of the directory currently being processed.
	 * @param serviceWorkingDir Absolute path of the service's working directory (for relative path calculation).
	 * @param parentIg Ignore rules inherited from the parent directory.
	 * @param useGitIgnore Whether to respect .gitignore rules.
	 * @param gitRoot Absolute path to the git repository root, if applicable.
	 * @returns A Promise resolving to an array of FileSystemNode children for the current directory.
	 */
	buildNodeTreeRecursive(
		currentPathAbs: string,
		serviceWorkingDir: string,
		parentIg: Ignore,
		useGitIgnore: boolean,
		gitRoot: string | null,
	): Promise<FileSystemNode[]>;

	getVcs(): VersionControlSystem;

	/**
	 * Gets the version control service (Git) repository root folder, if the current working directory is in a Git repo, else null.
	 */
	getVcsRoot(): string | null;
}
