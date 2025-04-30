import crypto from 'node:crypto';
import { Type } from '@sinclair/typebox';
import { send, sendBadRequest } from '#fastify/index';
import { logger } from '#o11y/logger';
import type { AppFastifyInstance } from '../../../applicationTypes';

const basePath = '/api/webhooks';

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
			const hmacToken = process.env.JIRA_WEBHOOK_TOKEN;

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
				if (commentBody.includes('@ai ')) {
					// Get issue details
					const issueKey = webhookEvent.issue.key;
					const commentId = webhookEvent.comment.id;
					const authorName = webhookEvent.comment.author.displayName;

					// Initialize your custom workflow here
					// initiateAIWorkflow(issueKey, commentId, commentBody, authorName);
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
