import type { Static } from '@sinclair/typebox';
import { LlmFunctionsImpl } from '#agent/LlmFunctionsImpl';
import { serializeContext } from '#agent/agentSerialization';
import { cancelAgent, provideFeedback, resumeCompleted, resumeError, resumeHil } from '#agent/autonomous/autonomousAgentRunner';
import { forceStopAgent } from '#agent/forceStopAgent';
import type { AppFastifyInstance } from '#app/applicationTypes';
import { send, sendBadRequest, sendNotFound } from '#fastify/index'; // Added sendNotFound
import { functionFactory } from '#functionSchema/functionDecorators';
import { logger } from '#o11y/logger';
import { AGENT_API } from '#shared/agent/agent.api';
import { isExecuting } from '#shared/agent/agent.model';
import { NotAllowed, NotFound } from '#shared/errors'; // Added import

export async function agentExecutionRoutes(fastify: AppFastifyInstance) {
	/** Forcibly stop an agent */
	fastify.post(
		AGENT_API.forceStop.pathTemplate,
		{
			schema: AGENT_API.forceStop.schema,
		},
		async (req, reply) => {
			const { agentId } = req.body;
			try {
				// forceStopAgent should ideally handle agent existence/ownership or call a service method that does
				await forceStopAgent(agentId);
				send(reply, 200, null);
			} catch (error) {
				// forceStopAgent might throw if agent not found or not owned
				if (error instanceof NotFound) {
					return sendNotFound(reply, error.message);
				}
				if (error instanceof NotAllowed) {
					return send(reply, 403, { error: error.message });
				}
				logger.error(error, `Error force stopping agent ${agentId}`);
				sendBadRequest(reply, 'Error force stopping agent');
			}
		},
	);

	/** Provides feedback to an agent */
	fastify.post(
		AGENT_API.feedback.pathTemplate,
		{
			schema: AGENT_API.feedback.schema,
		},
		async (req, reply) => {
			const { agentId, feedback, executionId } = req.body;

			try {
				// provideFeedback should ideally handle agent existence/ownership or call a service method that does
				await provideFeedback(agentId!, executionId!, feedback!);
				// Load the updated agent to return the state
				const updatedAgent = await fastify.agentStateService.load(agentId!); // load now throws NotFound/NotAllowed
				send(reply, 200, serializeContext(updatedAgent));
			} catch (error) {
				if (error instanceof NotFound) {
					return sendNotFound(reply, error.message);
				}
				if (error instanceof NotAllowed) {
					return send(reply, 403, { error: error.message });
				}
				logger.error('Error providing feedback:', error);
				sendBadRequest(reply, 'Error providing feedback');
			}
		},
	);

	/** Resumes an agent in the error state */
	fastify.post(
		AGENT_API.resumeError.pathTemplate,
		{
			schema: AGENT_API.resumeError.schema,
		},
		async (req, reply) => {
			const { agentId, executionId, feedback } = req.body;
			try {
				// resumeError should ideally handle agent existence/ownership or call a service method that does
				await resumeError(agentId!, executionId!, feedback!);
				// Load the updated agent to return the state
				const updatedAgent = await fastify.agentStateService.load(agentId!); // load now throws NotFound/NotAllowed
				send(reply, 200, serializeContext(updatedAgent));
			} catch (error) {
				if (error instanceof NotFound) {
					return sendNotFound(reply, error.message);
				}
				if (error instanceof NotAllowed) {
					return send(reply, 403, { error: error.message });
				}
				logger.error(error, `Error resuming error agent ${agentId}`);
				sendBadRequest(reply, 'Error resuming error agent');
			}
		},
	);

	/** Resumes an agent in the hil (human in the loop) state */
	fastify.post(
		AGENT_API.resumeHil.pathTemplate,
		{
			schema: AGENT_API.resumeHil.schema,
		},
		async (req, reply) => {
			const { agentId, executionId, feedback } = req.body;
			try {
				// resumeHil should ideally handle agent existence/ownership or call a service method that does
				await resumeHil(agentId!, executionId!, feedback!);
				// Load the updated agent to return the state
				const updatedAgent = await fastify.agentStateService.load(agentId!); // load now throws NotFound/NotAllowed
				send(reply, 200, serializeContext(updatedAgent));
			} catch (error) {
				if (error instanceof NotFound) {
					return sendNotFound(reply, error.message);
				}
				if (error instanceof NotAllowed) {
					return send(reply, 403, { error: error.message });
				}
				logger.error(error, `Error resuming HIL agent ${agentId}`);
				sendBadRequest(reply, 'Error resuming HIL agent');
			}
		},
	);

	/** Requests a human-in-the-loop check for an agent */
	fastify.post(
		AGENT_API.requestHil.pathTemplate,
		{
			schema: AGENT_API.requestHil.schema,
		},
		async (req, reply) => {
			const { agentId, executionId } = req.body;

			try {
				// Load the agent first to check existence and ownership
				const agent = await fastify.agentStateService.load(agentId!); // load now throws NotFound/NotAllowed

				if (agent.executionId !== executionId) {
					return sendBadRequest(reply, `Execution ID mismatch. Agent ${agentId} is currently on execution ${agent.executionId}.`);
				}

				if (agent.hilRequested) {
					logger.info(`HIL check already requested for agent ${agentId}, execution ${executionId}.`);
					// Load again to ensure latest state is returned
					const updatedAgent = await fastify.agentStateService.load(agentId!);
					return send(reply, 200, serializeContext(updatedAgent));
				}

				if (!isExecuting(agent)) {
					return sendBadRequest(reply, `Agent ${agentId} is not in an executing state (${agent.state}). Cannot request HIL check.`);
				}

				await fastify.agentStateService.requestHumanInLoopCheck(agent);

				// Load the updated agent to return the state
				const updatedAgent = await fastify.agentStateService.load(agentId!);
				send(reply, 200, serializeContext(updatedAgent));
			} catch (error: any) {
				// Keep any for now as some errors might not be NotFound/NotAllowed
				if (error instanceof NotFound) {
					return sendNotFound(reply, error.message);
				}
				if (error instanceof NotAllowed) {
					return send(reply, 403, { error: error.message });
				}
				logger.error({ agentId, executionId, error }, 'Error requesting HIL check [error]');
				sendBadRequest(reply, `Error requesting HIL check: ${error.message || 'Unknown error'}`);
			}
		},
	);

	// Cancels an agent and sets it to the completed state
	fastify.post(
		AGENT_API.cancel.pathTemplate,
		{
			schema: AGENT_API.cancel.schema,
		},
		async (req, reply) => {
			const { agentId, executionId, reason } = req.body;
			try {
				// cancelAgent should ideally handle agent existence/ownership or call a service method that does
				await cancelAgent(agentId!, executionId!, reason!);
				// Load the updated agent to return the state
				const updatedAgent = await fastify.agentStateService.load(agentId!); // load now throws NotFound/NotAllowed
				send(reply, 200, serializeContext(updatedAgent));
			} catch (error) {
				if (error instanceof NotFound) {
					return sendNotFound(reply, error.message);
				}
				if (error instanceof NotAllowed) {
					return send(reply, 403, { error: error.message });
				}
				logger.error(error, `Error cancelling agent ${agentId}`);
				sendBadRequest(reply, 'Error cancelling agent');
			}
		},
	);

	/** Resumes an agent in the completed state */
	fastify.post(
		AGENT_API.resumeCompleted.pathTemplate,
		{
			schema: AGENT_API.resumeCompleted.schema,
		},
		async (req, reply) => {
			const { agentId, executionId, instructions } = req.body;

			try {
				// resumeCompleted should ideally handle agent existence/ownership or call a service method that does
				await resumeCompleted(agentId!, executionId!, instructions!);
				// Load the updated agent to return the state
				const updatedAgent = await fastify.agentStateService.load(agentId!); // load now throws NotFound/NotAllowed
				send(reply, 200, serializeContext(updatedAgent));
			} catch (error) {
				if (error instanceof NotFound) {
					return sendNotFound(reply, error.message);
				}
				if (error instanceof NotAllowed) {
					return send(reply, 403, { error: error.message });
				}
				logger.error(error, 'Error resuming completed agent');
				sendBadRequest(reply, 'Error resuming completed agent');
			}
		},
	);

	/** Updates the functions available to an agent */
	fastify.post(
		AGENT_API.updateFunctions.pathTemplate,
		{
			schema: AGENT_API.updateFunctions.schema,
		},
		async (req, reply) => {
			const { agentId, functions } = req.body;

			try {
				// The service method now handles loading, ownership check, and saving
				await fastify.agentStateService.updateFunctions(agentId!, functions!);
				// Load the updated agent to return the state
				const updatedAgent = await fastify.agentStateService.load(agentId!); // load now throws NotFound/NotAllowed
				send(reply, 200, serializeContext(updatedAgent));
			} catch (error) {
				if (error instanceof NotFound) {
					return sendNotFound(reply, error.message);
				}
				if (error instanceof NotAllowed) {
					return send(reply, 403, { error: error.message });
				}
				logger.error(error, 'Error updating agent functions [error]');
				sendBadRequest(reply, 'Error updating agent functions');
			}
		},
	);
}
