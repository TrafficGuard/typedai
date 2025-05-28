import * as nodePath from 'node:path';
import { logger } from '#o11y/logger';
import type { IFileSystemService } from '#shared/services/fileSystemService';
import { execCommand } from '#utils/exec';
import type { EditSession } from '../editSession';
import type { EditHook, HookResult } from './editHook';

export class CompileHook implements EditHook {
	readonly name = 'compile';
	private readonly filePathRegex = /(?:[a-zA-Z]:)?(?:[\\/][\w.-]+)+[\w.-]+\.[a-zA-Z0-9_]+/g;

	/**
	 * Creates a CompileHook.
	 * @param compileCmd The compile command to execute. If it contains shell-specific syntax (e.g., pipes, variable expansions),
	 *                   it will be executed within a shell.
	 * @param fs Filesystem service to check for existence of discovered files.
	 */
	constructor(
		private compileCmd: string | undefined,
		private fs: IFileSystemService,
	) {}

	private async extractAndVerifyFiles(output: string, workingDir: string, existingFilesInContextAbs: Set<string>): Promise<string[]> {
		if (!output) return [];
		const potentialPaths = output.match(this.filePathRegex) || [];
		const newRelevantFilesRel: Set<string> = new Set();

		for (const pPath of potentialPaths) {
			// Clean path: remove trailing colons, line numbers, quotes
			const cleanedPath = pPath.replace(/[:"'].*$/, '').trim();
			if (!cleanedPath) continue;

			let absolutePath = cleanedPath;
			if (!nodePath.isAbsolute(cleanedPath)) {
				absolutePath = nodePath.resolve(workingDir, cleanedPath);
			}

			// Ensure the path is within the working directory and exists
			if (absolutePath.startsWith(workingDir) && await this.fs.fileExists(absolutePath)) {
				if (!existingFilesInContextAbs.has(absolutePath)) {
					newRelevantFilesRel.add(nodePath.relative(workingDir, absolutePath));
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
			return { ok: false, message: fullMessage.slice(0, 4000), additionalFiles };
		} catch (error: any) {
			logger.error({ err: error }, `CompileHook: Error executing compile command: ${this.compileCmd}`);
			return { ok: false, message: `Error executing compile command: ${error.message}`.slice(0, 4000) };
		}
	}
}
