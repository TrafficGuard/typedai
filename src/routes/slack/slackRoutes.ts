import type { AppFastifyInstance } from '#app/applicationTypes';
import { sendBadRequest, sendServerError } from '#fastify/responses';
import { SlackChatBotService } from '#modules/slack/slackChatBotService';
import { slackConfig } from '#modules/slack/slackConfig';
import { logger } from '#o11y/logger';
import { registerApiRoute } from '#routes/routeUtils';
import { SLACK_API } from '#shared/slack/slack.api';

const slackChatBotService = new SlackChatBotService();

export async function slackRoutes(fastify: AppFastifyInstance): Promise<void> {
	registerApiRoute(fastify, SLACK_API.status, async (_req, reply) => {
		return reply.sendJSON({ status: slackChatBotService.status });
	});

	registerApiRoute(fastify, SLACK_API.start, async (_req, reply) => {
		if (!slackConfig().socketMode) return sendBadRequest(reply, 'Slack chatbot is not configured to use socket mode');
		try {
			await slackChatBotService.initSlack(true);
			return reply.sendJSON({ success: true });
		} catch (error) {
			logger.error(error, 'Failed to start Slack chatbot [error]');
			return sendServerError(reply, 'Failed to start Slack chatbot');
		}
	});

	registerApiRoute(fastify, SLACK_API.stop, async (_req, reply) => {
		try {
			await slackChatBotService.shutdown();
			return reply.sendJSON({ success: true });
		} catch (error) {
			logger.error(error, 'Failed to stop Slack chatbot [error]');
			return sendServerError(reply, 'Failed to stop Slack chatbot');
		}
	});

	if (slackConfig().autoStart && slackConfig().socketMode) {
		try {
			await slackChatBotService.initSlack();
		} catch (error) {
			logger.error(error, 'Failed to auto-start Slack chatbot [error]');
		}
	}
}
