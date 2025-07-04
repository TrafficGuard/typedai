import { Type } from '@sinclair/typebox';
import type { FastifyReply } from 'fastify';
import { type RunWorkflowConfig, startAgent } from '#agent/autonomous/autonomousAgentRunner';
import { FileSystemTree } from '#agent/autonomous/functions/fileSystemTree';
import { LiveFiles } from '#agent/autonomous/functions/liveFiles';
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
import { logger } from '#o11y/logger';
import { CodeEditingAgent } from '#swe/codeEditingAgent';
import { envVar } from '#utils/env-var';
import { envVarHumanInLoopSettings } from '../../../cli/cliHumanInLoop';

const basePath = '/api/webhooks';

/**
 * https://docs.gitlab.com/user/project/integrations/webhook_events/#pipeline-events
 * @param event
 */
async function handlePipelineEvent(event: any) {
	const runAsUser = await getGitLabAgentUser();
	const gitRef = event.ref;
	const fullProjectPath = event.project.path_with_namespace;
	const user = event.user;
	const miid = event.merge_request?.iid;
	let failedLogs: Record<string, string>;

	const gitlabId = `${fullProjectPath}:${miid ?? gitRef}`;

	if (event.status === 'success') {
		// check if there is a CodeTask and notify it of a successful build
	} else {
		failedLogs = await new GitLab().getFailedJobLogs(event.project.id, event.iid);
		for (const [k, v] of Object.entries(failedLogs)) {
			if (v.length > 200000) {
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

	const agent = await appContext().agentStateService.findByMetadata('gitlab', gitlabId);

	// TODO could get the project pipeline file,

	if (!agent) {
		await startAgent({
			initialPrompt: '',
			subtype: 'pipeline',
			agentName: `GitLab ${gitlabId} pipeline`,
			type: 'autonomous',
			user: runAsUser,
			functions: [Git, LiveFiles, GitLab, CodeEditingAgent, Perplexity, FileSystemTree, FileSystemList],
		});
	}
}

async function getGitLabAgentUser() {
	const userService = appContext().userService;
	let email = (process.env.TYPEDAI_AGENT_EMAIL ?? '').trim();
	if (!email && process.env.AUTH === 'single_user') email = envVar('SINGLE_USER_EMAIL');

	let runAsUser = await userService.getUserByEmail(email);
	if (!runAsUser) {
		logger.info(`Creating TypedAI Agent account with email ${email}`);
		runAsUser = await userService.createUser({ name: 'TypedAI Agent', email, enabled: true });
	}
	return runAsUser;
}

/**
 *
 * @param event
 */
async function handleMergeRequestEvent(event: any) {
	if (event.object_attributes.draft) return;

	const runAsUser = await getGitLabAgentUser();

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

export async function gitlabRoutes(fastify: AppFastifyInstance) {
	fastify.get(`${basePath}/test`, {}, async (req, reply) => {
		send(reply as FastifyReply, 200, { message: 'ok' });
	});

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

			switch (event.kind) {
				case 'pipeline':
					await handlePipelineEvent(event);
					break;
				case 'merge_request':
					await handleMergeRequestEvent(event);
					break;
			}

			send(reply, 200);
		},
	);
}
