import { defineApiRoute } from '#shared/api-definitions';
import { SlackActionResponseSchema, SlackStatusResponseSchema } from './slack.schema';

const SLACK_API_BASE = '/api/slack';

export const SLACK_API = {
	status: defineApiRoute('GET', `${SLACK_API_BASE}/status`, {
		schema: { response: { 200: SlackStatusResponseSchema } },
	}),
	start: defineApiRoute('POST', `${SLACK_API_BASE}/start`, {
		schema: { response: { 200: SlackActionResponseSchema } },
	}),
	stop: defineApiRoute('POST', `${SLACK_API_BASE}/stop`, {
		schema: { response: { 200: SlackActionResponseSchema } },
	}),
};
