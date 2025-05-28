import type { EditHook, HookResult } from './EditHook';
import type { EditSession } from '../EditSession';
import { logger } from '#o11y/logger';

export class CompileHook implements EditHook {
	readonly name = 'compile';

	constructor(private compileCmd: string | undefined) {}

	async run(session: EditSession): Promise<HookResult> {
		if (!this.compileCmd) {
			logger.info('CompileHook: No compile command provided, skipping.');
			return { ok: true, message: 'No compile command configured.' };
		}

		// Dynamically import execCommand to avoid issues if #utils/exec is not always available
		// or to break circular dependencies if they were to arise.
		let execCommand;
		try {
			const execModule = await import('#utils/exec');
			execCommand = execModule.execCommand;
		} catch (e: any) {
			logger.error({ err: e }, 'CompileHook: Failed to import execCommand from #utils/exec.');
			return { ok: false, message: `CompileHook: Failed to import execCommand: ${e.message}` };
		}

		try {
			logger.info(`CompileHook: Running compile command: ${this.compileCmd} in ${session.workingDir}`);
			const { exitCode, stderr, stdout } = await execCommand(this.compileCmd, { cwd: session.workingDir });

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
