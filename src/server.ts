import { initApplicationContext } from '#app/applicationContext';
import { logger } from '#o11y/logger';
import { initFastify } from './fastify';
import { agentDetailsRoutes } from './routes/agent/agent-details-routes';
import { agentExecutionRoutes } from './routes/agent/agent-execution-routes';
import { agentStartRoute } from './routes/agent/agent-start-route';
import { authRoutes } from './routes/auth/auth-routes';
import { chatRoutes } from './routes/chat/chat-routes';
import { llmCallRoutes } from './routes/llms/llm-call-routes';
import { llmRoutes } from './routes/llms/llm-routes';
import { profileRoute } from './routes/profile/profile-route';
import { codeReviewRoutes } from './routes/scm/codeReviewRoutes';
import { scmRoutes } from './routes/scm/scmRoutes';
import { vibeRoutes } from './routes/vibe/vibeRoutes';
import { gitlabRoutesV1 } from './routes/webhooks/gitlab/gitlabRoutes-v1';
import { jiraRoutes } from './routes/webhooks/jira/jira-routes';
import { workflowRoutes } from './routes/workflows/workflow-routes';

/**
 * Creates the applications services and starts the Fastify server.
 */
export async function initServer(): Promise<void> {
	const applicationContext = await initApplicationContext();

	// Ensures all the functions are registered
	// Load dynamically so the modules only load now
	const functionRegistry = (await import('./functionRegistryModule.cjs')).functionRegistry as () => Array<new () => any>;
	functionRegistry();

	try {
		// [DOC] All fastify routes from the /routes dir must be registered here in initFastify()
		await initFastify({
			routes: [
				authRoutes,
				gitlabRoutesV1,
				agentStartRoute,
				agentDetailsRoutes,
				agentExecutionRoutes,
				profileRoute,
				llmRoutes,
				llmCallRoutes,
				codeReviewRoutes,
				chatRoutes,
				workflowRoutes,
				jiraRoutes,
				scmRoutes,
				vibeRoutes,
			],
			instanceDecorators: applicationContext, // This makes all properties on the ApplicationContext interface available on the fastify instance in the routes
			requestDecorators: {},
		});
	} catch (err: any) {
		logger.fatal(err, 'Could not start TypedAI');
	}
}
