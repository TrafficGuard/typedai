import { DiscussionSchema, Gitlab, WebhookBaseNoteEventSchema, WebhookMergeRequestNoteEventSchema } from '@gitbeaker/core';
import { AgentExecution } from '#agent/agentExecutions';
import { getLastFunctionCallArg } from '#agent/autonomous/agentCompletion';
import { startAgent } from '#agent/autonomous/autonomousAgentRunner';
import { AGENT_COMPLETED_NAME } from '#agent/autonomous/functions/agentFunctions';
import { FileSystemTree } from '#agent/autonomous/functions/fileSystemTree';
import { LiveFiles } from '#agent/autonomous/functions/liveFiles';
import { Jira } from '#functions/jira';
import { LlmTools } from '#functions/llmTools';
import { GitLab } from '#functions/scm/gitlab';
import { SupportKnowledgebase } from '#functions/supportKnowledgebase';
import { Perplexity } from '#functions/web/perplexity';
import { PublicWeb } from '#functions/web/web';
import { defaultLLMs } from '#llm/services/defaultLlms';
import { logger } from '#o11y/logger';
import { AgentCompleted, AgentContext } from '#shared/agent/agent.model';

const AGENT_USERNAME = process.env.GITLAB_AGENT_USERNAME || 'typedai';
const AGENT_TAG = `@${AGENT_USERNAME}`;

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
	const gitlab = new GitLab();
	const project = event.project;
	const user = event.user;
	const userName = user.name ?? user.username ?? '<unknown-user>';
	const mergeRequest = event.merge_request;

	const discussionId: string | undefined =
		event.object_attributes.discussion_id ?? (await gitlab.findDiscussionIdByNoteId(project.id, mergeRequest.iid, note.id))?.id ?? undefined;
	let agentTaggedInDiscussion = false;
	let agentTaggedInNoted = false;

	let discussionText = '';

	const discussion: DiscussionSchema | null = await gitlab.findDiscussionIdByNoteId(project.id, mergeRequest.iid, note.id);
	if (discussion) {
		// Don't process notes that the agent posted
		if (discussion.notes?.at(-1)?.author.username === AGENT_USERNAME) {
			logger.info(`Not processing note ${note.id} as it was posted by the agent`);
			return null;
		}
		discussionText = '<discussion>';
		for (const note of discussion.notes ?? []) {
			if (note.body.includes(AGENT_TAG)) {
				agentTaggedInDiscussion = true;
			}
			discussionText += `\n<discussion:comment authorUsername="${note.author.username}" authorName="${note.author.name}">\n${note.body}\n</discussion:comment>`;
		}
		discussionText += '\n</discussion>';
	}
	if (noteText?.includes(AGENT_TAG)) {
		agentTaggedInNoted = true;
	}

	// Only action if the AI agent has been tagged in the discussion or the note
	if (!agentTaggedInDiscussion && !agentTaggedInNoted) {
		logger.info(`Not processing note ${note.id} as the agent was not tagged in the discussion or note`);
		return null;
	}

	const mergeRequestDetails = `Project: ${project.path_with_namespace}\nTitle: ${mergeRequest.title}\nSource branch: ${mergeRequest.source_branch}\nTarget branch: ${mergeRequest.target_branch}`;

	const supportFuncs = new SupportKnowledgebase();
	const coreDocs = await supportFuncs.getCoreDocumentation().catch(() => '');

	const diffs = await gitlab.getMergeRequestDiffs(project.id, mergeRequest.iid);

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
		'Respond in a helpful, concise manner. If you encounter an persistant error calling tools to complete your response to the request, do not provide details; ' +
		'respond with what useful information you have discovered so far along with a comment like: "Sorry, I\'m encountering errors trying to provide a complete response to your request". ' +
		'Only assist with requests directly relevant to the Merge Request, and decline to assist with requests that are not relevant to the Merge Request.';

	const initialPromptLines = [
		`You are an AI support agent (${AGENT_TAG} is your username tag) responding to a GitLab Merge Request comment.`,
		`Comment by user: ${userName}${user?.username ? ` (@${user.username})` : ''}`,
		`GitLab Project: ${project.path_with_namespace}`,
		`MR IID: ${mergeRequest.iid}`,
		'',
		'Discussion:',
		discussionText || noteText,
		'',
		'Use the available tools (GitLab, Jira, web search) as needed to answer accurately and concisely. Do not make any changes to the repository, only respond professionally and to the point',
		`The value passed to the ${AGENT_COMPLETED_NAME} function will be the comment posted to the discussion.`,
	];
	if (!agentTaggedInNoted) {
		initialPromptLines.push(
			'You have previously been tagged or commented in the discussion, however you are not tagged in this latest comment. If you think that the user does not need a response from you then call the completed function with an empty string.',
		);
	}
	const initialPrompt = initialPromptLines.join('\n');

	const initialMemory = {
		'support-knowledgebase-core-documentation': coreDocs,
		'merge-request-iid': mergeRequest.iid?.toString() ?? '',
		'merge-request-discussion-id': discussionId?.toString() ?? '',
		'merge-request-details': mergeRequestDetails,
		'merge-request-diff': diffs,
	};
	if (jiraDetails) {
		initialMemory['jira-details'] = jiraDetails;
	}

	logger.info({ initialMemory, initialPrompt, mrIId: mergeRequest.iid, project: project.path_with_namespace }, 'Starting agent for MR note');

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
					mergeRequestIid: mergeRequest.iid?.toString() ?? '',
					branch: mergeRequest.source_branch,
					discussionId: discussion?.id?.toString() ?? '',
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
