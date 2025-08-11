import { Type } from '@sinclair/typebox';
import type { FastifyReply } from 'fastify';
import { startAgent } from '#agent/autonomous/autonomousAgentRunner';
import { FileSystemTree } from '#agent/autonomous/functions/fileSystemTree';
import { LiveFiles } from '#agent/autonomous/functions/liveFiles';
import { type RunWorkflowConfig } from '#agent/autonomous/runAgentTypes';
import { runWorkflowAgent } from '#agent/workflow/workflowAgentRunner';
import { appContext } from '#app/applicationContext';
import type { AppFastifyInstance } from '#app/applicationTypes';
import { send, sendSuccess } from '#fastify/index';
import { Git } from '#functions/scm/git';
import { GitLab } from '#functions/scm/gitlab';
import { GitLabCodeReview } from '#functions/scm/gitlabCodeReview';
import { FileSystemList } from '#functions/storage/fileSystemList';
import { Perplexity } from '#functions/web/perplexity';
import { defaultLLMs } from '#llm/services/defaultLlms';
import { countTokens } from '#llm/tokens';
import { logger } from '#o11y/logger';
import { CodeEditingAgent } from '#swe/codeEditingAgent';
import { runAsUser } from '#user/userContext';
import { envVar } from '#utils/env-var';
import { envVarHumanInLoopSettings } from '../../../cli/cliHumanInLoop';
import { getAgentUser } from '../webhookAgentUser';

const basePath = '/api/webhooks';

export async function gitlabRoutes(fastify: AppFastifyInstance): Promise<void> {
	fastify.get(`${basePath}/test`, {}, async (req, reply) => {
		send(reply as FastifyReply, 200, { message: 'ok' });
	});

	// See https://docs.gitlab.com/ee/user/project/integrations/webhook_events.html#merge-request-events
	fastify.post(`${basePath}/gitlab`, { schema: { body: Type.Object({}, { additionalProperties: true }) } }, async (req, reply) => {
		const event = req.body as any;
		const objectKind = event.object_kind;
		logger.info(event, `Gitlab webhook ${objectKind}`);

		const user = await getAgentUser();
		runAsUser(user, async () => {
			switch (objectKind) {
				case 'pipeline':
					await handlePipelineEvent(event);
					break;
				case 'merge_request':
					await handleMergeRequestEvent(event);
					break;
			}
		});

		send(reply, 200);
	});
}

/**
 * https://docs.gitlab.com/user/project/integrations/webhook_events/#pipeline-events
 * @param event
 */
async function handlePipelineEvent(event: any) {
	const gitRef = event.ref;
	const fullProjectPath = event.project.path_with_namespace;
	const user = event.user;
	const miid = event.merge_request?.iid;
	let failedLogs: Record<string, string>;

	const gitlabId = `${fullProjectPath}:${miid ?? gitRef}`;

	if (event.status === 'success') {
		// check if there is a CodeTask and notify it of a successful build
	} else {
		failedLogs = await new GitLab().getFailedJobLogs(event.project.id, event.object_attributes.iid);
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

	// TODO if this is the first time a job has failed, analyse the logs to see if it looks like it could be a transient timeout failure. If so re-try the job once, otherwise let the failure go through to tne regular processing.

	const summary = {
		project: fullProjectPath,
		gitRef,
		mergeIId: miid,
		user: user,
		status: event.status,
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

/**
 *
 * @param event
 */
async function handleMergeRequestEvent(event: any) {
	if (event.object_attributes?.draft) return;

	const runAsUser = await getAgentUser();

	// Code review agent

	const config: RunWorkflowConfig = {
		subtype: 'gitlab-review',
		agentName: `MR review - ${event.object_attributes.title}`,
		llms: defaultLLMs(),
		user: runAsUser,
		initialPrompt: '',
		humanInLoop: envVarHumanInLoopSettings(),
	};

	const mergeRequestId = `project:${event.project.name}, miid:${event.object_attributes.iid}, MR:"${event.object_attributes.title}"`;

	await runWorkflowAgent(config, async (context) => {
		logger.info(`Agent ${context.agentId} reviewing merge request ${mergeRequestId}`);
		return new GitLabCodeReview()
			.reviewMergeRequest(event.project.id, event.object_attributes.iid)
			.then(() => {
				logger.debug(`Competed review of merge request ${mergeRequestId}`);
			})
			.catch((error) => logger.error(error, `Error reviewing merge request ${mergeRequestId}. Message: ${error.message} [error]`));
	});
}
