import crypto from 'node:crypto';
import { appContext } from '#app/applicationContext';
import type { AppFastifyInstance } from '#app/applicationTypes';
import { GitHub } from '#functions/scm/github';
import { logger } from '#o11y/logger';
import { runAsUser } from '#user/userContext';
import { envVar } from '#utils/env-var';
import { getAgentUser } from '../webhookAgentUser';
import { handleGitHubIssueEvent } from './github-issue';

interface WorkflowRunPayload {
	action: 'completed' | 'requested' | 'in_progress';
	workflow_run: {
		id: number;
		name: string;
		status: string;
		conclusion: 'success' | 'failure' | 'cancelled' | 'timed_out' | null;
	};
	repository: {
		full_name: string;
	};
}

interface WorkflowJobPayload {
	action: 'completed' | 'queued' | 'in_progress';
	workflow_job: {
		id: number;
		run_id: number;
		name: string;
		status: string;
		conclusion: 'success' | 'failure' | 'cancelled' | 'timed_out' | null;
		steps: Array<{
			name: string;
			status: string;
			conclusion: string | null;
			number: number;
		}>;
	};
	repository: {
		full_name: string;
	};
}

const basePath = '/api/webhooks';

export async function githubRoutes(fastify: AppFastifyInstance): Promise<void> {
	fastify.post(`${basePath}/github`, {
		config: {
			rawBody: true, // Required for signature validation
		},
		handler: async (request, reply) => {
			try {
				const isValid = verifyGitHubSignature(request);
				if (!isValid) return reply.code(401).send({ error: 'Unauthorized' });

				const user = await getAgentUser();
				runAsUser(user, async () => {
					// 2. Process GitHub event
					const eventType = request.headers['x-github-event'];
					const payload = request.body;
					logger.info(payload);

					switch (eventType) {
						case 'issue_comment':
							await handleCommentEvent(payload, fastify);
							break;
						case 'issues':
							await handleGitHubIssueEvent(payload, fastify);
							break;
						case 'pull_request':
							await handlePullRequestEvent(payload, fastify);
							break;
						case 'workflow_run':
							await handleWorkflowRunEvent(payload as WorkflowRunPayload, fastify);
							break;
						case 'workflow_job':
							await handleWorkflowJobEvent(payload as WorkflowJobPayload, fastify);
							break;
					}
				});

				return reply.code(200).send({ status: 'processed' });
			} catch (error) {
				logger.error(`Webhook processing failed: ${error.message}`);
				return reply.code(500).send({ error: 'Processing failed' });
			}
		},
	});
}

// Placeholder function - implement AI logic here
export async function handleCommentEvent(payload: any, fastify: AppFastifyInstance): Promise<void> {
	const repositoryFullName = payload.repository?.full_name || 'unknown repository';
	const issueNumber = payload.issue?.number;
	const issueTitle = payload.issue?.title || 'unknown title';
	const commentId = payload.comment?.id;
	const commentUrl = payload.comment?.html_url;
	const commenterLogin = payload.comment?.user?.login || 'unknown user';
	const commentBodyPreview = payload.comment?.body?.substring(0, 100) + (payload.comment?.body?.length > 100 ? '...' : '');

	const isPRComment = !!payload.issue?.pull_request;
	const commentType = isPRComment ? 'Pull Request' : 'Issue';

	if (payload.action === 'created') {
		fastify.log.info(
			`GitHub Webhook: New comment on ${commentType} in repository '${repositoryFullName}'. ` +
				`${commentType} #: ${issueNumber}, Title: '${issueTitle}'. ` +
				`Comment ID: ${commentId}, URL: ${commentUrl}, User: '${commenterLogin}'. ` +
				`Preview: "${commentBodyPreview}"`,
		);
		// TODO: Add further AI logic for comment processing here.
	} else {
		logger.info(
			`GitHub Webhook: Received 'issue_comment' event with action '${payload.action}' for ${commentType} #${issueNumber} in repository '${repositoryFullName}'. Not a 'created' action.`,
		);
	}
}

async function handleWorkflowRunEvent(payload: WorkflowRunPayload, fastify: AppFastifyInstance) {
	if (payload.action !== 'completed') {
		logger.info(`GitHub Webhook: Received 'workflow_run' event with action '${payload.action}'. Ignoring as it's not 'completed'.`);
		return;
	}

	const { workflow_run, repository } = payload;
	const projectPath = repository.full_name;

	logger.info(
		`GitHub Webhook: Workflow run '${workflow_run.name}' (ID: ${workflow_run.id}) in '${projectPath}' completed with conclusion: ${workflow_run.conclusion}.`,
	);

	if (workflow_run.conclusion === 'failure') {
		logger.warn(`🔥 Workflow run ${workflow_run.id} failed in '${projectPath}'. Investigating...`);
		try {
			const github = new GitHub();
			const jobs = await github.listJobsForWorkflowRun(projectPath, workflow_run.id);
			const failedJobs = jobs.filter((job) => job.conclusion === 'failure');

			if (failedJobs.length === 0) {
				logger.info(`No failed jobs found for workflow run ${workflow_run.id}. The failure may be at the workflow level.`);
				return;
			}

			logger.info(`Found ${failedJobs.length} failed jobs for workflow run ${workflow_run.id}:`);
			for (const job of failedJobs) {
				logger.info(`- Job: '${job.name}' (ID: ${job.id})`);
				const failedSteps = job.steps.filter((step) => step.conclusion === 'failure');
				if (failedSteps.length > 0) {
					const stepNames = failedSteps.map((s) => `'${s.name}'`).join(', ');
					logger.info(`  - Failed steps: ${stepNames}`);
				}
				// Fetch and log a snippet of the logs
				const logs = await github.getJobLogs(projectPath, String(job.id));
				logger.info(`  - Fetched ${logs.length} bytes of logs for job ${job.id}.`);
			}
		} catch (error) {
			logger.error(error, `Error investigating failed workflow run ${workflow_run.id}`);
		}
	}
}

async function handleWorkflowJobEvent(payload: WorkflowJobPayload, fastify: AppFastifyInstance) {
	if (payload.action !== 'completed') {
		logger.info(`GitHub Webhook: Received 'workflow_job' event with action '${payload.action}'. Ignoring as it's not 'completed'.`);
		return;
	}

	const { workflow_job, repository } = payload;
	const projectPath = repository.full_name;

	logger.info(`GitHub Webhook: Job '${workflow_job.name}' (ID: ${workflow_job.id}) in '${projectPath}' completed with conclusion: ${workflow_job.conclusion}.`);

	if (workflow_job.conclusion === 'failure') {
		logger.warn(`🔥 Job '${workflow_job.name}' (ID: ${workflow_job.id}) failed in '${projectPath}'.`);
		try {
			const failedSteps = workflow_job.steps.filter((step) => step.conclusion === 'failure');
			if (failedSteps.length > 0) {
				const stepNames = failedSteps.map((s) => `'${s.name}'`).join(', ');
				logger.info(`  - Failed steps: ${stepNames}`);
			}

			const github = new GitHub();
			const logs = await github.getJobLogs(projectPath, String(workflow_job.id));
			logger.info(`  - Fetched ${logs.length} bytes of logs for job ${workflow_job.id}.`);
		} catch (error) {
			logger.error(error, `Error processing failed job ${workflow_job.id}`);
		}
	}
}
function verifyGitHubSignature(request: any): boolean {
	const secret = process.env.GITHUB_WEBHOOK_SECRET ?? '';
	const signature = request.headers['x-hub-signature-256'] as string;
	const payload = request.rawBody;

	const secretPreview = secret?.length > 4 ? `${secret.slice(0, 4)}...` : secret;

	if (!secret || !signature || !payload) {
		logger.warn({ signature, secretPreview, payload }, 'Invalid GitHub webhook request');
		return false;
	}

	const hmac = crypto.createHmac('sha256', secret);
	const digest = `sha256=${hmac.update(payload).digest('hex')}`;
	const valid = crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(digest));

	if (!valid) logger.warn({ signature, digest, secretPreview, payload }, 'Invalid GitHub webhook signature');

	return valid;
}

async function handlePullRequestEvent(payload: unknown, fastify: AppFastifyInstance) {
	logger.warn('Function not implemented.');
}
