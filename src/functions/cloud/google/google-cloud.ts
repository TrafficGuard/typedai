import { agentContext } from '#agent/agentContextLocalStorage';
import { humanInTheLoop, waitForConsoleInput } from '#agent/humanInTheLoop';
import { func, funcClass } from '#functionSchema/functionDecorators';
import { execCommand, failOnError } from '#utils/exec';

@funcClass(__filename)
export class GoogleCloud {
	/**
	 * Gets the logs from Google Cloud Logging
	 * @param gcpProjectId The Google Cloud projectId
	 * @param filter The Cloud Logging filter to search
	 * @param dateFromIso The date/time to get the logs from
	 * @param dateToIso The date/time to get the logs to, or empty if upto now.
	 */
	@func()
	async getCloudLoggingLogs(gcpProjectId: string, filter: string, dateFromIso: string, dateToIso: string): Promise<string> {
		const cmd = `gcloud logging read '${filter}' --project=${gcpProjectId} --format="json" --log-filter='timestamp>="${dateFromIso}" AND timestamp<="${dateToIso}"'`;
		const result = await execCommand(cmd);
		if (result.exitCode > 0) throw new Error(`Error running '${cmd}'. ${result.stdout}${result.stderr}`);
		return result.stdout;
	}

	/**
	 * Query resource information by executing the gcloud command line tool. This must ONLY be used for querying information, and MUST NOT update or modify resources.
	 * Must have the --project=<projectId> argument.
	 * @param gcloudQueryCommand The gcloud query command to execute
	 * @returns the console output if the exit code is 0, else throws the console output
	 */
	@func()
	async executeGcloudCommandQuery(gcloudQueryCommand: string): Promise<string> {
		if (!gcloudQueryCommand.includes('--project='))
			throw new Error('When calling executeGcloudCommandQuery the gcloudQueryCommand parameter must include the --project=<projectId> argument');

		// Whitelist list, describe and get-iam-policy commands, otherwise require human-in-the-loop approval
		const args = gcloudQueryCommand.split(' ');
		if (args[1] === 'alpha' || args[1] === 'beta') {
			args.splice(1, 1);
		}

		let isQuery = false;
		for (const i of [2, 3, 4]) {
			if (args[i].startsWith('list') || args[i] === 'describe' || args[i] === 'get-iam-policy') isQuery = true;
		}

		if (!isQuery) {
			await humanInTheLoop(`Agent "${agentContext().name}" is requesting to run the command ${gcloudQueryCommand}`);
		}

		const result = await execCommand(gcloudQueryCommand);
		if (result.exitCode > 0) throw new Error(`Error running ${gcloudQueryCommand}. ${result.stdout}${result.stderr}`);
		return result.stdout;
	}

	/**
	 * Runs a gcloud command which make changes to cloud resources. The command will be validated by a human reviewer. Must have the --project=<projectId> argument.
	 * @param gcloudModifyCommand The gcloud command to execute
	 * @returns the console output if the exit code is 0, else throws the console output or human review rejection reason
	 */
	@func()
	async executeGcloudCommandModification(gcloudModifyCommand: string): Promise<string> {
		await humanInTheLoop(`Agent "${agentContext().name}" is requesting to run the command ${gcloudModifyCommand}`);
		if (!gcloudModifyCommand.includes('--project='))
			throw new Error('When calling executeGcloudCommandQuery the gcloudQueryCommand parameter must include the --project=<projectId> argument');

		const result = await execCommand(gcloudModifyCommand);
		failOnError('Error running gcloudModifyCommand', result);
		return result.stdout;
	}

	// /**
	//  * Returns the open alert incidents across all the production projects
	//  * @returns {string[]} the open alert incidents
	//  */
	// @func()
	// getOpenProductionIncidents(gcpProjectId: string): Promise<string[]> {
	// 	return Promise.resolve([]);
	// }
}
