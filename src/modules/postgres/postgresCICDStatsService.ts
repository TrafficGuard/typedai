import { randomUUID } from 'node:crypto';
import { CICDStatsService, JobResult } from '#functions/scm/cicdStatsService';
import { logger } from '#o11y/logger';
import { span } from '#o11y/trace';
import { db } from './db';

export class PostgresCICDStatsService implements CICDStatsService {
	@span()
	async saveJobResult(jobResult: JobResult): Promise<void> {
		await db
			.insertInto('cicd_stats')
			.values({
				id: randomUUID(),
				build_id: jobResult.buildId,
				project: jobResult.project,
				status: jobResult.status,
				job_name: jobResult.jobName,
				stage: jobResult.stage,
				started_at: jobResult.startedAt,
				duration: jobResult.duration,
				pipeline: jobResult.pipeline,
				host: jobResult.host,
				failure_reason: jobResult.failureReason ?? null,
				failure_type: jobResult.failureType ?? null,
			})
			.execute();
	}

	@span()
	async getRecentSuccessfulJobs(project: string, jobName: string): Promise<JobResult[]> {
		const rows = await db
			.selectFrom('cicd_stats')
			.selectAll()
			.where('project', '=', project)
			.where('job_name', '=', jobName)
			.where('status', '=', 'success')
			.orderBy('started_at', 'desc')
			.limit(20)
			.execute();

		return rows.map((row) => ({
			buildId: row.build_id,
			project: row.project,
			status: row.status,
			jobName: row.job_name,
			stage: row.stage,
			startedAt: row.started_at,
			duration: row.duration,
			pipeline: row.pipeline,
			host: row.host,
			failureReason: row.failure_reason ?? undefined,
			failureType: row.failure_type ?? undefined,
		}));
	}
}
