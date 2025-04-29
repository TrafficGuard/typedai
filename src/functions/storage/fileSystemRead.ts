import { getFileSystem } from '#agent/agentContextLocalStorage';
import { func, funcClass } from '#functionSchema/functionDecorators';

/**
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
@funcClass(__filename)
export class FileSystemRead {
	/**
	 * @returns the full path of the working directory on the filesystem
	 */
	@func()
	getWorkingDirectory(): string {
		return getFileSystem().getWorkingDirectory();
	}

	/**
	 * Set the working directory. The dir argument may be an absolute filesystem path, otherwise relative to the current working directory.
	 * If the dir starts with / it will first be checked as an absolute directory, then as relative path to the working directory.
	 * @param dir the new working directory
	 */
	@func()
	setWorkingDirectory(dir: string): void {
		getFileSystem().setWorkingDirectory(dir);
	}

	/**
	 * Returns the file contents of all the files under the provided directory path
	 * @param dirPath the directory to return all the files contents under
	 * @returns the contents of the file(s) as a Map keyed by the file path
	 */
	@func()
	async getFileContentsRecursively(dirPath: string, useGitIgnore = true): Promise<Map<string, string>> {
		return await getFileSystem().getFileContentsRecursively(dirPath, useGitIgnore);
	}

	/**
	 * Returns the file contents of all the files recursively under the provided directory path
	 * @param dirPath the directory to return all the files contents under
	 * @param storeToMemory if the file contents should be stored to memory. The key will be in the format file-contents-<FileSystem.workingDirectory>-<dirPath>
	 * @returns the contents of the file(s) in format <file_contents path="dir/file1">file1 contents</file_contents><file_contents path="dir/file2">file2 contents</file_contents>
	 */
	@func()
	async getFileContentsRecursivelyAsXml(dirPath: string, storeToMemory: boolean, filter: (path) => boolean = () => true): Promise<string> {
		return await getFileSystem().getFileContentsRecursivelyAsXml(dirPath, storeToMemory, filter);
	}

	/**
	 * Searches for files on the filesystem (using ripgrep) with contents matching the search regex.
	 * @param contentsRegex the regular expression to search the content all the files recursively for
	 * @returns the list of filenames (with postfix :<match_count>) which have contents matching the regular expression.
	 */
	@func()
	async searchFilesMatchingContents(contentsRegex: string): Promise<string> {
		return await getFileSystem().searchFilesMatchingContents(contentsRegex);
	}

	/**
	 * Searches for files on the filesystem where the filename matches the regex.
	 * @param fileNameRegex the regular expression to match the filename.
	 * @returns the list of filenames matching the regular expression.
	 */
	@func()
	async searchFilesMatchingName(fileNameRegex: string): Promise<string[]> {
		return await getFileSystem().searchFilesMatchingName(fileNameRegex);
	}

	/**
	 * Lists the file and folder names in a single directory.
	 * Folder names will end with a /
	 * @param dirPath the folder to list the files in. Defaults to the working directory
	 * @returns the list of file and folder names
	 */
	@func()
	async listFilesInDirectory(dirPath = '.'): Promise<string[]> {
		return await getFileSystem().listFilesInDirectory(dirPath);
	}

	/**
	 * List all the files recursively under the given path, excluding any paths in a .gitignore file if it exists
	 * @param dirPath
	 * @returns the list of files
	 */
	@func()
	async listFilesRecursively(dirPath = './', useGitIgnore = true): Promise<string[]> {
		return await getFileSystem().listFilesRecursively(dirPath, useGitIgnore);
	}

	/**
	 * Gets the contents of a local file on the file system. If the user has only provided a filename you may need to find the full path using the searchFilesMatchingName function.
	 * @param filePath The file path to read the contents of (e.g. src/index.ts)
	 * @returns the contents of the file(s) in format <file_contents path="dir/file1">file1 contents</file_contents><file_contents path="dir/file2">file2 contents</file_contents>
	 */
	@func()
	async readFile(filePath: string): Promise<string> {
		return await getFileSystem().readFile(filePath);
	}

	/**
	 * Gets the contents of a local file on the file system and returns it in XML tags
	 * @param filePath The file path to read the contents of (e.g. src/index.ts)
	 * @returns the contents of the file(s) in format <file_contents path="dir/file1">file1 contents</file_contents>
	 */
	@func()
	async readFileAsXML(filePath: string): Promise<string> {
		return await getFileSystem().readFileAsXML(filePath);
	}

	/**
	 * Gets the contents of a list of files, returning a formatted XML string of all file contents
	 * @param {Array<string>} filePaths The files paths to read the contents of
	 * @returns {Promise<string>} the contents of the file(s) in format <file_contents path="dir/file1">file1 contents</file_contents><file_contents path="dir/file2">file2 contents</file_contents>
	 */
	@func()
	async readFilesAsXml(filePaths: string | string[]): Promise<string> {
		return await getFileSystem().readFilesAsXml(filePaths);
	}

	/**
	 * Check if a file exists. A filePath starts with / is it relative to FileSystem.basePath, otherwise its relative to FileSystem.workingDirectory
	 * @param filePath The file path to check
	 * @returns true if the file exists, else false
	 */
	@func()
	async fileExists(filePath: string): Promise<boolean> {
		return await getFileSystem().fileExists(filePath);
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
	@func()
	async getFileSystemTree(dirPath = './'): Promise<string> {
		return await getFileSystem().getFileSystemTree(dirPath);
	}

	/**
	 * Returns the filesystem structure
	 * @param dirPath
	 * @returns a record with the keys as the folders paths, and the list values as the files in the folder
	 */
	@func()
	async getFileSystemTreeStructure(dirPath = './'): Promise<Record<string, string[]>> {
		return await getFileSystem().getFileSystemTreeStructure(dirPath);
	}
}
