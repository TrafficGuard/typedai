import { logger } from '#o11y/logger';
import { initApplicationContext } from './applicationContext';
import { initFastify } from './fastify';
import { functionRegistry } from './functionRegistry';
import { agentDetailsRoutes } from './routes/agent/agent-details-routes';
import { agentExecutionRoutes } from './routes/agent/agent-execution-routes';
import { agentStartRoute } from './routes/agent/agent-start-route';
import { authRoutes } from './routes/auth/auth-routes';
import { chatRoutes } from './routes/chat/chat-routes';
import { llmCallRoutes } from './routes/llms/llm-call-routes';
import { llmRoutes } from './routes/llms/llm-routes';
import { profileRoute } from './routes/profile/profile-route';
import { codeReviewRoutes } from './routes/scm/codeReviewRoutes';
import { gitlabRoutesV1 } from './routes/webhooks/gitlab/gitlabRoutes-v1';
import { jiraRoutes } from './routes/webhooks/jira/jira-routes';
import { workflowRoutes } from './routes/workflows/workflow-routes';

// Ensures all the functions are registered
functionRegistry();

/**
 * Creates the applications services and starts the Fastify server.
 */
export async function initServer(): Promise<void> {
	const applicationContext = await initApplicationContext();

	try {
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
				// Add your routes below this line
			],
			instanceDecorators: applicationContext, // This makes all properties on the ApplicationContext interface available on the fastify instance in the routes
			requestDecorators: {},
		});
	} catch (err: any) {
		logger.fatal(err, 'Could not start TypedAI');
	}
}
