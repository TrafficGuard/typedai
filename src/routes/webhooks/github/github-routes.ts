import crypto from 'node:crypto';
import type { AppFastifyInstance } from '#app/applicationTypes';
import { GitHub } from '#functions/scm/github';
import { logger } from '#o11y/logger';

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

export async function githubRoutes(fastify: AppFastifyInstance) {
	fastify.post(`${basePath}/github`, {
		config: {
			rawBody: true, // Required for signature validation
		},
		handler: async (request, reply) => {
			try {
				const isValid = verifyGitHubSignature(request);
				if (!isValid) {
					fastify.log.warn('Invalid webhook signature');
					return reply.code(401).send({ error: 'Unauthorized' });
				}

				// 2. Process GitHub event
				const eventType = request.headers['x-github-event'];
				const payload = request.body;
				logger.info(payload);

				switch (eventType) {
					case 'issue_comment':
						await handleCommentEvent(payload, fastify);
						break;
					case 'issues':
						await handleIssueEvent(payload, fastify);
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

				return reply.code(200).send({ status: 'processed' });
			} catch (error) {
				fastify.log.error(`Webhook processing failed: ${error.message}`);
				return reply.code(500).send({ error: 'Processing failed' });
			}
		},
	});
}

// Placeholder function - implement AI logic here
export async function handleCommentEvent(payload: any, fastify: AppFastifyInstance) {
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
		fastify.log.info(
			`GitHub Webhook: Received 'issue_comment' event with action '${payload.action}' for ${commentType} #${issueNumber} in repository '${repositoryFullName}'. Not a 'created' action.`,
		);
	}
}

// Placeholder function - implement AI logic here
export async function handleIssueEvent(payload: any, fastify: AppFastifyInstance) {
	const repositoryFullName = payload.repository?.full_name || 'unknown repository';
	const issueNumber = payload.issue?.number;
	const issueTitle = payload.issue?.title;
	const issueUrl = payload.issue?.html_url;

	if (payload.action === 'opened') {
		fastify.log.info(
			`GitHub Webhook: New issue created in repository '${repositoryFullName}'. ` + `Issue #: ${issueNumber}, Title: '${issueTitle}', URL: ${issueUrl}`,
		);
		// TODO: Add further AI logic for new issue processing here in future iterations.
	} else if (payload.action === 'labeled') {
		const labelName = payload.label?.name;
		const labelColor = payload.label?.color; // Color might not always be present or relevant for all logs
		fastify.log.info(
			`GitHub Webhook: Issue labeled in repository '${repositoryFullName}'. Issue #: ${issueNumber}, Title: '${issueTitle}', URL: ${issueUrl}. Label added: '${labelName}'${labelColor ? ` (Color: ${labelColor})` : ''}`,
		);
		// TODO: Add further AI logic for issue labeled processing here.
	} else if (payload.action === 'unlabeled') {
		const labelName = payload.label?.name;
		fastify.log.info(
			`GitHub Webhook: Issue unlabeled in repository '${repositoryFullName}'. ` +
				`Issue #: ${issueNumber}, Title: '${issueTitle}', URL: ${issueUrl}. ` +
				`Label removed: '${labelName}'`,
		);
		// TODO: Add further AI logic for issue unlabeled processing here.
	} else {
		// Log other 'issues' actions for visibility, but don't treat them as new issues.
		fastify.log.info(
			`GitHub Webhook: Received 'issues' event with action '${payload.action}' for repository '${repositoryFullName}'.${issueNumber ? ` Issue #: ${issueNumber}.` : ''} Not an 'opened', 'labeled', or 'unlabeled' action.`, // Updated message
		);
	}
}

async function handleWorkflowRunEvent(payload: WorkflowRunPayload, fastify: AppFastifyInstance) {
	if (payload.action !== 'completed') {
		fastify.log.info(`GitHub Webhook: Received 'workflow_run' event with action '${payload.action}'. Ignoring as it's not 'completed'.`);
		return;
	}

	const { workflow_run, repository } = payload;
	const projectPath = repository.full_name;

	fastify.log.info(
		`GitHub Webhook: Workflow run '${workflow_run.name}' (ID: ${workflow_run.id}) in '${projectPath}' completed with conclusion: ${workflow_run.conclusion}.`,
	);

	if (workflow_run.conclusion === 'failure') {
		fastify.log.warn(`🔥 Workflow run ${workflow_run.id} failed in '${projectPath}'. Investigating...`);
		try {
			const github = new GitHub();
			const jobs = await github.listJobsForWorkflowRun(projectPath, workflow_run.id);
			const failedJobs = jobs.filter((job) => job.conclusion === 'failure');

			if (failedJobs.length === 0) {
				fastify.log.info(`No failed jobs found for workflow run ${workflow_run.id}. The failure may be at the workflow level.`);
				return;
			}

			fastify.log.info(`Found ${failedJobs.length} failed jobs for workflow run ${workflow_run.id}:`);
			for (const job of failedJobs) {
				fastify.log.info(`- Job: '${job.name}' (ID: ${job.id})`);
				const failedSteps = job.steps.filter((step) => step.conclusion === 'failure');
				if (failedSteps.length > 0) {
					const stepNames = failedSteps.map((s) => `'${s.name}'`).join(', ');
					fastify.log.info(`  - Failed steps: ${stepNames}`);
				}
				// Fetch and log a snippet of the logs
				const logs = await github.getJobLogs(projectPath, String(job.id));
				fastify.log.info(`  - Fetched ${logs.length} bytes of logs for job ${job.id}.`);
			}
		} catch (error) {
			fastify.log.error(error, `Error investigating failed workflow run ${workflow_run.id}`);
		}
	}
}

async function handleWorkflowJobEvent(payload: WorkflowJobPayload, fastify: AppFastifyInstance) {
	if (payload.action !== 'completed') {
		fastify.log.info(`GitHub Webhook: Received 'workflow_job' event with action '${payload.action}'. Ignoring as it's not 'completed'.`);
		return;
	}

	const { workflow_job, repository } = payload;
	const projectPath = repository.full_name;

	fastify.log.info(
		`GitHub Webhook: Job '${workflow_job.name}' (ID: ${workflow_job.id}) in '${projectPath}' completed with conclusion: ${workflow_job.conclusion}.`,
	);

	if (workflow_job.conclusion === 'failure') {
		fastify.log.warn(`🔥 Job '${workflow_job.name}' (ID: ${workflow_job.id}) failed in '${projectPath}'.`);
		try {
			const failedSteps = workflow_job.steps.filter((step) => step.conclusion === 'failure');
			if (failedSteps.length > 0) {
				const stepNames = failedSteps.map((s) => `'${s.name}'`).join(', ');
				fastify.log.info(`  - Failed steps: ${stepNames}`);
			}

			const github = new GitHub();
			const logs = await github.getJobLogs(projectPath, String(workflow_job.id));
			fastify.log.info(`  - Fetched ${logs.length} bytes of logs for job ${workflow_job.id}.`);
		} catch (error) {
			fastify.log.error(error, `Error processing failed job ${workflow_job.id}`);
		}
	}
}
function verifyGitHubSignature(request: any) {
	const secret = process.env.GITHUB_WEBHOOK_SECRET ?? '';
	const signature = request.headers['x-hub-signature-256'] as string;
	const payload = request.rawBody;

	if (!secret || !signature || !payload) {
		// Or handle this more gracefully, perhaps log and return false
		throw new Error('Missing secret, signature, or payload for verification');
	}

	const hmac = crypto.createHmac('sha256', secret);
	const digest = `sha256=${hmac.update(payload).digest('hex')}`;
	return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(digest));
}

async function handlePullRequestEvent(payload: unknown, fastify: AppFastifyInstance) {
	logger.warn('Function not implemented.');
}
