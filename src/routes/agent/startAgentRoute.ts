import type { Static } from '@sinclair/typebox';
import { LlmFunctionsImpl } from '#agent/LlmFunctionsImpl';
import { serializeContext } from '#agent/agentSerialization';
import { type AgentExecution, startAgent } from '#agent/autonomous/autonomousAgentRunner';
import type { AppFastifyInstance } from '#app/applicationTypes';
import { send } from '#fastify/index';
import { functionFactory } from '#functionSchema/functionDecorators';
import { getLLM } from '#llm/llmFactory';
import { logger } from '#o11y/logger';
import { AGENT_API } from '#shared/agent/agent.api';
import type { AgentType } from '#shared/agent/agent.model';
import { currentUser } from '#user/userContext';
import { registerApiRoute } from '../routeUtils';

export async function startAgentRoute(fastify: AppFastifyInstance): Promise<void> {
	/** Starts a new agent */
	registerApiRoute(fastify, AGENT_API.start, async (req, reply) => {
		const { agentName, initialPrompt, functions, type, subtype, humanInLoop, llms, useSharedRepos, metadata, resumeAgentId, parentAgentId, codeTaskId } =
			req.body;

		logger.info(req.body, `Starting agent ${agentName}`);

		logger.info(Object.keys(functionFactory()));
		const llmFunctions = new LlmFunctionsImpl();
		if (functions) {
			// Handle optional 'functions' array
			for (const functionClassName of functions) {
				const functionClass = functionFactory()[functionClassName];
				if (!functionClass) {
					logger.error(`Function class ${functionClassName} not found in the functionFactory`);
				} else {
					llmFunctions.addFunctionClass(functionClass);
				}
			}
		}

		const agentExecution: AgentExecution = await startAgent({
			user: currentUser(),
			agentName: agentName,
			initialPrompt: initialPrompt,
			type: type as AgentType,
			subtype: subtype ?? '',
			humanInLoop: humanInLoop, // Pass the object directly; startAgent should handle if undefined
			llms: {
				easy: getLLM(llms.easy),
				medium: getLLM(llms.medium),
				hard: getLLM(llms.hard),
				xhard: llms.xhard ? getLLM(llms.xhard) : null,
			},
			functions: llmFunctions,
			useSharedRepos: useSharedRepos ?? true, // Default if useSharedRepos is optional and undefined
			metadata: metadata,
			resumeAgentId: resumeAgentId,
			parentAgentId: parentAgentId,
			codeTaskId: codeTaskId,
		});
		const agentId: string = agentExecution.agentId;
		const agentContext = await fastify.agentStateService.load(agentId);
		if (!agentContext) {
			logger.error(`Agent ${agentId} not found after startAgent call. This indicates an issue with agent creation or saving.`);
			return send(reply, 500, { error: 'Failed to retrieve agent context after creation' });
		}
		const responseBody = serializeContext(agentContext);
		reply.sendJSON(responseBody, 201);
	});
}
