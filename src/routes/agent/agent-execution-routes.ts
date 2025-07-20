import { serializeContext } from '#agent/agentSerialization';
import { cancelAgent, provideFeedback, resumeCompleted, resumeError, resumeHil } from '#agent/autonomous/autonomousAgentRunner';
import { forceStopAgent } from '#agent/forceStopAgent';
import type { AppFastifyInstance } from '#app/applicationTypes';
import { send, sendBadRequest, sendNotFound } from '#fastify/index';
import { logger } from '#o11y/logger';
import { AGENT_API } from '#shared/agent/agent.api';
import { isExecuting } from '#shared/agent/agent.model';
import { NotAllowed, NotFound } from '#shared/errors';
import { registerApiRoute } from '../routeUtils';

export async function agentExecutionRoutes(fastify: AppFastifyInstance): Promise<void> {
	/** Forcibly stop an agent */
	registerApiRoute(fastify, AGENT_API.forceStop, async (req, reply) => {
		const { agentId } = req.body;
		try {
			// forceStopAgent should ideally handle agent existence/ownership or call a service method that does
			await forceStopAgent(agentId);
			send(reply, 200, null);
		} catch (error) {
			if (error instanceof NotFound) return sendNotFound(reply, error.message);
			if (error instanceof NotAllowed) return send(reply, 403, { error: error.message });
			logger.error(error, `Error force stopping agent ${agentId}`);
			sendBadRequest(reply, 'Error force stopping agent');
		}
	});

	/** Provides feedback to an agent */
	registerApiRoute(fastify, AGENT_API.feedback, async (req, reply) => {
		const { agentId, feedback, executionId } = req.body;

		try {
			// provideFeedback should ideally handle agent existence/ownership or call a service method that does
			await provideFeedback(agentId!, executionId!, feedback!);
			// Load the updated agent to return the state
			const updatedAgent = await fastify.agentStateService.load(agentId!); // load now throws NotFound/NotAllowed
			send(reply, 200, serializeContext(updatedAgent));
		} catch (error) {
			if (error instanceof NotFound) return sendNotFound(reply, error.message);
			if (error instanceof NotAllowed) return send(reply, 403, { error: error.message });
			logger.error('Error providing feedback:', error);
			sendBadRequest(reply, 'Error providing feedback');
		}
	});

	/** Resumes an agent in the error state */
	registerApiRoute(fastify, AGENT_API.resumeError, async (req, reply) => {
		const { agentId, executionId, feedback } = req.body;
		try {
			// resumeError should ideally handle agent existence/ownership or call a service method that does
			await resumeError(agentId!, executionId!, feedback!);
			// Load the updated agent to return the state
			const updatedAgent = await fastify.agentStateService.load(agentId!); // load now throws NotFound/NotAllowed
			send(reply, 200, serializeContext(updatedAgent));
		} catch (error) {
			if (error instanceof NotFound) return sendNotFound(reply, error.message);
			if (error instanceof NotAllowed) return send(reply, 403, { error: error.message });
			logger.error(error, `Error resuming error agent ${agentId}`);
			sendBadRequest(reply, 'Error resuming error agent');
		}
	});

	/** Resumes an agent in the hil (human in the loop) state */
	registerApiRoute(fastify, AGENT_API.resumeHil, async (req, reply) => {
		const { agentId, executionId, feedback } = req.body;
		try {
			// resumeHil should ideally handle agent existence/ownership or call a service method that does
			await resumeHil(agentId!, executionId!, feedback!);
			const updatedAgent = await fastify.agentStateService.load(agentId!); // load now throws NotFound/NotAllowed
			send(reply, 200, serializeContext(updatedAgent));
		} catch (error) {
			if (error instanceof NotFound) return sendNotFound(reply, error.message);
			if (error instanceof NotAllowed) return send(reply, 403, { error: error.message });
			logger.error(error, `Error resuming HIL agent ${agentId}`);
			sendBadRequest(reply, 'Error resuming HIL agent');
		}
	});

	/** Requests a human-in-the-loop check for an agent */
	registerApiRoute(fastify, AGENT_API.requestHil, async (req, reply) => {
		const { agentId, executionId } = req.body;

		try {
			const agent = await fastify.agentStateService.load(agentId!); // load now throws NotFound/NotAllowed

			if (agent.executionId !== executionId)
				return sendBadRequest(reply, `Execution ID mismatch. Agent ${agentId} is currently on execution ${agent.executionId}.`);

			if (agent.hilRequested) {
				logger.info(`HIL check already requested for agent ${agentId}, execution ${executionId}.`);
				// Load again to ensure latest state is returned
				const updatedAgent = await fastify.agentStateService.load(agentId!);
				return send(reply, 200, serializeContext(updatedAgent));
			}

			if (!isExecuting(agent)) return sendBadRequest(reply, `Agent ${agentId} is not in an executing state (${agent.state}). Cannot request HIL check.`);

			await fastify.agentStateService.requestHumanInLoopCheck(agent);

			const updatedAgent = await fastify.agentStateService.load(agentId!);
			send(reply, 200, serializeContext(updatedAgent));
		} catch (error: any) {
			if (error instanceof NotFound) return sendNotFound(reply, error.message);
			if (error instanceof NotAllowed) return send(reply, 403, { error: error.message });
			logger.error({ agentId, executionId, error }, 'Error requesting HIL check [error]');
			sendBadRequest(reply, `Error requesting HIL check: ${error.message || 'Unknown error'}`);
		}
	});

	// Cancels an agent and sets it to the completed state
	registerApiRoute(fastify, AGENT_API.cancel, async (req, reply) => {
		const { agentId, executionId, reason } = req.body;
		try {
			// cancelAgent should ideally handle agent existence/ownership or call a service method that does
			await cancelAgent(agentId!, executionId!, reason!);
			// Load the updated agent to return the state
			const updatedAgent = await fastify.agentStateService.load(agentId!); // load now throws NotFound/NotAllowed
			send(reply, 200, serializeContext(updatedAgent));
		} catch (error) {
			if (error instanceof NotFound) return sendNotFound(reply, error.message);
			if (error instanceof NotAllowed) return send(reply, 403, { error: error.message });
			logger.error(error, `Error cancelling agent ${agentId}`);
			sendBadRequest(reply, 'Error cancelling agent');
		}
	});

	/** Resumes an agent in the completed state */
	registerApiRoute(fastify, AGENT_API.resumeCompleted, async (req, reply) => {
		const { agentId, executionId, instructions } = req.body;

		try {
			await resumeCompleted(agentId!, executionId!, instructions!);
			const updatedAgent = await fastify.agentStateService.load(agentId!); // load now throws NotFound/NotAllowed
			send(reply, 200, serializeContext(updatedAgent));
		} catch (error) {
			if (error instanceof NotFound) return sendNotFound(reply, error.message);
			if (error instanceof NotAllowed) return send(reply, 403, { error: error.message });
			logger.error(error, 'Error resuming completed agent');
			sendBadRequest(reply, 'Error resuming completed agent');
		}
	});

	/** Updates the functions available to an agent */
	registerApiRoute(fastify, AGENT_API.updateFunctions, async (req, reply) => {
		const { agentId, functions } = req.body;

		try {
			await fastify.agentStateService.updateFunctions(agentId!, functions!);
			const updatedAgent = await fastify.agentStateService.load(agentId!); // load now throws NotFound/NotAllowed
			const serialized = serializeContext(updatedAgent);
			reply.sendJSON(serialized);
		} catch (error) {
			if (error instanceof NotFound) return sendNotFound(reply, error.message);
			if (error instanceof NotAllowed) return send(reply, 403, { error: error.message });
			logger.error(error, 'Error updating agent functions [error]');
			sendBadRequest(reply, 'Error updating agent functions');
		}
	});
}
