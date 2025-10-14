import { WebhookJobEventSchema } from '@gitbeaker/core';
import { FirestoreCICDStatsService } from '#firestore/firestoreCICDStatsService';
import { CICDStatsService, JobResult } from '#functions/scm/cicdStatsService';
import { GitLab } from '#functions/scm/gitlab';
import { logger } from '#o11y/logger';
import { envVar } from '#utils/env-var';
import { knownBuildErrors } from '../knownBuildFailures';

// https://docs.gitlab.com/user/project/integrations/webhook_events/#job-events

let cicdStatsService: CICDStatsService;

export async function handleBuildJobEvent(event: WebhookJobEventSchema) {
	const status = event.build_status;

	cicdStatsService ??= new FirestoreCICDStatsService();

	if (status === 'success' || status === 'failed') {
		const jobInfo: JobResult = {
			buildId: event.build_id,
			status: status,
			startedAt: event.build_started_at!,
			stage: event.build_stage,
			jobName: event.build_name,
			pipeline: event.pipeline_id,
			duration: event.build_duration!,
			project: event.project.path_with_namespace,
			host: envVar('GITLAB_HOST', ''),
		};
		cicdStatsService.saveJobResult(jobInfo).catch((e) => logger.error(e, 'Error saving CICD stats'));
	}

	if (event.build_allow_failure || status === 'success' || status === 'running' || status === 'pending' || status === 'created' || status === 'canceled') {
		return;
	}

	// timeouts?

	// failed script_failure
	// canceled unknown_failure

	if (status !== 'failed') {
		logger.warn(`GitLab webhook unhandled build job status: ${status}`);
		return;
	}

	if (event.build_failure_reason !== 'script_failure') {
		logger.warn(`GitLab build failure reason: ${event.build_failure_reason}`);
	}

	const jobLogs = await new GitLab().getJobLogs(event.project_id, event.build_id);

	let standardResponse = '';
	let logText = '';
	for (const [text, response] of knownBuildErrors()) {
		if (jobLogs.includes(text)) {
			standardResponse = response;
			logText = text;
			break;
		}
	}

	if (standardResponse) {
	}
}
