import { getFileSystem, llms } from '#agent/agentContextLocalStorage';
import { humanInTheLoop } from '#agent/autonomous/humanInTheLoop';
import { func, funcClass } from '#functionSchema/functionDecorators';
import { system, user } from '#shared/llm/llm.model';
import { execCommand } from '#utils/exec';

@funcClass(__filename)
export class CommandLineInterface {
	/**
	 * @param command The command to execute in the current working directory
	 * @returns an object with the stdout and stderr properties
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
				'You are to analyze the provided shell command to determine if it is safe to run, i.e. will not cause configuration changes, data loss or other unintended consequences to the host system or remote systems. Reading files/config and modifying files under version control is acceptable.',
			),
			user(
				`The command which is being requested to execute is:\n${command}\n\n\n Think through the dangers of running this command and response with only a single word, either SAFE, UNSURE or DANGEROUS`,
			),
		]);
		// if (response !== 'SAFE')
		await humanInTheLoop(`Requesting to execute the shell command: ${command}\nCWD: ${getFileSystem().getWorkingDirectory()}\nSafety analysis: ${response}`);

		const result = await execCommand(command);
		if (result.exitCode !== 0) throw new Error(`Error executing command ${command}. Return code ${result.exitCode}. Err: ${result.stderr}`);
		return { stdout: result.stdout, stderr: result.stderr };
	}
}
