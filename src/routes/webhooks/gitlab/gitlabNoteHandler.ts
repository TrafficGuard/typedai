import { WebhookBaseNoteEventSchema, WebhookMergeRequestNoteEventSchema } from '@gitbeaker/core';
import { AgentExecution } from '#agent/agentExecutions';
import { getLastFunctionCallArg } from '#agent/autonomous/agentCompletion';
import { startAgent } from '#agent/autonomous/autonomousAgentRunner';
import { Jira } from '#functions/jira';
import { LlmTools } from '#functions/llmTools';
import { GitLab } from '#functions/scm/gitlab';
import { SupportKnowledgebase } from '#functions/supportKnowledgebase';
import { Perplexity } from '#functions/web/perplexity';
import { PublicWeb } from '#functions/web/web';
import { defaultLLMs } from '#llm/services/defaultLlms';
import { logger } from '#o11y/logger';
import { AgentCompleted, AgentContext } from '#shared/agent/agent.model';
import { LiveFiles } from '#agent/autonomous/functions/liveFiles';
import { FileSystemTree } from '#agent/autonomous/functions/fileSystemTree';

const AGENT_TAG = '@typedai';

async function findDiscussionIdByNoteId(projectId: string | number, mrIid: number, noteId: number): Promise<string | null> {
	const discussions = await new GitLab().api().MergeRequestDiscussions.all(projectId, mrIid);
	for (const d of discussions) {
		if (d.notes?.some((n: any) => n.id === noteId)) return d.id as string;
	}
	return null;
}

export class GitLabNoteCompletedHandler implements AgentCompleted {
	agentCompletedHandlerId(): string {
		return 'gitlab-note';
	}
	async notifyCompleted(agent: AgentContext): Promise<void> {
		let message = '';
		switch (agent.state) {
			case 'error':
				message = `Sorry, I'm having unexpected difficulties providing a response to your request`;
				break;
			case 'hitl_threshold':
				message = `Apologies, I've been unable to produce a response with the resources I've been allocated to spend on the request`;
				break;
			case 'hitl_feedback':
			case 'completed':
				message = getLastFunctionCallArg(agent);
				break;
			default:
				message = `Sorry, I'm unable to provide a response to your request`;
		}
		if (!message || !message.trim()) return;

		const gitlabMeta = agent.metadata.gitlab;

		try {
			await new GitLab()
				.api()
				.MergeRequestDiscussions.addNote(gitlabMeta.projectId, gitlabMeta.mergeRequestIid, gitlabMeta.discussionId, gitlabMeta.inReplyToNoteId, message);
		} catch (e) {
			logger.error(e, `Failed to post MR note for project ${gitlabMeta.projectId}, MR !${gitlabMeta.mergeRequestIid}`);
		}
	}
}

// Need to get url added into the gitbeaker type
export type MergeRequestNoteEvent = WebhookMergeRequestNoteEventSchema & { merge_request: { url: string } } & {
	object_attributes: { discussion_id: string | null; description: string };
};

export async function handleMergeRequestNoteEvent(event: MergeRequestNoteEvent): Promise<AgentExecution | null> {
	const note = event.object_attributes;
	const noteText = note.note ?? note.description;
	// Only action if the AI agent has been tagged
	if (!noteText.includes(AGENT_TAG)) return null;

	const project = event.project;
	const user = event.user;
	const userName = user.name ?? user.username ?? '<unknown-user>';
	const mergeRequest = event.merge_request;

	const discussionId: string | undefined =
		event.object_attributes.discussion_id ?? (await findDiscussionIdByNoteId(project.id, mergeRequest.iid, note.id)) ?? undefined;

	const mergeRequestDetails = `Project: ${project.path_with_namespace}\nTitle: ${mergeRequest.title}\nSource branch: ${mergeRequest.source_branch}\nTarget branch: ${mergeRequest.target_branch}`;

	const supportFuncs = new SupportKnowledgebase();
	const coreDocs = await supportFuncs.getCoreDocumentation().catch(() => '');

	const diffs = await new GitLab().getMergeRequestDiffs(project.id, mergeRequest.iid);

	// See if the source branch has a Jira Id in the start of the name, or start after a slash (e.g ABC-123-branch-descrption, feature/PROJ-5594-new-feature)
	const jiraId = mergeRequest.source_branch.match(/^(\w+-\d+)(?:\/|$)/)?.[1];
	let jiraDetails: string | undefined;
	if (jiraId) {
		try {
			jiraDetails = await new Jira().getJiraDetails(jiraId);
		} catch (e) {
			logger.error(e, `Failed to get Jira details for ${jiraId} from branch ${mergeRequest.source_branch}`);
		}
	}

	const systemPrompt =
		'You are an AI support agent. You are responding to message your are tagged in on a GitLab Merge Request. ' +
		'Respond in a helpful, concise manner. If you encounter an error responding to the request, do not provide details; ' +
		'respond with: "Sorry, I\'m having difficulties providing a response to your request".';

	const initialPrompt = [
		`You are an AI support agent (${AGENT_TAG} is your username tag) responding to a GitLab Merge Request comment.`,
		`Comment by user: ${userName}${user?.username ? ` (@${user.username})` : ''}`,
		`GitLab Project: ${project.path_with_namespace}`,
		`MR IID: ${mergeRequest.iid}`,
		'',
		'Request:',
		noteText,
		'',
		'Use the available tools (GitLab, Jira, web search) as needed to answer accurately and concisely. Respond professionally and to the point',
	].join('\n');

	const initialMemory = {
		'support-knowledgebase-core-documentation': coreDocs,
		'mr-discussion-id': discussionId!,
		'merge-request-details': mergeRequestDetails,
		'merge-request-diff': diffs,
	};
	if (jiraDetails) {
		initialMemory['jira-details'] = jiraDetails;
	}

	try {
		const exec = await startAgent({
			type: 'autonomous',
			subtype: 'codegen',
			agentName: `GitLab MR !${mergeRequest.iid} - ${project.path_with_namespace}`,
			initialPrompt,
			llms: defaultLLMs(),
			functions: [GitLab, Jira, Perplexity, PublicWeb, LlmTools, SupportKnowledgebase, LiveFiles, FileSystemTree],
			systemPrompt,
			metadata: {
				gitlab: {
					projectId: project.id,
					projectPath: project.path_with_namespace,
					mergeRequestIid: mergeRequest.iid,
					branch: mergeRequest.source_branch,
					discussionId,
					noteId: note.id,
					webUrl: mergeRequest.url,
				},
			},
			completedHandler: new GitLabNoteCompletedHandler(),
			useSharedRepos: true,
			humanInLoop: {
				budget: 5,
				count: 15,
			},
			initialMemory,
		});

		// Do not await exec.execution to avoid blocking webhook response; completion will post back via handler
		logger.info({ agentId: exec.agentId }, `Started GitLab MR support agent for !${mergeRequest.iid}`);
		return exec;
	} catch (e) {
		logger.error(e, `Failed to start GitLab MR support agent for project ${project.id}, MR !${mergeRequest.iid}`);
		return null;
	}
}
