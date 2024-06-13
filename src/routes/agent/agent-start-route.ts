import { readFileSync } from 'fs';
import { Type } from '@sinclair/typebox';
import { Toolbox } from '#agent/toolbox';
import { startAgent } from '#agent/xmlAgentRunner';
import { send } from '#fastify/index';
import { getLLM } from '#llm/llmFactory';
import { logger } from '#o11y/logger';
import { AppFastifyInstance } from '../../app';
import { toolFactory } from '../../functionDefinition/metadata';

import { currentUser } from '#user/userService/userContext';

const v1BasePath = '/api/agent/v1';
export async function agentStartRoute(fastify: AppFastifyInstance) {
	/** Starts a new agent */
	fastify.post(
		`${v1BasePath}/start`,
		{
			schema: {
				body: Type.Object({
					name: Type.String(),
					userPrompt: Type.String(),
					tools: Type.Array(Type.String()),
					// type: Type.String(),
					budget: Type.Number({ minimum: 0 }),
					count: Type.Integer({ minimum: 0 }),
					llmEasy: Type.String(),
					llmMedium: Type.String(),
					llmHard: Type.String(),
				}),
			},
		},
		async (req, reply) => {
			const { name, userPrompt, tools, budget, count, llmEasy, llmMedium, llmHard } = req.body;

			logger.info(req.body, `Starting agent ${name}`);

			logger.info(Object.keys(toolFactory));
			const toolbox = new Toolbox();
			for (const toolName of tools) {
				const tool = toolFactory[toolName];
				logger.info(`getting tool ${toolName} ${tool}`);
				if (!tool) {
					logger.error(`Tool ${toolName} not found in the toolFactory`);
				} else {
					toolbox.addToolType(toolFactory[toolName]);
				}
			}

			startAgent({
				user: currentUser(),
				agentName: name,
				initialPrompt: userPrompt,
				humanInLoop: { budget, count },
				llms: {
					easy: getLLM(llmEasy),
					medium: getLLM(llmMedium),
					hard: getLLM(llmHard),
					xhard: getLLM(llmHard),
				},
				toolbox: toolbox,
			});

			send(reply, 200);
		},
	);
}
