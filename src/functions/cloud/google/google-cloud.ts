import { GoogleAuth } from 'google-auth-library';
import { stringify as yamlStringify } from 'yaml';
import { agentContext } from '#agent/agentContextLocalStorage';
import { humanInTheLoop } from '#agent/autonomous/humanInTheLoop';
import { func, funcClass } from '#functionSchema/functionDecorators';
import { extractCommonProperties } from '#utils/arrayUtils';
import { execCommand, failOnError } from '#utils/exec';
@funcClass(__filename)
export class GoogleCloud {
	/**
	 * Gets the logs from Google Cloud Logging.
	 * Either provide freshness or provide dateFromIso and/or dateToIso.
	 * The results will be limited to 1000 results. Make further calls adjusting the time options to get more results.
	 * @param {string} projectId - The Google Cloud projectId
	 * @param {string} filter - The Cloud Logging filter to search (e.g. "resource.type=cloud_run_revision" and "resource.labels.service_name=the-service-name")
	 * @param {Object} options - Configuration options
	 * @param {string} [options.dateFromIso] - The date/time to get the logs from. Optional.
	 * @param {string} [options.dateToIso] - The date/time to get the logs to. Optional.
	 * @param {string} [options.freshness] - The freshness of the logs (eg. 10m, 1h). Optional.
	 * @param {string} [options.format] - Format of the response. Defaults to 'yaml' which is more compact and token efficient than 'json'. If you need to parse the results into JSON for programatic use, set this to 'json'.
	 * @param {'asc'|'desc'} [options.order] - The order of the logs (asc or desc. defaults to desc). Optional.
	 * @param {number} [options.limit] - The limit of the logs. Optional. Defaults to 200. Maximum of 500.
	 * @returns {Promise<string>}
	 */
	@func()
	async getCloudLoggingLogs(
		projectId: string,
		filter: string,
		options: { dateFromIso?: string; dateToIso?: string; freshness?: string; order?: 'asc' | 'desc'; limit?: number; format?: 'json' | 'yaml' },
	): Promise<string> {
		let logFiler = filter;
		if (options.dateFromIso) logFiler += ` AND timestamp>="${options.dateFromIso}"`;
		if (options.dateToIso) logFiler += ` AND timestamp<="${options.dateToIso}"`;
		if (options.order) logFiler += ` AND order=${options.order}`;

		let cmd = `gcloud logging read '${filter}' -q --project=${projectId} --format="json"`;
		if (options.freshness) cmd += ` --freshness=${options.freshness}`;
		if (options.order) cmd += ` --order=${options.order}`;
		if (options?.limit && options.limit > 500) options.limit = 500;
		cmd += ` --limit=${options.limit ?? 200}`;

		const result = await execCommand(cmd);

		try {
			const json = JSON.parse(result.stdout);

			if (options.format === 'json') return result.stdout;

			if (!Array.isArray(json) || json.length === 0) return yamlStringify(json);

			// Logs for a single resource type will have common properties. Extract them out to reduce tokens returned.
			const { commonProps, strippedItems } = extractCommonProperties(json);

			const hasCommonProps = Object.keys(commonProps).length > 0;
			const output = hasCommonProps
				? json
				: {
						logCount: strippedItems.length,
						commonProperties: commonProps,
						logs: strippedItems,
					};

			// Return YAML by default for token efficiency
			return yamlStringify(output, { indent: 2 });
		} catch (e) {
			if (result.exitCode > 0) throw new Error(`Error running '${cmd}'. ${result.stdout}${result.stderr}`);
			return result.stdout;
		}
	}

	/**
	 * Gets the spans from Google Cloud Trace
	 * @param {string} projectId - The Google Cloud projectId
	 * @param {string} traceId - The trace id
	 * @returns {Promise<string>} the spans as a JSON string, or 'Trace Id not found' if the trace id is not found
	 */
	// @func()
	async getTraceSpans(projectId: string, traceId: string) {
		const auth = new GoogleAuth({ scopes: 'https://www.googleapis.com/auth/cloud-platform' });
		const client = await auth.getClient();
		const url = `https://cloudtrace.googleapis.com/v1/projects/${projectId}/traces/${traceId}`;
		const res = await client.request({ url });
		const trace = res.data;
		return trace ? JSON.stringify((trace as any).spans) : 'Trace Id not found';
	}

	/**
	 * Runs the BigQuery bq command line tool
	 * Example command:
	 * bq ls -j --max_results=50 --format=prettyjson --project_id=test_project_id --filter="labels.costcode:daily-data-aggregation"
	 * If you are having issues wih the arguments, either call this function with `bq help [COMMAND]` or read https://cloud.google.com/bigquery/docs/reference/bq-cli-reference
	 * The only supported commands are: ls, query, show, get-iam-policy, head
	 * @param bqCommand The bq command to execute
	 * @returns the console output if the exit code is 0, else throws the console output
	 */
	@func()
	async executeBqCommand(bqCommand: string): Promise<string> {
		const args = bqCommand.split(' ');
		if (args[0] !== 'bq') throw new Error('When calling executeBqCommand the bqCommand parameter must start with "bq"');

		const cmd = args[1];
		const supportedCommands = new Set(['ls', 'query', 'show', 'get-iam-policy', 'head']);
		if (!supportedCommands.has(cmd)) {
			throw new Error(
				`Command "${bqCommand}" does not appear to be a read operation. Only list, describe, get-iam-policy and read operations are allowed. If you feel that this is a mistake, please request for the gcloud command whitelisting to be updated`,
			);
		}

		if (cmd === 'query') {
			const _100gb_in_bytes = 100 * 1024 * 1024 * 1024;
			// if(bqCommand.includes('--maximum_bytes_billed=')) {
			// 	// extract the value
			// 	const maximumBytesBilled = parseInt(bqCommand.split('--maximum_bytes_billed=')[1]);
			// 	if(maximumBytesBilled < _100gb_in_bytes) throw new Error('The maximum_bytes_billed value must be at least 100GB');
			// }

			bqCommand += ` --maximum_bytes_billed=${_100gb_in_bytes}`;
		}

		const result = await execCommand(bqCommand);
		if (result.exitCode > 0) throw new Error(`Error running ${bqCommand}. ${result.stdout}${result.stderr}`);
		return result.stdout;
	}

	/**
	 * Query resource information by executing the gcloud command line tool. This must ONLY be used for querying information, and MUST NOT update or modify resources.
	 * If the command supports the --project=<projectId> argument then it MUST be included.
	 * @param gcloudQueryCommand The gcloud query command to execute (incuding --project=<projectId> if allowed)
	 * @returns the console output if the exit code is 0, else throws the console output
	 */
	@func()
	async executeGcloudCommandQuery(gcloudQueryCommand: string): Promise<string> {
		// if (!gcloudQueryCommand.includes('--project='))
		// 	throw new Error('When calling executeGcloudCommandQuery the gcloudQueryCommand parameter must include the --project=<projectId> argument');
		if (gcloudQueryCommand.split(' ')[0] !== 'gcloud')
			throw new Error('When calling executeGcloudCommandQuery the gcloudQueryCommand parameter must start with "gcloud"');

		// Whitelist list, describe and get-iam-policy commands, otherwise throw an error
		const args = gcloudQueryCommand.split(' ');
		if (args[1] === 'alpha' || args[1] === 'beta') {
			args.splice(1, 1);
		}

		let isQuery = false;
		for (const i of [2, 3, 4, 5]) {
			if (!args[i]) break;
			if (args[i].startsWith('list') || args[i] === 'describe' || args[i] === 'get-iam-policy' || args[i] === 'read') isQuery = true;
		}

		if (!isQuery)
			throw new Error(
				`Command "${gcloudQueryCommand}" does not appear to be a read operation. Only list, describe, get-iam-policy and read operations are allowed. If you feel that this is a mistake, please request for the gcloud command whitelisting to be updated`,
			);

		const result = await execCommand(gcloudQueryCommand);

		if (result.exitCode > 0) throw new Error(`Error running ${gcloudQueryCommand}. ${result.stdout}${result.stderr}`);
		return result.stdout;
	}

	/**
	 * Runs a gcloud command which make changes to cloud resources. The command will be validated by a human reviewer.
	 * If the command supports the --project=<projectId> argument then it must be included.
	 * @param gcloudModifyCommand The gcloud command to execute (incuding --project=<projectId> if allowed)
	 * @returns the console output if the exit code is 0, else throws the console output or human review rejection reason
	 */
	// @func()
	async executeGcloudCommandModification(gcloudModifyCommand: string): Promise<string> {
		if (!gcloudModifyCommand.includes('--project='))
			throw new Error('When calling executeGcloudCommandQuery the gcloudQueryCommand parameter must include the --project=<projectId> argument');
		await humanInTheLoop(agentContext()!, `Agent "${agentContext()!.name}" is requesting to run the command ${gcloudModifyCommand}`);

		const result = await execCommand(gcloudModifyCommand);
		failOnError('Error running gcloudModifyCommand', result);
		return result.stdout;
	}
}
