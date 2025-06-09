import crypto from 'node:crypto';
import type { AppFastifyInstance } from '#app/applicationTypes';

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

				switch (eventType) {
					case 'issue_comment':
						await handleCommentEvent(payload, fastify);
						break;
					case 'issues':
						await handleIssueEvent(payload, fastify);
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

function verifyGitHubSignature(request: any) {
	const secret = process.env.GITHUB_WEBHOOK_SECRET;
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
