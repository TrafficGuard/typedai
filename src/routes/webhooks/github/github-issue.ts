import { startAgent } from '#agent/autonomous/autonomousAgentRunner';
import { AgentExecution } from '#agent/autonomous/autonomousAgentRunner';
import { FileSystemTree } from '#agent/autonomous/functions/fileSystemTree';
import { LiveFiles } from '#agent/autonomous/functions/liveFiles';
import { appContext } from '#app/applicationContext';
import { AppFastifyInstance } from '#app/applicationTypes';
import { GitHub } from '#functions/scm/github';
import { FileSystemList } from '#functions/storage/fileSystemList';
import { Perplexity } from '#functions/web/perplexity';
import { logger } from '#o11y/logger';
import { CodeFunctions } from '#swe/codeFunctions';
import { getAgentUser } from '../webhookAgentUser';

export async function handleGitHubIssueEvent(payload: any, fastify: AppFastifyInstance) {
	const repositoryFullName = payload.repository?.full_name || 'unknown repository';
	const issueNumber = payload.issue?.number;
	const issueTitle = payload.issue?.title;
	const issueUrl = payload.issue?.html_url;
	const issueBody = payload.issue?.body;
	const runAsUser = await getAgentUser();

	if (payload.action === 'opened') {
		const initialPrompt = `You are responding to a new GitHub issue in the repository '${repositoryFullName}'.
<issue-title>
${issueTitle}
</issue-title>
<issue-body>
${issueBody}
</issue-body>

Your task is to triage the GitHub issue and respond with an appropriate comment on the issue.
Your note argument to the Agent_completed function will be used to add a comment on the issue.
If you do not feel you should add a comment, you can return an empty string as the note argument and no comment will be added.
If the issue doesn't look valid, for example it looks like spam etc, then complete with an empty string.
If you are stuck with unexpected errors from calling the available functions to do your analysis, then complete with an empty string.

Attempt to identify the root cause of the issue.
If you can identify the cause then attempt to develop a plan to fix the issue using the functions available.
Be thorough in your analysis, and consider various possibilities.
When responding with a plan include links to the relevant files.
If you need more information from the user, you can ask for it.
            `;

		const agentExecution = await startAgent({
			initialPrompt,
			subtype: 'codegen',
			agentName: `GitHub ${repositoryFullName} issue ${issueNumber} opened`,
			type: 'autonomous',
			useSharedRepos: true, // As this is a read-only operation, we can use the shared repos
			metadata: {
				github: {
					repository: repositoryFullName,
				},
			},
			user: runAsUser,
			functions: [LiveFiles, Perplexity, FileSystemTree, FileSystemList, CodeFunctions],
		});

		async function handleAgentCompletion(agentExecution: AgentExecution) {
			await agentExecution.execution;
			const agent = await appContext().agentStateService.load(agentExecution.agentId);
			if (agent.state === 'completed') {
				const note = agent.output;
				try {
					await new GitHub().postCommentOnIssue(repositoryFullName, issueNumber, note);
				} catch (error) {
					logger.error({ error, note }, `Failed to post comment on issue #${issueNumber} in ${repositoryFullName}`);
				}
			} else {
				logger.error(`GitHub issue opened agent ${agentExecution.agentId} did not complete. State: ${agent.state}`);
			}
		}
		// run the agent completion handler in the background
		handleAgentCompletion(agentExecution);
	} else {
		logger.info(
			`GitHub Webhook: Unhandled 'issues' event with action '${payload.action}' for repository '${repositoryFullName}'.${issueNumber ? ` Issue #: ${issueNumber}.` : ''}.`,
		);
	}
}
