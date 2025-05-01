import { Type } from '@sinclair/typebox';
import type { FastifyReply } from 'fastify';
import { RunAgentConfig, type RunWorkflowConfig } from '#agent/agentRunner';
import { runAgentWorkflow } from '#agent/agentWorkflowRunner';
import { appContext } from '#app/applicationContext';
import type { AppFastifyInstance } from '#app/applicationTypes';
import { send, sendSuccess } from '#fastify/index';
import { GitLabCodeReview } from '#functions/scm/gitlabCodeReview';
import { defaultLLMs } from '#llm/services/defaultLlms';
import { logger } from '#o11y/logger';
import { envVar } from '#utils/env-var';
import { envVarHumanInLoopSettings } from '../../../cli/cliHumanInLoop';

const basePath = '/api/webhooks';

export async function gitlabRoutesV1(fastify: AppFastifyInstance) {
	fastify.get(`${basePath}/test`, {}, async (req, reply) => {
		send(reply as FastifyReply, 200, { message: 'ok' });
	});

	// /get
	// See https://docs.gitlab.com/ee/user/project/integrations/webhook_events.html#merge-request-events
	fastify.post(
		`${basePath}/gitlab`,
		{
			schema: {
				body: Type.Any(),
			},
		},
		async (req, reply) => {
			logger.debug('/webhooks/gitlab route');
			const event = req.body as any;
			logger.debug('Gitlab webhook %o', event);

			if (event.object_attributes.draft) sendSuccess(reply);

			const runAsUser = await appContext().userService.getUserByEmail(envVar('GITLAB_REVIEW_USER_EMAIL'));
			if (!runAsUser) throw new Error(`Could not find user from env var GITLAB_REVIEW_USER_EMAIL with value ${envVar('GITLAB_REVIEW_USER_EMAIL')}`);

			const config: RunWorkflowConfig = {
				subtype: 'gitlab-review',
				agentName: `MR review - ${event.object_attributes.title}`,
				llms: defaultLLMs(),
				user: runAsUser,
				initialPrompt: '',
				humanInLoop: envVarHumanInLoopSettings(),
			};

			const mergeRequestId = `project:${event.project.name}, miid:${event.object_attributes.iid}, MR:"${event.object_attributes.title}"`;

			await runAgentWorkflow(config, async (context) => {
				logger.info(`Agent ${context.agentId} reviewing merge request ${mergeRequestId}`);
				return new GitLabCodeReview()
					.reviewMergeRequest(event.project.id, event.object_attributes.iid)
					.then(() => {
						logger.debug(`Competed review of merge request ${mergeRequestId}`);
					})
					.catch((error) => logger.error(error, `Error reviewing merge request ${mergeRequestId}. Message: ${error.message} [error]`));
			});

			send(reply, 200);
		},
	);
}
