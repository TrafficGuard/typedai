import { defineApiRoute } from '#shared/api-definitions';
import { ApiNullResponseSchema } from '#shared/common.schema';
import {
	DebateListQuerySchema,
	DebateListSchema,
	DebateParamsSchema,
	DebateResultSchema,
	DebateStateSchema,
	HitlDecisionSchema,
	StartDebateRequestSchema,
} from '#shared/debate/debate.schema';

const DEBATE_BASE = '/api/debate';
const DEBATES_BASE = '/api/debates';

export const DEBATE_API = {
	/**
	 * Start a new debate
	 * Returns the initial debate state
	 */
	start: defineApiRoute('POST', `${DEBATE_BASE}/start`, {
		schema: {
			body: StartDebateRequestSchema,
			response: {
				201: DebateStateSchema,
			},
		},
	}),

	/**
	 * Get a debate by ID
	 */
	getById: defineApiRoute('GET', `${DEBATE_BASE}/:debateId`, {
		schema: {
			params: DebateParamsSchema,
			response: {
				200: DebateStateSchema,
			},
		},
	}),

	/**
	 * List all debates for the current user
	 */
	list: defineApiRoute('GET', DEBATES_BASE, {
		schema: {
			querystring: DebateListQuerySchema,
			response: {
				200: DebateListSchema,
			},
		},
	}),

	/**
	 * Pause an ongoing debate
	 */
	pause: defineApiRoute('POST', `${DEBATE_BASE}/:debateId/pause`, {
		schema: {
			params: DebateParamsSchema,
			response: {
				200: DebateStateSchema,
			},
		},
	}),

	/**
	 * Resume a paused debate
	 */
	resume: defineApiRoute('POST', `${DEBATE_BASE}/:debateId/resume`, {
		schema: {
			params: DebateParamsSchema,
			response: {
				200: DebateStateSchema,
			},
		},
	}),

	/**
	 * Cancel an ongoing debate
	 */
	cancel: defineApiRoute('DELETE', `${DEBATE_BASE}/:debateId`, {
		schema: {
			params: DebateParamsSchema,
			response: {
				204: ApiNullResponseSchema,
			},
		},
	}),

	/**
	 * Submit a HITL (Human-In-The-Loop) decision
	 */
	submitHitl: defineApiRoute('POST', `${DEBATE_BASE}/:debateId/hitl`, {
		schema: {
			params: DebateParamsSchema,
			body: HitlDecisionSchema,
			response: {
				200: DebateStateSchema,
			},
		},
	}),

	/**
	 * Get the result of a completed debate
	 */
	getResult: defineApiRoute('GET', `${DEBATE_BASE}/:debateId/result`, {
		schema: {
			params: DebateParamsSchema,
			response: {
				200: DebateResultSchema,
			},
		},
	}),

	/**
	 * SSE stream endpoint for real-time debate updates
	 * Note: This is a special endpoint that returns an event stream, not JSON
	 * The schema here is just for params validation
	 */
	stream: defineApiRoute('GET', `${DEBATE_BASE}/:debateId/stream`, {
		schema: {
			params: DebateParamsSchema,
		},
	}),
};
