import { logger } from '#o11y/logger';
import { execCommand } from '#utils/exec';
import type { EditSession } from '../editSession';
import type { EditHook, HookResult } from './editHook';

export class CompileHook implements EditHook {
	readonly name = 'compile';

	/**
	 * Creates a CompileHook.
	 * @param compileCmd The compile command to execute. If it contains shell-specific syntax (e.g., pipes, variable expansions),
	 *                   it will be executed within a shell.
	 */
	constructor(private compileCmd: string | undefined) {}

	async run(session: EditSession): Promise<HookResult> {
		if (!this.compileCmd) {
			logger.info('CompileHook: No compile command provided, skipping.');
			return { ok: true, message: 'No compile command configured.' };
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
			return { ok: false, message: fullMessage.slice(0, 4000) };
		} catch (error: any) {
			logger.error({ err: error }, `CompileHook: Error executing compile command: ${this.compileCmd}`);
			return { ok: false, message: `Error executing compile command: ${error.message}`.slice(0, 4000) };
		}
	}
}
