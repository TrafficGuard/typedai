import crypto from 'node:crypto';
import { Type } from '@sinclair/typebox';
import { startAgent } from '#agent/autonomous/autonomousAgentRunner';
import { FileSystemTree } from '#agent/autonomous/functions/fileSystemTree';
import { appContext } from '#app/applicationContext';
import type { AppFastifyInstance } from '#app/applicationTypes';
import { send, sendBadRequest } from '#fastify/index';
import { GoogleCloud } from '#functions/cloud/google/google-cloud';
import { Jira } from '#functions/jira';
import { Git } from '#functions/scm/git';
import { GitLab } from '#functions/scm/gitlab';
import { FileSystemList } from '#functions/storage/fileSystemList';
import { Perplexity } from '#functions/web/perplexity';
import { logger } from '#o11y/logger';
import { CodeEditingAgent } from '#swe/codeEditingAgent';
import { SoftwareDeveloperAgent } from '#swe/softwareDeveloperAgent';

const basePath = '/api/webhooks';

const COMMENT_ACTION = '/@ai ';

export async function jiraRoutes(fastify: AppFastifyInstance) {
	// See https://developer.atlassian.com/server/jira/platform/webhooks/
	fastify.post(
		`${basePath}/jira`,
		{
			schema: {
				body: Type.Any(),
			},
		},
		async (req, reply) => {
			const event = req.body as any;

			const hmacHeader = req.headers['x-hub-signature'];
			logger.debug(`HMAC header ${hmacHeader}`);
			const hmacToken = process.env.JIRA_WEBHOOK_SECRET ?? '';

			const hmac = crypto.createHmac('sha256', hmacToken);
			hmac.update(req.rawBody);
			const digest = `sha256=${hmac.digest('hex')}`;

			if (hmac && digest !== hmacHeader) {
				logger.info('Jira webhook HMAC verification failed');
				return sendBadRequest(reply, 'Verification failed');
			}

			logger.info(event, 'Jira webhook');

			const webhookEvent: any = req.body;

			// Check if this is a comment event
			if (webhookEvent.webhookEvent === 'comment_created') {
				const commentBody = webhookEvent.comment.body;

				// Check if the comment contains our command
				if (commentBody.includes(COMMENT_ACTION)) {
					// Get issue details
					const issueKey = webhookEvent.issue.key;
					const commentId = webhookEvent.comment.id;
					const authorName = webhookEvent.comment.author.displayName;
					const summary = webhookEvent.issue.fields.summary;
					// get the user who made the comment from their email
					const userService = appContext().userService;

					let user = await userService.getUserByEmail(webhookEvent.comment.author.emailAddress);
					if (!user) {
						if (process.env.AUTH === 'google_iap') {
							user = await userService.createUser({ name: authorName, email: webhookEvent.comment.author.emailAddress, enabled: true });
						} else {
							logger.error(`User ${authorName} not found`);
							return sendBadRequest(reply, 'User not found');
						}
					}

					const jira = new Jira();
					const issue = await jira.getJiraDetails(issueKey);

					const prompt = `You (AI agent) have been tagged on a comment on issue: \n ${issue} \n. 
					The comment you have been tagged in is: \n ${commentBody}. \n \n 
					Please take appropriate action based on the comment. If you need additional information or context, please post a comment on the Jira issue.`;

					await startAgent({
						initialPrompt: prompt,
						subtype: 'jira-comment',
						agentName: `Jira ${issueKey} comment (${summary})`,
						type: 'autonomous',
						user,
						functions: [Jira, SoftwareDeveloperAgent, Perplexity, GoogleCloud], // CodeEditingAgent, GitLab, Git, FileSystemTree, FileSystemList,
					});
				}
			}

			/*
             {
                "timestamp"
                "event"
                "user": {
                           --> See User shape in table below
                },
                "issue": {
                           --> See Issue shape in table below
                },
                "changelog" : {
                           --> See Changelog shape in table below
                },
                "comment" : {
                           --> See Comment shape in table below
                }
            }
             */
			// Self is in the format "https://jira.atlassian.com/rest/api/2/issue/10148/comment/252789"
			const self = event.comment.self;
			const commentBody = event.comment.body;

			send(reply, 200);
		},
	);
}
