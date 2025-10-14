import {
	WebhookBaseNoteEventSchema,
	WebhookJobEventSchema,
	WebhookMergeRequestEventSchema,
	WebhookMergeRequestNoteEventSchema,
	WebhookPipelineEventSchema,
} from '@gitbeaker/core';
import { Type } from '@sinclair/typebox';
import type { FastifyReply } from 'fastify';
import { startAgent } from '#agent/autonomous/autonomousAgentRunner';
import { FileSystemTree } from '#agent/autonomous/functions/fileSystemTree';
import { LiveFiles } from '#agent/autonomous/functions/liveFiles';
import { type RunWorkflowConfig } from '#agent/autonomous/runAgentTypes';
import { runWorkflowAgent } from '#agent/workflow/workflowAgentRunner';
import type { AppFastifyInstance } from '#app/applicationTypes';
import { send, sendSuccess } from '#fastify/index';
import { GitLab } from '#functions/scm/gitlab';
import { GitLabCodeReview } from '#functions/scm/gitlabCodeReview';
import { defaultLLMs } from '#llm/services/defaultLlms';
import { countTokens } from '#llm/tokens';
import { logger } from '#o11y/logger';
import { withSpan } from '#o11y/trace';
import { CodeEditingAgent } from '#swe/codeEditingAgent';
import { runAsUser } from '#user/userContext';
import { envVarHumanInLoopSettings } from '../../../cli/cliHumanInLoop';
import { getAgentUser } from '../webhookAgentUser';
import { handleBuildJobEvent } from './gitlabJobHandler';
import { MergeRequestNoteEvent, handleMergeRequestNoteEvent } from './gitlabNoteHandler';
import { handlePipelineEvent } from './gitlabPipelineHandler';

const basePath = '/api/webhooks';

export async function gitlabRoutes(fastify: AppFastifyInstance): Promise<void> {
	fastify.get(`${basePath}/test`, {}, async (req, reply) => {
		send(reply as FastifyReply, 200, { message: 'ok' });
	});

	// See https://docs.gitlab.com/ee/user/project/integrations/webhook_events.html#merge-request-events
	fastify.post(`${basePath}/gitlab`, { schema: { body: Type.Object({}, { additionalProperties: true }) } }, async (req, reply) => {
		const event = req.body as any;
		const objectKind = event.object_kind;
		logger.info({ event }, `Gitlab webhook ${objectKind}`);

		await withSpan('gitlab-webhook', async () => {
			const user = await getAgentUser();
			runAsUser(user, async () => {
				switch (objectKind) {
					case 'build':
						await handleBuildJobEvent(event as WebhookJobEventSchema);
						break;
					case 'pipeline':
						await handlePipelineEvent(event as WebhookPipelineEventSchema);
						break;
					case 'merge_request':
						await handleMergeRequestEvent(event as WebhookMergeRequestEventSchema);
						break;
					case 'note':
						if (event.merge_request) await handleMergeRequestNoteEvent(event as MergeRequestNoteEvent);
						break;
				}
			});
			send(reply, 200);
		});
	});
}

/**
 *
 * @param event
 */
async function handleMergeRequestEvent(event: any) {
	if (event.object_attributes?.draft) return;

	// If the MR is approved and there are unchecked checkboxes, then add a comment to the MR to ask for the checkboxes to be checked
	// if (event.object_attributes.state === 'approved' && hasUnchecked(event.object_attributes.description)) {
	// 	await new GitLab().addComment(event.project.id, event.object_attributes.iid, 'Please check the task list checkboxes');
	// }

	const mergeRequestId = `project:${event.project.name}, miid:${event.object_attributes.iid}, MR:"${event.object_attributes.title}"`;
	const gitlabCodeReview = new GitLabCodeReview();

	const codeReviewTasks = await gitlabCodeReview.createMergeRequestReviewTasks(event.project.id, event.object_attributes.iid);

	if (!codeReviewTasks.length) return;

	// Start the code review agent
	const runAsUser = await getAgentUser();

	const config: RunWorkflowConfig = {
		subtype: 'gitlab-review',
		agentName: `MR review - ${event.object_attributes.title}`,
		llms: defaultLLMs(),
		user: runAsUser,
		initialPrompt: '',
		humanInLoop: envVarHumanInLoopSettings(),
	};

	await runWorkflowAgent(config, async (context) => {
		logger.info(`Agent ${context.agentId} reviewing merge request ${mergeRequestId}`);
		return gitlabCodeReview
			.processMergeRequestCodeReviewTasks(event.project.id, event.object_attributes.iid, codeReviewTasks)
			.then(() => {
				logger.debug(`Competed review of merge request ${mergeRequestId}`);
			})
			.catch((error) => logger.error(error, `Error reviewing merge request ${mergeRequestId}. Message: ${error.message} [error]`));
	});
}

const CHECKBOXES_START = '<!-- required-checkboxes-start -->';
const CHECKBOXES_END = '<!-- required-checkboxes-end -->';

/**
 * Checks if the MR description contains unchecked checkboxes
 * @param description
 * @returns
 */
export function hasUnchecked(description: string): boolean {
	if (!description) return false;
	const regexp = new RegExp(`${CHECKBOXES_START}((\\s|\\S)*?)${CHECKBOXES_END}`, 'gs');
	const matches: string[] = [];
	let match: RegExpExecArray | null = null;

	// biome-ignore lint/suspicious/noAssignInExpressions: ignore
	while ((match = regexp.exec(description)) !== null) matches.push(`${match[1]}`);

	if (matches.length) return matches.some((el) => hasUnchecked(el));

	return description.includes('[ ]');
}
