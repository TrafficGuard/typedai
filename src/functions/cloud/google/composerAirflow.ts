import { existsSync, readFile, readFileSync } from 'node:fs';
import { join } from 'node:path';
import axios, { AxiosInstance, AxiosResponse } from 'axios';
import { GoogleAuth } from 'google-auth-library';
import { func, funcClass } from '#functionSchema/functionDecorators';

const AUTH_SCOPE = 'https://www.googleapis.com/auth/cloud-platform';

interface DagConfig {
	[key: string]: any;
}

interface DagRun {
	conf: any;
	dag_id: string;
	dag_run_id: string;
	data_interval_end: string;
	data_interval_start: string;
	end_date: string;
	execution_date: string;
	external_trigger: boolean;
	last_scheduling_decision: string;
	logical_date: string;
	note: string;
	run_type: string;
	start_date: string;
	state: string;
}

interface TaskInstance {
	dag_id: string;
	dag_run_id: string;
	duration: number;
	end_date: string;
	execution_date: string;
	executor: string;
	executor_config: string;
	hostname: string;
	map_index: number;
	max_tries: number;
	note: string;
	operator: string;
	pid: number;
	pool: string;
	pool_slots: number;
	priority_weight: number;
	queue: string;
	queued_when: string;
	rendered_fields: any;
	rendered_map_index: number;
	sla_miss: any | null;
	start_date: string;
	state: string;
	task_display_name: string;
	task_id: string;
	trigger: any | null;
	triggerer_job: any | null;
	try_number: number;
	unixname: string;
}

let airflowMapping: Record<string, string> | undefined;

/**
 * Required the file airflow.json to be present in the root of the project.
 * The file should contain a JSON object with the following format:
 * {
 *   "gcpProjectId": "https://airflow.example.com"
 * }
 */
@funcClass(__filename)
export class ComposerAirflowClient {
	private auth: GoogleAuth;
	private httpClient: AxiosInstance;

	constructor() {
		// Initialize GoogleAuth client using Application Default Credentials (ADC)
		this.auth = new GoogleAuth({ scopes: [AUTH_SCOPE] });
		this.httpClient = axios.create({ timeout: 90000 });
	}

	/**
	 * Helper function to determine the Composer Airflow Web Server URL based on Google Cloud project ID.
	 */
	private getWebServerUrl(gcpProjectId: string): string {
		if (!airflowMapping) {
			const airflowFilePath = join(process.cwd(), 'airflow.json');
			if (!existsSync(airflowFilePath)) throw new Error(`Airflow config file not found at: ${airflowFilePath}`);
			airflowMapping = JSON.parse(readFileSync(airflowFilePath).toString());
			if (!airflowMapping) throw new Error('Invalid Airflow config');
		}
		if (!airflowMapping[gcpProjectId]) {
			throw new Error(`No Airflow config found for project ID: ${gcpProjectId} Valid project IDs: ${Object.keys(airflowMapping).join(', ')}`);
		}
		return airflowMapping[gcpProjectId];
	}

	/**
	 * Fetches DAG runs for the given DAG ID and Google Cloud Project.
	 *
	 * @param gcpProjectId The Google Cloud Project ID where the Composer environment lives.
	 * @param dagId The ID of the DAG to fetch runs for.
	 * @param limit The maximum number of runs to fetch. (Defaults to 20)
	 */
	@func()
	public async fetchDagRuns(gcpProjectId: string, dagId: string, limit = 20): Promise<DagRun[]> {
		const airflowWebServerUrl = this.getWebServerUrl(gcpProjectId);
		const token = await this.getAuthToken();

		const url = `${airflowWebServerUrl}/api/v1/dags/${dagId}/dagRuns?limit=${limit}`;
		const response = await this.makeRequest(url, 'GET', token);

		return response.data.dag_runs;
	}

	/**
	 * Fetches all task instances for a specific DAG run.
	 * @param gcpProjectId The Google Cloud Project ID.
	 * @param dagId The ID of the DAG.
	 * @param dagRunId The ID of the specific DAG run.
	 * @returns A promise that resolves to an array of task instance objects.
	 */
	@func()
	public async fetchTaskInstances(gcpProjectId: string, dagId: string, dagRunId: string): Promise<TaskInstance[]> {
		const airflowWebServerUrl = this.getWebServerUrl(gcpProjectId);
		const token = await this.getAuthToken();

		const url = `${airflowWebServerUrl}/api/v1/dags/${dagId}/dagRuns/${dagRunId}/taskInstances`;
		const response = await this.makeRequest(url, 'GET', token);

		return response.data.task_instances;
	}

	/**
	 * Fetches the raw log for a specific task attempt.
	 * @param gcpProjectId The Google Cloud Project ID.
	 * @param dagId The ID of the DAG.
	 * @param dagRunId The ID of the DAG run.
	 * @param taskId The ID of the task.
	 * @param tryNumber The attempt number of the task.
	 * @returns A promise that resolves to the raw log content as a string.
	 */
	@func()
	public async fetchTaskLog(gcpProjectId: string, dagId: string, dagRunId: string, taskId: string, tryNumber: number): Promise<string> {
		const airflowWebServerUrl = this.getWebServerUrl(gcpProjectId);
		const token = await this.getAuthToken();

		const url = `${airflowWebServerUrl}/api/v1/dags/${dagId}/dagRuns/${dagRunId}/taskInstances/${taskId}/logs/${tryNumber}`;
		const response = await this.makeRequest(url, 'GET', token);

		return response.data;
	}

	/**
	 * Fetches detailed metadata for a specific DAG.
	 * @param gcpProjectId The Google Cloud Project ID.
	 * @param dagId The ID of the DAG.
	 * @returns A promise that resolves to the DAG detail object.
	 */
	@func()
	public async fetchDagDetails(gcpProjectId: string, dagId: string): Promise<any> {
		const airflowWebServerUrl = this.getWebServerUrl(gcpProjectId);
		const token = await this.getAuthToken();
		const url = `${airflowWebServerUrl}/api/v1/dags/${dagId}`;
		const response = await this.makeRequest(url, 'GET', token);
		return response.data;
	}

	/**
	 * Fetches the current Airflow configuration (airflow.cfg).
	 * @param gcpProjectId The Google Cloud Project ID.
	 * @returns A promise that resolves to the Airflow configuration object.
	 */
	@func()
	public async fetchAirflowConfig(gcpProjectId: string): Promise<any> {
		const airflowWebServerUrl = this.getWebServerUrl(gcpProjectId);
		const token = await this.getAuthToken();

		const url = `${airflowWebServerUrl}/api/v1/config`;
		const response = await this.makeRequest(url, 'GET', token);

		return response.data;
	}

	/**
	 * Fetches a short-lived access token needed for authorization.
	 * This method supports the manual token handling approach seen in fetchDagRuns.
	 * @returns The access token string.
	 */
	private async getAuthToken(): Promise<string> {
		const token = await this.auth.getAccessToken();
		if (!token || typeof token !== 'string' || token.length === 0) throw new Error('Failed to retrieve access token.');
		return token;
	}

	/**
	 * Generic request handler that uses the retrieved token for authorization.
	 * @param url The full URL to fetch.
	 * @param method The HTTP method ('GET', 'POST', etc.).
	 * @param token The Bearer token for Authorization.
	 * @param data Optional payload data for POST/PUT requests.
	 * @returns The Axios response object.
	 */
	private async makeRequest(url: string, method: 'GET' | 'POST' | 'PUT' | 'DELETE', token: string, data?: object): Promise<AxiosResponse> {
		try {
			console.debug(`Making ${method} request to: ${url}`);
			const response = await this.httpClient({
				method,
				url,
				data: data,
				headers: {
					Authorization: `Bearer ${token}`,
					'Content-Type': 'application/json',
				},
			});
			return response;
		} catch (error) {
			if (axios.isAxiosError(error) && error.response) {
				const status = error.response.status;
				if (status === 403) throw new Error(`403 Forbidden: Check Airflow RBAC roles for your account. Details: ${JSON.stringify(error.response.data)}`);
				throw new Error(`Request failed with status ${status}: ${error.response.statusText}. ` + `Response data: ${JSON.stringify(error.response.data)}`);
			}
			throw error;
		}
	}
}
