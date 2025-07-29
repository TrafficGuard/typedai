import type { AppFastifyInstance } from '#app/applicationTypes';
import { agentRoutes } from './agent';
import { authRoutes } from './auth';
import { chatRoutes } from './chat';
import { codeEditRoutes } from './codeEdit';
import { codeReviewRoutes } from './codeReview';
import { codeTaskRoutes } from './codeTask';
import { llmCallRoutes } from './llms/llm-call-routes';
import { llmRoutes } from './llms/llm-routes';
import { userRoutes } from './profile/user-routes';
import { promptRoutes } from './prompts/prompts-routes';
import { scmRoutes } from './scm/scmRoutes';
import { workflowRoutes } from './workflows/workflow-routes';

/**
 * Registers all API routes for the application.
 * @param fastify The Fastify instance.
 */
export async function apiRoutes(fastify: AppFastifyInstance) {
	await fastify.register(agentRoutes);
	await fastify.register(authRoutes);
	await fastify.register(chatRoutes);
	await fastify.register(codeEditRoutes);
	await fastify.register(codeReviewRoutes);
	await fastify.register(codeTaskRoutes);
	await fastify.register(llmCallRoutes);
	await fastify.register(llmRoutes);
	await fastify.register(userRoutes);
	await fastify.register(promptRoutes);
	await fastify.register(scmRoutes);
	await fastify.register(workflowRoutes);
}
