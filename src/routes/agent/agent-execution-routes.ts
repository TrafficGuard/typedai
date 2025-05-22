import type { Static } from '@sinclair/typebox';
import { LlmFunctionsImpl } from '#agent/LlmFunctionsImpl';
import { serializeContext } from '#agent/agentSerialization';
import { cancelAgent, provideFeedback, resumeCompleted, resumeError, resumeHil } from '#agent/autonomous/autonomousAgentRunner';
import { forceStopAgent } from '#agent/forceStopAgent';
import type { AppFastifyInstance } from '#app/applicationTypes';
import { send, sendBadRequest } from '#fastify/index';
import { functionFactory } from '#functionSchema/functionDecorators';
import { logger } from '#o11y/logger';
import { AGENT_API } from '#shared/api/agent.api';
import { isExecuting } from '#shared/model/agent.model';

export async function agentExecutionRoutes(fastify: AppFastifyInstance) {
	/** Forcibly stop an agent */
	fastify.post(
		AGENT_API.forceStop.pathTemplate,
		{
			schema: AGENT_API.forceStop.schema,
		},
		async (req, reply) => {
			const { agentId } = req.body;

			await forceStopAgent(agentId);

			send(reply, 200, null);
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
				await provideFeedback(agentId!, executionId!, feedback!);
				const updatedAgent = await fastify.agentStateService.load(agentId);
				if (!updatedAgent) return sendBadRequest(reply, 'Agent not found');
				send(reply, 200, serializeContext(updatedAgent));
			} catch (error) {
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

			await resumeError(agentId!, executionId!, feedback!);
			const updatedAgent = await fastify.agentStateService.load(agentId);
			if (!updatedAgent) return sendBadRequest(reply, 'Agent not found');
			send(reply, 200, serializeContext(updatedAgent));
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

			await resumeHil(agentId!, executionId!, feedback!);
			const updatedAgent = await fastify.agentStateService.load(agentId);
			if (!updatedAgent) return sendBadRequest(reply, 'Agent not found');
			send(reply, 200, serializeContext(updatedAgent));
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
				const agent = await fastify.agentStateService.load(agentId!);
				if (!agent) return sendBadRequest(reply, 'Agent not found');

				if (agent.executionId !== executionId) {
					return sendBadRequest(reply, `Execution ID mismatch. Agent ${agentId} is currently on execution ${agent.executionId}.`);
				}

				if (agent.hilRequested) {
					logger.info(`HIL check already requested for agent ${agentId}, execution ${executionId}.`);
					return send(reply, 200, serializeContext(agent));
				}

				if (!isExecuting(agent)) {
					return sendBadRequest(reply, `Agent ${agentId} is not in an executing state (${agent.state}). Cannot request HIL check.`);
				}

				await fastify.agentStateService.requestHumanInLoopCheck(agent);

				const updatedAgent = await fastify.agentStateService.load(agentId);
				if (!updatedAgent) {
					// This should ideally not happen if the previous load succeeded, but handle defensively
					logger.error({ agentId, executionId }, 'Failed to reload agent after requesting HIL check');
					return sendBadRequest(reply, 'Failed to reload agent state after requesting HIL check.');
				}
				send(reply, 200, serializeContext(updatedAgent));
			} catch (error: any) {
				logger.error({ agentId, executionId, error }, 'Error requesting HIL check');
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

			await cancelAgent(agentId!, executionId!, reason!);
			const updatedAgent = await fastify.agentStateService.load(agentId);
			if (!updatedAgent) return sendBadRequest(reply, 'Agent not found');
			send(reply, 200, serializeContext(updatedAgent));
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
				await resumeCompleted(agentId!, executionId!, instructions!);
				const updatedAgent = await fastify.agentStateService.load(agentId);
				if (!updatedAgent) return sendBadRequest(reply, 'Agent not found');
				send(reply, 200, serializeContext(updatedAgent));
			} catch (error) {
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
				const agent = await fastify.agentStateService.load(agentId!);
				if (!agent) throw new Error('Agent not found');

				agent.functions = new LlmFunctionsImpl();
				for (const functionName of functions!) {
					const FunctionClass = functionFactory()[functionName];
					if (FunctionClass) {
						agent.functions.addFunctionClass(FunctionClass);
					} else {
						logger.warn(`Function ${functionName} not found in function factory`);
					}
				}

				await fastify.agentStateService.save(agent);
				const updatedAgent = await fastify.agentStateService.load(agentId);
				send(reply, 200, serializeContext(updatedAgent));
			} catch (error) {
				logger.error('Error updating agent functions:', error);
				sendBadRequest(reply, 'Error updating agent functions');
			}
		},
	);
}
