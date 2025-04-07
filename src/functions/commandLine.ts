import { getFileSystem, llms } from '#agent/agentContextLocalStorage';
import { humanInTheLoop } from '#agent/humanInTheLoop';
import { func, funcClass } from '#functionSchema/functionDecorators';
import { system, user } from '#llm/llm';
import { execCommand } from '#utils/exec';

@funcClass(__filename)
export class CommandLineInterface {
	/**
	 * Executes the command in the current working directory
	 * @returns the stdout and stderr
	 */
	@func()
	async execute(command: string): Promise<{ stdout: string; stderr: string }> {
		const fss = getFileSystem();

		const info = `
Current directory: ${fss.getWorkingDirectory()}
Git repo folder: ${fss.getVcsRoot() ?? '<none>'}
`;
		const response = await llms().medium.generateText([
			system(
				'You are to analyze the provided shell command to determine if it is safe to run, i.e. will not cause data loss or other unintended consequences to the host system.',
			),
			user(
				`The command which is being requested to execute is:\n${command}\n\n\n Think through the dangers of running this command and response with only a single word, either SAFE or DANGEROUS`,
			),
		]);
		if (response !== 'SAFE') await humanInTheLoop(`Executing the command "${command}" could be dangerous. Please review the command carefully`);

		const result = await execCommand(command);
		if (result.exitCode !== 0) throw new Error(`Error executing command ${command}. Return code ${result.exitCode}. Err: ${result.stderr}`);
		return { stdout: result.stdout, stderr: result.stderr };
	}
}
