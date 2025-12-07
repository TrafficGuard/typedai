import { BigQuery as BigQueryClient } from '@google-cloud/bigquery';
import { agentContext } from '#agent/agentContext';
import { addCost } from '#agent/agentContext';
import { humanInTheLoop } from '#agent/autonomous/humanInTheLoop';
import { func, funcClass } from '#functionSchema/functionDecorators';
import { logger } from '#o11y/logger';
import { execCmd, execCommand, failOnError } from '#utils/exec';

// Should use either bq or the node library in all functions
@funcClass(__filename)
export class BigQuery {
	/**
	 * Run a BigQuery query and return the results.
	 * @param sqlQuery The query to run
	 * @param location The (multi)region to run the query in. eg. us, us-central1
	 * @param projectId The Google Cloud project id to run the query from. Defaults to the GCLOUD_PROJECT environment variable
	 */
	@func()
	async query(sqlQuery: string, location: string, projectId: string | undefined): Promise<any[][]> {
		projectId ??= process.env.GCLOUD_PROJECT;
		if (!projectId) throw new Error('GCLOUD_PROJECT environment variable not set');
		return await new BigQueryDriver(projectId, location).query(sqlQuery);
	}

	/**
	 * Get the schema of a BigQuery table.
	 * @param tableId Table id in the format project_id:dataset.table
	 */
	@func()
	async getTableSchema(tableId: string): Promise<string> {
		const cmd = `bq show --schema --format=prettyjson ${tableId}`;
		const result = await execCommand(cmd);
		if (result.exitCode > 0) throw new Error(`Error running '${cmd}'. ${result.stdout}${result.stderr}`);
		return result.stdout;
	}
}

export class BigQueryDriver {
	private bigqueryClient: BigQueryClient;

	constructor(
		projectId: string,
		private defaultLocation = 'us',
	) {
		this.bigqueryClient = new BigQueryClient({ projectId });
	}

	async query<T>(query: string, queryParameters?: Record<string, any>): Promise<any[][]> {
		const [dryRun] = await this.bigqueryClient.createQueryJob({
			query,
			location: this.defaultLocation,
			params: queryParameters,
			dryRun: true,
		});

		const estimatedBytesProcessed = dryRun.metadata.statistics.totalBytesProcessed;
		const gb = estimatedBytesProcessed / 1000 / 1000 / 1000;
		if (gb > 100) await humanInTheLoop(agentContext()!, `Requesting to run bigquery processing ${gb.toFixed(0)}GB.\nQuery:${query}`);
		logger.info('querying...');
		const [job] = await this.bigqueryClient.createQueryJob({
			query,
			location: this.defaultLocation,
			params: queryParameters,
		});

		// Wait for the query to finish
		const [rows] = await job.getQueryResults();

		// should we be dividing by 1024 for a GiB/TiB?
		addCost((gb / 1000) * 6.25);

		// Prepare the table data
		const tableData = rows.map((row) => Object.values(row));

		// Add headers to the table data
		const headers = Object.keys(rows[0]);
		tableData.unshift(headers);

		return tableData;
	}
}
