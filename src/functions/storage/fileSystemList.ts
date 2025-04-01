import { getFileSystem } from '#agent/agentContextLocalStorage';
import { func, funcClass } from '#functionSchema/functionDecorators';

/**
 * Provides functions for LLMs to list and search the file system.
 *
 * The functions which list/search filenames should return the paths relative to the workingDirectory.
 *
 * By default, the basePath is the current working directory of the process.
 */
@funcClass(__filename)
export class FileSystemList {
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
