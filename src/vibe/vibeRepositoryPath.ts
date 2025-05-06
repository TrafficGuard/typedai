import { join } from 'node:path';
import { systemDir } from '#app/appVars';
import { logger } from '#o11y/logger';
import type { VibeSession } from '#vibe/vibeTypes';

export function getVibeRepositoryPath(session: VibeSession): string {
	const sessionId = session.id;
	// Calculate Workspace Path based on session settings
	let workspacePath: string;
	if (!session.useSharedRepos) {
		workspacePath = join(systemDir(), 'vibe', session.id);
		logger.info({ sessionId, useSharedRepos: false, workspacePath }, 'Using session-specific workspace path.');
	} else {
		// Use shared repository workspace
		if (session.repositorySource !== 'github' && session.repositorySource !== 'gitlab') {
			throw new Error(`Invalid repositorySource "${session.repositorySource}" for shared repository. Must be 'github' or 'gitlab'.`);
		}
		// Assuming repositoryId is in the format "namespace/repoName" for GitHub/GitLab shared repos
		const repoIdParts = session.repositoryId.split('/');
		if (repoIdParts.length !== 2 || !repoIdParts[0] || !repoIdParts[1]) {
			throw new Error(`Invalid repositoryId format "${session.repositoryId}" for shared repository. Expected "namespace/repoName".`);
		}
		const [namespace, repoName] = repoIdParts;
		workspacePath = join(systemDir(), session.repositorySource, namespace, repoName);
		logger.info({ sessionId, namespace, repoName, workspacePath }, 'Using shared workspace path.');
	}
	return workspacePath;
}
