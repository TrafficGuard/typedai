import { access, lstat, mkdir, readFile, readdir, stat, writeFile } from 'node:fs';
import path, { join, relative } from 'node:path';
import { promisify } from 'node:util';
import ignore, { type Ignore } from 'ignore';
import type { FileSystemService } from '#functions/storage/fileSystemService'; // Import FileSystemService type
import { logger } from '#o11y/logger';
import { spawnCommand } from '#utils/exec';
import { needsCDATA, CDATA_START, CDATA_END } from '#utils/xml-utils'; // Import XML utils

const fs = {
	readFile: promisify(readFile),
	stat: promisify(stat),
	readdir: promisify(readdir),
	access: promisify(access),
	mkdir: promisify(mkdir),
	lstat: promisify(lstat),
	writeFile: promisify(writeFile),
};

// Cache paths to Git repositories and .gitignore files
// These might need to be shared or managed differently if multiple FileSystemServices exist
// const gitRoots = new Set<string>(); // Managed by FileSystemService now
/** Maps a directory to a git root */
// const gitRootMapping = new Map<string, string>(); // Managed by FileSystemService now
const gitIgnorePaths = new Set<string>(); // Cache for loaded .gitignore paths

/**
 * Service responsible for listing and searching files within the filesystem context
 * managed by a FileSystemService instance.
 */
export class FileSystemListService {
	// Keep a reference to the main FileSystemService to access shared state/config
	constructor(private fsService: FileSystemService) {}

	/**
	 * Searches for files on the filesystem (using ripgrep) with contents matching the search regex.
	 * @param contentsRegex the regular expression to search the content all the files recursively for
	 * @returns the list of filenames (with postfix :<match_count>) which have contents matching the regular expression.
	 */
	async searchFilesMatchingContents(contentsRegex: string): Promise<string> {
		// --count Only show count of line matches for each file
		// Ensure rg runs in the correct working directory
		const results = await spawnCommand(`rg --count ${arg(contentsRegex)}`, { cwd: this.fsService.getWorkingDirectory() });
		if (results.stderr.includes('command not found: rg')) {
			throw new Error('Command not found: rg. Install ripgrep');
		}
		// rg exits with 1 if no matches are found, which is not an error in this context
		if (results.exitCode > 1) throw new Error(results.stderr);
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
		// Ensure rg runs in the correct working directory
		const results = await spawnCommand(`rg ${arg(contentsRegex)} -C ${linesBeforeAndAfter}`, { cwd: this.fsService.getWorkingDirectory() });
		if (results.stderr.includes('command not found: rg')) {
			throw new Error('Command not found: rg. Install ripgrep');
		}
		// rg exits with 1 if no matches are found, which is not an error in this context
		if (results.exitCode > 1) throw new Error(results.stderr);
		return results.stdout;
	}

	/**
	 * Searches for files on the filesystem where the filename matches the regex.
	 * @param fileNameRegex the regular expression to match the filename.
	 * @returns the list of filenames matching the regular expression.
	 */
	async searchFilesMatchingName(fileNameRegex: string): Promise<string[]> {
		const regex = new RegExp(fileNameRegex);
		// Use listFilesRecursively from this service
		const files = await this.listFilesRecursively();
		return files.filter((file) => regex.test(path.basename(file))); // Use path.basename for robust matching
	}

	/**
	 * Lists the file and folder names in a single directory.
	 * Folder names will end with a /
	 * @param dirPath the folder to list the files in. Defaults to the working directory
	 * @returns the list of file and folder names
	 */
	async listFilesInDirectory(dirPath = '.'): Promise<string[]> {
		const ig = ignore();
		const workingDir = this.fsService.getWorkingDirectory(); // Use fsService's working dir

		// Determine the correct path based on whether dirPath is absolute or relative
		let readdirPath: string;
		if (path.isAbsolute(dirPath)) {
			// Ensure absolute path is within the basePath
			if (!dirPath.startsWith(this.fsService.basePath)) {
				throw new Error(`Access denied: Cannot list directory outside of base path: ${dirPath}`);
			}
			readdirPath = path.resolve(dirPath); // Normalize
		} else {
			readdirPath = path.resolve(workingDir, dirPath); // Resolve relative to working dir
		}

		// Additional check: Ensure resolved path is still within basePath
		if (!readdirPath.startsWith(this.fsService.basePath)) {
			throw new Error(`Access denied: Resolved path is outside of base path: ${readdirPath}`);
		}

		// Load .gitignore rules if present in the target directory
		const gitIgnorePath = path.join(readdirPath, '.gitignore');
		try {
			// Use fs.access for existence check
			await fs.access(gitIgnorePath);
			let lines = await fs.readFile(gitIgnorePath, 'utf8').then((data) => data.split('\n'));
			lines = lines
				.map((line) => line.trim())
				.filter((line) => line.length && !line.startsWith('#'));
			// Add rules relative to the directory containing .gitignore
			ig.add(lines);
			ig.add('.git'); // Always ignore .git
		} catch (error) {
			// If .gitignore doesn't exist or isn't readable, proceed without its rules
			if (error.code !== 'ENOENT') {
				this.fsService.log.warn(`Could not read .gitignore at ${gitIgnorePath}: ${error.message}`);
			}
			ig.add('.git'); // Still ignore .git even if .gitignore is missing/unreadable
		}

		const files: string[] = [];

		try {
			const dirents = await fs.readdir(readdirPath, { withFileTypes: true });
			for (const dirent of dirents) {
				const direntName = dirent.name; // Just the name, add '/' later if it's a directory
				const fullPath = path.join(readdirPath, direntName);
				// Calculate path relative to the *working directory* for ignore check
				const relativePathForIgnore = path.relative(workingDir, fullPath);

				// Check against ignore rules (relative to working dir)
				// Need to check both 'name' and 'name/' for directories
				const isDir = dirent.isDirectory();
				const ignorePath = isDir ? `${relativePathForIgnore}/` : relativePathForIgnore;
				const ignorePathWithoutSlash = relativePathForIgnore; // Check both forms for robustness

				if (!ig.ignores(ignorePath) && !ig.ignores(ignorePathWithoutSlash)) {
					files.push(isDir ? `${direntName}/` : direntName);
				}
			}
		} catch (error) {
			this.fsService.log.error(`Error reading directory: ${readdirPath}`, error);
			throw error; // Re-throw the error to be caught by the caller
		}

		return files;
	}

	/**
	 * List all the files recursively under the given path, excluding any paths in a .gitignore file if it exists
	 * @param dirPath Path relative to the working directory, or an absolute path.
	 * @param useGitIgnore Whether to respect .gitignore rules.
	 * @returns the list of files relative to the working directory.
	 */
	async listFilesRecursively(dirPath = './', useGitIgnore = true): Promise<string[]> {
		const workingDir = this.fsService.getWorkingDirectory();
		this.fsService.log.debug(`listFilesRecursively cwd: ${workingDir}, requested path: ${dirPath}`);

		const startPath = path.isAbsolute(dirPath) ? path.resolve(dirPath) : path.resolve(workingDir, dirPath);

		// Security check: Ensure startPath is within or equal to basePath
		if (!startPath.startsWith(this.fsService.basePath)) {
			throw new Error(`Access denied: Cannot list files outside of base path: ${startPath}`);
		}

		const gitRoot = useGitIgnore ? this.fsService.getVcsRoot() : null;
		// Load initial ignore rules based on the starting path
		const ig: Ignore = useGitIgnore ? await this.loadGitignoreRules(startPath, gitRoot) : ignore();

		// Pass workingDir as the rootPath for relative path calculations in results
		const files: string[] = await this.listFilesRecurse(workingDir, startPath, ig, useGitIgnore, gitRoot);
		// Ensure results are relative to the working directory
		return files.map((file) => path.relative(workingDir, file));
	}

	/** Helper for recursive listing */
	private async listFilesRecurse(
		rootPath: string, // The reference directory for relative paths (usually workingDirectory)
		dirPath: string, // The current directory being scanned
		parentIg: Ignore,
		useGitIgnore: boolean,
		gitRoot: string | null,
		filter: (file: string) => boolean = (name) => true, // Filter is not currently used but kept for potential future use
	): Promise<string[]> {
		const files: string[] = [];

		// Load .gitignore rules specific to the current directory
		const currentIg = useGitIgnore ? await this.loadGitignoreRules(dirPath, gitRoot) : ignore();
		// Combine parent rules with current directory rules
		const mergedIg = ignore().add(parentIg).add(currentIg);

		try {
			const dirents = await fs.readdir(dirPath, { withFileTypes: true });
			for (const dirent of dirents) {
				const fullPath = path.join(dirPath, dirent.name);
				// Calculate path relative to the rootPath (workingDir) for ignore checks
				const relativePath = path.relative(rootPath, fullPath);

				if (dirent.isDirectory()) {
					// Check if the directory itself is ignored (both 'name' and 'name/')
					if (!useGitIgnore || (!mergedIg.ignores(relativePath) && !mergedIg.ignores(`${relativePath}/`))) {
						// Recurse into subdirectory, passing the merged ignore rules
						files.push(...(await this.listFilesRecurse(rootPath, fullPath, mergedIg, useGitIgnore, gitRoot, filter)));
					}
				} else {
					// Check if the file is ignored
					if (!useGitIgnore || !mergedIg.ignores(relativePath)) {
						// Add the full path of the file
						files.push(fullPath);
					}
				}
			}
		} catch (error) {
			// Log error but continue if possible (e.g., permission denied for a subdir)
			this.fsService.log.warn(`Error reading directory ${dirPath}: ${error.message}`);
		}
		return files;
	}

	/** Loads gitignore rules walking up from startPath */
	private async loadGitignoreRules(startPath: string, gitRoot: string | null): Promise<Ignore> {
		const ig = ignore();
		let currentPath = startPath;

		// Normalize startPath to ensure consistent comparisons
		const normalizedGitRoot = gitRoot ? path.normalize(gitRoot) : null;

		// Continue until git root or filesystem root or outside basePath
		while (currentPath.startsWith(this.fsService.basePath)) {
			const gitIgnorePath = path.join(currentPath, '.gitignore');
			const knownGitIgnore = gitIgnorePaths.has(gitIgnorePath);
			let gitignoreExists = false;

			if (knownGitIgnore) {
				gitignoreExists = true; // Assume it exists if cached, re-read below
			} else {
				try {
					await fs.access(gitIgnorePath); // Check accessibility
					gitignoreExists = true;
					gitIgnorePaths.add(gitIgnorePath); // Add to cache on successful access
				} catch {
					// File doesn't exist or not accessible
				}
			}

			if (gitignoreExists) {
				try {
					const lines = (await fs.readFile(gitIgnorePath, 'utf8'))
						.split('\n')
						.map((line) => line.trim())
						.filter((line) => line.length && !line.startsWith('#'));

					// The 'ignore' library handles path relativity based on where rules are added.
					// We need to make paths relative to the directory containing the .gitignore file.
					const relativeLines = lines.map((line) => {
						// Handle absolute paths in .gitignore (starting with /) relative to git root if available
						if (line.startsWith('/') && normalizedGitRoot) {
							return path.relative(currentPath, path.join(normalizedGitRoot, line));
						}
						// Otherwise, treat as relative to the current .gitignore directory
						return line;
					});

					ig.add(relativeLines);
				} catch (readError) {
					this.fsService.log.warn(`Error reading .gitignore file at ${gitIgnorePath}: ${readError.message}`);
					// If we couldn't read it, remove from cache? Or just log? For now, just log.
					// gitIgnorePaths.delete(gitIgnorePath);
				}
			}

			// Check if we've reached the git root directory provided
			if (normalizedGitRoot && path.normalize(currentPath) === normalizedGitRoot) {
				break;
			}

			// Determine the parent directory
			const parentPath = path.dirname(currentPath);

			// If we've reached the filesystem root or the parent is the same, stop
			if (parentPath === currentPath) {
				break;
			}

			// Move to the parent directory for the next iteration
			currentPath = parentPath;
		}

		ig.add('.git'); // Always ignore .git directory itself
		return ig;
	}

	/** Lists only folders in a directory */
	async listFolders(dirPath = '.'): Promise<string[]> {
		const workingDir = this.fsService.getWorkingDirectory();
		let absoluteDirPath: string;

		if (path.isAbsolute(dirPath)) {
			absoluteDirPath = path.resolve(dirPath);
			if (!absoluteDirPath.startsWith(this.fsService.basePath)) {
				throw new Error(`Access denied: Cannot list folders outside of base path: ${absoluteDirPath}`);
			}
		} else {
			absoluteDirPath = path.resolve(workingDir, dirPath);
			// Double check resolved path
			if (!absoluteDirPath.startsWith(this.fsService.basePath)) {
				throw new Error(`Access denied: Resolved path is outside of base path: ${absoluteDirPath}`);
			}
		}

		// TODO: This function currently does NOT respect .gitignore. Should it?
		// If yes, it needs logic similar to listFilesInDirectory or listFilesRecursively.

		try {
			const items = await fs.readdir(absoluteDirPath);
			const folders: string[] = [];

			for (const item of items) {
				const itemPath = path.join(absoluteDirPath, item);
				try {
					const stat = await fs.stat(itemPath);
					if (stat.isDirectory()) {
						// Check if it's the .git directory
						if (item !== '.git') {
							folders.push(item); // Return only the subfolder name
						}
					}
				} catch (statError) {
					// Ignore errors for individual items (e.g., broken symlinks)
					this.fsService.log.warn(`Could not stat item ${itemPath}: ${statError.message}`);
				}
			}
			return folders;
		} catch (error) {
			this.fsService.log.error(`Error reading directory for listing folders: ${absoluteDirPath}`, error);
			return []; // Return empty array on error
		}
	}

	/**
	 * Recursively lists all folders under the given root directory, respecting .gitignore.
	 * @param dir The root directory to start the search from (relative to working dir or absolute). Defaults to the current working directory.
	 * @returns A promise that resolves to an array of folder paths relative to the working directory.
	 */
	async getAllFoldersRecursively(dir = './'): Promise<string[]> {
		const workingDir = this.fsService.getWorkingDirectory();
		const startPath = path.isAbsolute(dir) ? path.resolve(dir) : path.resolve(workingDir, dir);

		if (!startPath.startsWith(this.fsService.basePath)) {
			throw new Error(`Access denied: Cannot list folders outside of base path: ${startPath}`);
		}

		const gitRoot = this.fsService.getVcsRoot();
		// Load initial ignore rules based on the starting path
		const rootIg = await this.loadGitignoreRules(startPath, gitRoot);

		const folders: string[] = [];

		const recurse = async (currentPath: string, parentIg: Ignore) => {
			// Calculate path relative to workingDir for result and ignore checks
			const relativePath = path.relative(workingDir, currentPath);

			// Load ignore rules for the current directory and merge with parent
			const currentIg = await this.loadGitignoreRules(currentPath, gitRoot);
			const mergedIg = ignore().add(parentIg).add(currentIg);

			// Check if the current directory itself should be ignored (relative to workingDir)
			// Check both 'name' and 'name/' forms. Don't add the root '.' if dir was './' or absolute path resolves to workingDir.
			const shouldAddCurrent = relativePath && !mergedIg.ignores(relativePath) && !mergedIg.ignores(`${relativePath}/`);

			if (shouldAddCurrent) {
				folders.push(relativePath);
			}

			try {
				const dirents = await fs.readdir(currentPath, { withFileTypes: true });
				for (const dirent of dirents) {
					if (dirent.isDirectory()) {
						const childPath = path.join(currentPath, dirent.name);
						const childRelativePath = path.relative(workingDir, childPath);
						// Check if the child directory should be ignored before recursing
						if (!mergedIg.ignores(childRelativePath) && !mergedIg.ignores(`${childRelativePath}/`)) {
							await recurse(childPath, mergedIg); // Pass merged rules down
						}
					}
				}
			} catch (error) {
				this.fsService.log.warn(`Error reading directory ${currentPath} during recursive folder listing: ${error.message}`);
			}
		};

		// Start recursion from the resolved startPath, passing the initial ignore rules
		await recurse(startPath, rootIg);
		// No need to filter '.' as shouldAddCurrent handles it.
		return folders;
	}

	/**
	 * Generates a textual representation of a directory tree structure.
	 * Uses listFilesRecursively respecting .gitignore.
	 * @param dirPath - Path relative to working directory or absolute.
	 * @returns A string representation of the directory tree relative to dirPath's resolved location.
	 */
	async getFileSystemTree(dirPath = './'): Promise<string> {
		const workingDir = this.fsService.getWorkingDirectory();
		// Resolve the starting path fully first
		const startPathResolved = path.isAbsolute(dirPath) ? path.resolve(dirPath) : path.resolve(workingDir, dirPath);

		if (!startPathResolved.startsWith(this.fsService.basePath)) {
			throw new Error(`Access denied: Cannot generate tree outside of base path: ${startPathResolved}`);
		}

		// Get files relative to the *working directory* first, starting from the resolved path
		const filesRelativeWorkingDir = await this.listFilesRecursively(startPathResolved); // Pass resolved path

		// Make paths relative to the *resolved start path* for tree building
		const filesRelativeStartDir = filesRelativeWorkingDir.map((f) => path.relative(startPathResolved, path.resolve(workingDir, f)));

		// Build the tree structure using a Map for easier hierarchy management
		const tree = new Map<string, { dirs: Set<string>; files: Set<string> }>();

		// Helper to ensure a directory exists in the map
		const ensureDir = (dir: string) => {
			if (!tree.has(dir)) {
				tree.set(dir, { dirs: new Set(), files: new Set() });
			}
		};

		// Populate the tree
		filesRelativeStartDir.forEach((file) => {
			const parts = file.split(path.sep);
			let currentDirPath = '.'; // Root relative to startPathResolved
			ensureDir(currentDirPath);

			// Add intermediate directories
			for (let i = 0; i < parts.length - 1; i++) {
				const parentPath = currentDirPath;
				currentDirPath = path.join(currentDirPath, parts[i]);
				ensureDir(currentDirPath);
				tree.get(parentPath)?.dirs.add(parts[i]); // Add subdir name to parent
			}

			// Add the file to its directory
			const filename = parts[parts.length - 1];
			tree.get(currentDirPath)?.files.add(filename);
		});

		// Generate the string representation
		let output = '';
		const buildTreeString = (dir: string, indent: string) => {
			const node = tree.get(dir);
			if (!node) return; // Should not happen if ensureDir worked

			// Sort and add subdirectories
			const sortedDirs = Array.from(node.dirs).sort();
			sortedDirs.forEach((subDirName) => {
				const subDirPath = path.join(dir, subDirName);
				output += `${indent}${subDirName}/\n`;
				buildTreeString(subDirPath, indent + '  '); // Recurse
			});

			// Sort and add files
			const sortedFiles = Array.from(node.files).sort();
			sortedFiles.forEach((fileName) => {
				output += `${indent}${fileName}\n`;
			});
		};

		// Start building from the root ('.') relative to the resolved start path
		buildTreeString('.', ''); // Start with empty indent for the root's children

		return output.trimEnd(); // Remove trailing newline
	}

	/**
	 * Returns the filesystem structure as a Record.
	 * @param dirPath Path relative to working directory or absolute.
	 * @returns A record with keys as folder paths (relative to resolved dirPath) and values as arrays of filenames.
	 */
	async getFileSystemTreeStructure(dirPath = './'): Promise<Record<string, string[]>> {
		const workingDir = this.fsService.getWorkingDirectory();
		// Resolve the starting path fully first
		const startPathResolved = path.isAbsolute(dirPath) ? path.resolve(dirPath) : path.resolve(workingDir, dirPath);

		if (!startPathResolved.startsWith(this.fsService.basePath)) {
			throw new Error(`Access denied: Cannot get structure outside of base path: ${startPathResolved}`);
		}

		// Get files relative to the working directory first
		const filesRelativeWorkingDir = await this.listFilesRecursively(startPathResolved); // Pass resolved path
		// Make paths relative to the resolved start path
		const filesRelativeStartDir = filesRelativeWorkingDir.map((f) => path.relative(startPathResolved, path.resolve(workingDir, f)));

		const tree: Record<string, string[]> = {};

		filesRelativeStartDir.forEach((file) => {
			const dir = path.dirname(file);
			const filename = path.basename(file);

			if (!tree[dir]) {
				tree[dir] = [];
			}
			tree[dir].push(filename);
		});

		// Sort filenames within each directory
		Object.keys(tree).forEach((dir) => tree[dir].sort());

		return tree;
	}
}

/**
 * Sanitise arguments by single quoting and escaping single quotes in the value
 * @param arg command line argument value
 */
function arg(argValue: string): string {
	// Ensure the argument is treated as a single token, escaping potential issues.
	// Simple quoting for common cases. More robust shell escaping might be needed
	// depending on the complexity of regex patterns allowed.
	// Escapes single quotes for POSIX shells (' -> '\''')
	return `'${argValue.replace(/'/g, "'\\''")}'`;
}
