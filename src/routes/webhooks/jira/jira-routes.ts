import { Type } from '@sinclair/typebox';
import { send } from '#fastify/index';
import { logger } from '#o11y/logger';
import { AppFastifyInstance } from '../../../applicationTypes';

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
			logger.info('Jira webhook %o', event);

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
