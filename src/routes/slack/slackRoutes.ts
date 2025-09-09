import { Type } from '@sinclair/typebox';
import type { FastifyReply } from 'fastify';
import type { AppFastifyInstance } from '#app/applicationTypes';
import { send, sendSuccess } from '#fastify/index';
import { SlackChatBotService } from '#modules/slack/slackChatBotService';

const basePath = '/api/slack';

const slackChatBotService = new SlackChatBotService();

export async function slackRoutes(fastify: AppFastifyInstance): Promise<void> {
	fastify.get(`${basePath}/status`, {}, async (req, reply) => {
		send(reply as FastifyReply, 200, { message: 'ok' });
	});

	fastify.get(`${basePath}/start`, {}, async (req, reply) => {
		send(reply as FastifyReply, 200, { message: 'ok' });
	});

	fastify.get(`${basePath}/stop`, {}, async (req, reply) => {
		send(reply as FastifyReply, 200, { message: 'ok' });
	});
}
