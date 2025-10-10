import { WebhookPipelineEventSchema } from '@gitbeaker/core';
import { GitLab } from '#functions/scm/gitlab';
import { countTokens } from '#llm/tokens';
import { logger } from '#o11y/logger';

/**
 * https://docs.gitlab.com/user/project/integrations/webhook_events/#pipeline-events
 * @param event
 */
export async function handlePipelineEvent(event: WebhookPipelineEventSchema) {
	const pipeline = event.object_attributes;
	const gitRef = pipeline.ref;
	const fullProjectPath = event.project.path_with_namespace;
	const user = event.user;
	const miid = event.merge_request?.iid;
	let failedLogs = '';

	const gitlabId = `${fullProjectPath}:${miid ?? gitRef}`;

	if (pipeline.status === 'success') {
		// check if there is a CodeTask and notify it of a successful build
	} else if (pipeline.status !== 'running') {
		const mergeRequest = event.merge_request; // may be null
		if (mergeRequest) {
			failedLogs = await new GitLab().getMergeRequestPipelineFailedJobLogs(event.project.id, mergeRequest.iid);
			for (const [k, v] of Object.entries(failedLogs)) {
				const lines = v.split('\n').length;
				const tokens = await countTokens(v);
				logger.info(`Failed pipeline job ${k}. Log size: ${tokens} tokens. ${lines} lines.`);
				if (tokens > 50000) {
					// ~50k tokens
					// TODO use flash to reduce the size, or just remove the middle section
				}
			}
		}
	}

	// TODO if this is the first time a job has failed, analyse the logs to see if it looks like it could be a transient timeout failure. If so re-try the job once, otherwise let the failure go through to tne regular processing.

	const summary = {
		project: fullProjectPath,
		gitRef,
		mergeIId: miid,
		user: user,
		status: pipeline.status,
		failedLogs,
	};

	// Need the firestore index
	// const agent = await appContext().agentStateService.findByMetadata('gitlab', gitlabId);

	// TODO could get the project pipeline file,

	// if (!agent) {
	// await startAgent({
	// 	initialPrompt: '',
	// 	subtype: 'gitlab-pipeline',
	// 	agentName: `GitLab ${gitlabId} pipeline`,
	// 	type: 'autonomous',
	// 	functions: [Git, LiveFiles, GitLab, CodeEditingAgent, Perplexity, FileSystemTree, FileSystemList],
	// });
	// }
}
