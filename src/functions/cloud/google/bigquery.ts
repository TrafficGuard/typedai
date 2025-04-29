import { BigQuery as BigQueryClient } from '@google-cloud/bigquery';
import { addCost } from '#agent/agentContextLocalStorage';
import { humanInTheLoop } from '#agent/humanInTheLoop';
import { func, funcClass } from '#functionSchema/functionDecorators';
import { logger } from '#o11y/logger';
import { execCmd, execCommand, failOnError } from '#utils/exec';
const Table = require('table');

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
	async query(sqlQuery: string, location: string, projectId: string | undefined): Promise<string> {
		projectId ??= process.env.GCLOUD_PROJECT;
		const result = await new BigQueryDriver(projectId, location).query(sqlQuery);
		if (result.length > 5001) {
			return `${result.substring(0, 5000)}\n<truncated>`;
		}
		return result;
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

class BigQueryDriver {
	private bigqueryClient: BigQueryClient;

	constructor(
		projectId: string,
		private defaultLocation = 'us',
	) {
		this.bigqueryClient = new BigQueryClient({ projectId });
	}

	async query<T>(query: string): Promise<string> {
		const [dryRun] = await this.bigqueryClient.createQueryJob({
			query,
			location: this.defaultLocation,
			dryRun: true,
		});

		const estimatedBytesProcessed = dryRun.metadata.statistics.totalBytesProcessed;
		const gb = estimatedBytesProcessed / 1000 / 1000 / 1000;
		if (gb > 100) await humanInTheLoop(`Requesting to run bigquery processing ${gb.toFixed(0)}GB.\nQuery:${query}`);
		logger.info('querying...');
		const [job] = await this.bigqueryClient.createQueryJob({
			query,
			location: this.defaultLocation,
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

		// Create and print the table
		return Table.table(tableData, {
			columns: headers.map((header) => ({ alignment: 'left', width: 20 })),
		});
	}
}
