import { Type } from '@sinclair/typebox';
import { send } from '#fastify/index';
import { LlmCall } from '#llm/llmCallService/llmCall';
import { AppFastifyInstance } from '../../applicationTypes';

const basePath = '/api/llms';
export async function llmCallRoutes(fastify: AppFastifyInstance) {
	fastify.get(
		`${basePath}/calls/agent/:agentId`,
		{
			schema: {
				params: Type.Object({
					agentId: Type.String(),
				}),
			},
		},
		async (req, reply) => {
			const { agentId } = req.params;
			const llmCalls: LlmCall[] = await fastify.llmCallService.getLlmCallsForAgent(agentId);
			send(reply, 200, llmCalls);
		},
	);
}
