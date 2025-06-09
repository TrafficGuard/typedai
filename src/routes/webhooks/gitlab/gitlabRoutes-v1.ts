import { Type } from '@sinclair/typebox';
import type { FastifyReply } from 'fastify';
import type { RunWorkflowConfig } from '#agent/autonomous/autonomousAgentRunner';
import { runWorkflowAgent } from '#agent/workflow/workflowAgentRunner';
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
				body: Type.Object({}, { additionalProperties: true }),
			},
		},
		async (req, reply) => {
			logger.debug('/webhooks/gitlab route');
			const event = req.body as any;
			logger.debug('Gitlab webhook %o', event);

			if (event.object_attributes.draft) sendSuccess(reply);

			const userService = appContext().userService;
			let email = (process.env.TYPEDAI_AGENT_EMAIL ?? '').trim();
			if (!email && process.env.AUTH === 'single_user') email = envVar('SINGLE_USER_EMAIL');

			let runAsUser = await userService.getUserByEmail(email);
			if (!runAsUser) {
				logger.info(`Creating TypedAI Agent account with email ${email}`);
				runAsUser = await userService.createUser({ name: 'TypedAI Agent', email, enabled: true });
			}

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

			send(reply, 200);
		},
	);
}
