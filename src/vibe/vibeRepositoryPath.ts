import { join } from 'node:path';
import { systemDir } from '#app/appVars';
import { logger } from '#o11y/logger';
import type { VibeSession } from '#vibe/vibeTypes';

export function getVibeRepositoryPath(session: VibeSession): string {
	const sessionId = session.id;
	// Calculate Workspace Path based on session settings
	let workspacePath: string;
	if (!session.useSharedRepos) {
		// Use session-specific workspace
		logger.info({ sessionId, useSharedRepos: false, workspacePath }, 'Calculated session-specific workspace path.');
		workspacePath = join(systemDir(), 'vibe', session.id);
	} else {
		// Use shared repository workspace
		logger.info(
			{ sessionId, useSharedRepos: true, repositorySource: session.repositorySource, repositoryId: session.repositoryId },
			'Calculating shared repository workspace path...',
		);
		if (session.repositorySource !== 'github' && session.repositorySource !== 'gitlab') {
			throw new Error(`Invalid repositorySource "${session.repositorySource}" for shared repository. Must be 'github' or 'gitlab'.`);
		}
		const repoIdParts = session.repositoryId.split('/');
		if (repoIdParts.length !== 2 || !repoIdParts[0] || !repoIdParts[1]) {
			throw new Error(`Invalid repositoryId format "${session.repositoryId}" for shared repository. Expected "namespace/repoName".`);
		}
		const [namespace, repoName] = repoIdParts;
		workspacePath = join(systemDir(), session.repositorySource, namespace, repoName);
		// logger.info({ sessionId, namespace, repoName, workspacePath }, 'Calculated shared workspace path.');
	}
	return workspacePath;
}
