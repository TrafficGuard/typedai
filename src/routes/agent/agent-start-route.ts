import { Type } from '@sinclair/typebox';
import { LlmFunctions } from '#agent/LlmFunctions';
import type { AgentType } from '#agent/agentContextTypes';
import { type AgentExecution, startAgent } from '#agent/orchestrator/orchestratorAgentRunner';
import type { AppFastifyInstance } from '#app/applicationTypes';
import { send } from '#fastify/index';
import { functionFactory } from '#functionSchema/functionDecorators';
import { getLLM } from '#llm/llmFactory';
import { logger } from '#o11y/logger';
import { currentUser } from '#user/userService/userContext';

const v1BasePath = '/api/agent/v1';

const AGENT_TYPES: Array<AgentType> = ['autonomous', 'workflow', 'orchestrator'];

export async function agentStartRoute(fastify: AppFastifyInstance) {
	/** Starts a new agent */
	fastify.post(
		`${v1BasePath}/start`,
		{
			schema: {
				body: Type.Object({
					name: Type.String(),
					userPrompt: Type.String(),
					functions: Type.Array(Type.String()),
					type: Type.String({ enum: AGENT_TYPES }),
					subtype: Type.String(),
					budget: Type.Number({ minimum: 0 }),
					count: Type.Integer({ minimum: 0 }),
					llmEasy: Type.String(),
					llmMedium: Type.String(),
					llmHard: Type.String(),
					useSharedRepos: Type.Optional(Type.Boolean({ default: true })),
				}),
			},
		},
		async (req, reply) => {
			const { name, userPrompt, functions, type, subtype, budget, count, llmEasy, llmMedium, llmHard, useSharedRepos } = req.body;

			logger.info(req.body, `Starting agent ${name}`);

			logger.info(Object.keys(functionFactory()));
			const llmFunctions = new LlmFunctions();
			for (const functionClassName of functions) {
				const functionClass = functionFactory()[functionClassName];
				if (!functionClass) {
					logger.error(`Function class ${functionClassName} not found in the functionFactory`);
				} else {
					llmFunctions.addFunctionClass(functionFactory()[functionClassName]);
				}
			}

			const agentExecution: AgentExecution = await startAgent({
				user: currentUser(),
				agentName: name,
				initialPrompt: userPrompt,
				type: type as AgentType,
				subtype: subtype,
				humanInLoop: { budget, count },
				llms: {
					easy: getLLM(llmEasy),
					medium: getLLM(llmMedium),
					hard: getLLM(llmHard),
					xhard: getLLM(llmHard),
				},
				functions: llmFunctions,
				useSharedRepos: useSharedRepos,
			});
			const agentId: string = agentExecution.agentId;
			send(reply, 200, { agentId });
		},
	);
}
