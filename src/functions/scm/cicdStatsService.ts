export function buildJobUrl(job: JobResult): string {
	if (job.host.includes('github.com')) return `https://${job.host}/${job.project}/actions/runs/${job.buildId}`;

	return `https://${job.host}/${job.project}/-/jobs/${job.buildId}`;
}

export interface JobResult {
	buildId: number;
	project: string;
	status: string;
	jobName: string;
	stage: string;
	startedAt: string;
	duration: number;
	pipeline: number;
	host: string;
	/** build_failure_reason field */
	failureReason?: string;
	/** Our classification of the failure type */
	failureType?: string;
}

export interface CICDStatsService {
	saveJobResult(jobResult: JobResult): Promise<void>;

	getRecentSuccessfulJobs(project: string, jobName: string): Promise<JobResult[]>;
}
