import { initApplicationContext } from '#app/applicationContext';
import { logger } from '#o11y/logger';
import { agentRoutes } from '#routes/agent';
import { authRoutes } from '#routes/auth';
import { chatRoutes } from '#routes/chat';
import { codeReviewRoutes } from '#routes/codeReview';
import { codeTaskRoutes } from '#routes/codeTask';
import { llmCallRoutes } from '#routes/llms/llm-call-routes';
import { llmRoutes } from '#routes/llms/llm-routes';
import { userRoutes } from '#routes/profile/user-routes';
import { promptRoutes } from '#routes/prompts/prompts-routes';
import { scmRoutes } from '#routes/scm/scmRoutes';
import { githubRoutes } from '#routes/webhooks/github/github-routes';
import { gitlabRoutes } from '#routes/webhooks/gitlab/gitlabRoutes';
import { jiraRoutes } from '#routes/webhooks/jira/jira-routes';
import { workflowRoutes } from '#routes/workflows/workflow-routes';
import { initFastify } from './fastify';

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
				gitlabRoutes,
				githubRoutes,
				agentRoutes,
				llmRoutes,
				promptRoutes,
				userRoutes,
				llmCallRoutes,
				codeReviewRoutes,
				chatRoutes,
				workflowRoutes,
				jiraRoutes,
				scmRoutes,
				codeTaskRoutes,
			],
			instanceDecorators: applicationContext, // This makes all properties on the ApplicationContext interface available on the fastify instance in the routes
			requestDecorators: {},
		});
	} catch (err: any) {
		logger.fatal(err, 'Could not start TypedAI');
	}
}
