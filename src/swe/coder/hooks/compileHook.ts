import * as nodePath from 'node:path';
import { logger } from '#o11y/logger';
import type { IFileSystemService } from '#shared/services/fileSystemService';
import { execCommand } from '#utils/exec';
import type { EditSession } from '../editSession';
import type { EditHook, HookResult } from './editHook';

export class CompileHook implements EditHook {
	readonly name = 'compile';
	// Regex to capture various file path formats.
	// It's constructed by ORing patterns for:
	// 1. Windows absolute paths (C:\foo\bar.js)
	// 2. POSIX absolute paths (/foo/bar.js)
	// 3. Relative paths with directories (foo/bar.js, ../foo/bar.js)
	// 4. Simple filenames (foo.js)
	// This pattern is for Unix/Linux paths. It allows spaces within path components via [\w\s.-]+.
	// It handles absolute paths, relative paths with directories, and simple filenames.
	// Corrected: Use single backslashes for regex tokens like \w, \s, \.
	// For path separators, explicitly use / for Unix.	
	private readonly unixCorePathPattern: string;
	private readonly filePathRegex: RegExp;


	/**
	 * Creates a CompileHook.
	 * @param compileCmd The compile command to execute. If it contains shell-specific syntax (e.g., pipes, variable expansions),
	 *                   it will be executed within a shell.
	 * @param fs Filesystem service to check for existence of discovered files.
	 */
	constructor(
		private compileCmd: string | undefined,
		private fs: IFileSystemService,
	) {
		// More explicit character set for path components, equivalent to [\w\s.-] but clearer.
		// Allows alphanumeric, underscore, whitespace, dot, hyphen.
		const pathChars = '[a-zA-Z0-9_\\s.-]';
		const pathComponent = `${pathChars}+`;
		const pathSeparator = '[\\\\/]'; // Allow both / and \ as separators. Must double-escape backslash for string literal.
		const extensionComponent = '\\.[a-zA-Z0-9_]+'; // Matches a dot followed by extension characters

		const simpleFilename = `${pathComponent}${extensionComponent}`; // e.g., file.ts, my-doc.pdf
		const relativePathWithDir = `(?:${pathComponent}${pathSeparator})+${simpleFilename}`; // e.g., sub/file.ts, path/to/doc.txt or sub\\file.ts
		const unixAbsolutePath = `${pathSeparator}(?:${pathComponent}${pathSeparator})*${simpleFilename}`; // e.g., /abs/file.ts

		this.unixCorePathPattern = `(?:${unixAbsolutePath}|${relativePathWithDir}|${simpleFilename})`;

		// Construct the regex to match the unixCorePathPattern, optionally wrapped in balanced single or double quotes.
		// The outer group (['"])? captures the potential quote, and \1 matches the same captured quote.
		// The second part |${this.unixCorePathPattern} matches paths without quotes.
		this.filePathRegex = new RegExp(`(['"])?${this.unixCorePathPattern}\\1|${this.unixCorePathPattern}`, 'g');
	}

	private async extractAndVerifyFiles(output: string, workingDir: string, existingFilesInContextAbs: Set<string>): Promise<string[]> {
		if (!output) return [];
		const potentialPaths = output.match(this.filePathRegex) || [];
		const newRelevantFilesRel: Set<string> = new Set();

		for (const pPath of potentialPaths) {
			let cleanedPath = pPath.trim();

			// Strip surrounding single or double quotes if they are balanced
			if ((cleanedPath.startsWith("'") && cleanedPath.endsWith("'")) ||
			    (cleanedPath.startsWith('"') && cleanedPath.endsWith('"'))) {
				cleanedPath = cleanedPath.substring(1, cleanedPath.length - 1);
			}

			// Remove trailing colons, line numbers, or other suffixes often found in compiler output.
			// This regex part is applied *after* stripping balanced quotes.
			cleanedPath = cleanedPath.replace(/[:"'].*$/, '').trim();
			if (!cleanedPath) continue;

			let absolutePath = cleanedPath;
			if (!nodePath.isAbsolute(cleanedPath)) {
				absolutePath = nodePath.resolve(workingDir, cleanedPath);
			}

			// Ensure the path is within the working directory and exists
			if (absolutePath.startsWith(workingDir) && await this.fs.fileExists(absolutePath)) {
				if (!existingFilesInContextAbs.has(absolutePath)) {
					// Normalize the relative path to ensure consistent separators for the OS
					newRelevantFilesRel.add(nodePath.normalize(nodePath.relative(workingDir, absolutePath)));
				}
			}
		}
		return Array.from(newRelevantFilesRel);
	}

	async run(session: EditSession): Promise<HookResult> {
		if (!this.compileCmd) {
			logger.info('CompileHook: No compile command provided, skipping.');
			return { ok: true, message: 'No compile command configured.' };
		}
		if (!this.fs) {
			logger.error('CompileHook: FileSystem service not provided. Cannot verify additional files.');
			return { ok: false, message: 'CompileHook misconfigured: FileSystem service missing.' };
		}

		try {
			logger.info(`CompileHook: Running compile command: ${this.compileCmd} in ${session.workingDir}`);
			const { exitCode, stderr, stdout } = await execCommand(this.compileCmd, { workingDirectory: session.workingDir });

			if (exitCode === 0) {
				logger.info('CompileHook: Compile command successful.');
				return { ok: true };
			}

			logger.warn(`CompileHook: Compile command failed with exit code ${exitCode}.`);
			// Combine stdout and stderr for a more complete error message, then truncate.
			const fullMessage = `Stderr:\n${stderr}\n\nStdout:\n${stdout}`;
			const additionalFiles = await this.extractAndVerifyFiles(fullMessage, session.workingDir, session.absFnamesInChat ?? new Set());
			// Truncate the message *after* extracting files, as the full message is needed for extraction.
			return { ok: false, message: fullMessage.slice(0, 4000), additionalFiles };
		} catch (error: any) {
			logger.error({ err: error }, `CompileHook: Error executing compile command: ${this.compileCmd}`);
			// Truncate the error message if it's too long
			return { ok: false, message: `Error executing compile command: ${error.message}`.slice(0, 4000) };
		}
	}
}
