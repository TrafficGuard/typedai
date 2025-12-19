import { FastifyRoutes } from '#fastify/fastifyApp';
import { agentRoutes } from './agent';
import { authRoutes } from './auth';
import { chatRoutes } from './chat';
import { codeEditRoutes } from './codeEdit';
import { codeReviewRoutes } from './codeReview';
import { codeTaskRoutes } from './codeTask';
import { debateRoutes } from './debate';
import { llmCallRoutes } from './llms/llm-call-routes';
import { llmRoutes } from './llms/llm-routes';
import { userRoutes } from './profile/user-routes';
import { promptRoutes } from './prompts/prompts-routes';
import { scmRoutes } from './scm/scmRoutes';
import { slackRoutes } from './slack/slackRoutes';
import { githubRoutes } from './webhooks/github/github-routes';
import { gitlabRoutes } from './webhooks/gitlab/gitlabRoutes';
import { jiraRoutes } from './webhooks/jira/jira-routes';
import { workflowRoutes } from './workflows/workflow-routes';

/**
 * @returns All the routes to register for the application
 */
export function getAllRoutes(): FastifyRoutes[] {
	return [
		agentRoutes,
		authRoutes,
		chatRoutes,
		codeEditRoutes,
		codeReviewRoutes,
		codeTaskRoutes,
		debateRoutes,
		gitlabRoutes,
		githubRoutes,
		jiraRoutes,
		llmCallRoutes,
		llmRoutes,
		userRoutes,
		promptRoutes,
		scmRoutes,
		workflowRoutes,
		slackRoutes,
	];
}
