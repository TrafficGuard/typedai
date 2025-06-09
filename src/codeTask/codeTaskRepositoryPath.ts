import { join } from 'node:path';
import { systemDir } from '#app/appDirs';
import { logger } from '#o11y/logger';
import type { CodeTask } from '#shared/codeTask/codeTask.model';

export function getCodeTaskRepositoryPath(codeTask: CodeTask): string {
	const codeTaskId = codeTask.id;
	// Calculate Workspace Path based on codeTask settings
	let workspacePath: string;
	if (!codeTask.useSharedRepos) {
		workspacePath = join(systemDir(), 'codeTask', codeTask.id);
		logger.info({ codeTaskId, useSharedRepos: false, workspacePath }, 'Using codeTask-specific workspace path.');
	} else {
		// Use shared repository workspace
		if (codeTask.repositorySource !== 'github' && codeTask.repositorySource !== 'gitlab') {
			throw new Error(`Invalid repositorySource "${codeTask.repositorySource}" for shared repository. Must be 'github' or 'gitlab'.`);
		}
		// Assuming repositoryId is in the format "namespace/repoName" for GitHub/GitLab shared repos
		const repoIdParts = codeTask.repositoryId.split('/');
		if (repoIdParts.length !== 2 || !repoIdParts[0] || !repoIdParts[1]) {
			throw new Error(`Invalid repositoryId format "${codeTask.repositoryId}" for shared repository. Expected "namespace/repoName".`);
		}
		const [namespace, repoName] = repoIdParts;
		workspacePath = join(systemDir(), codeTask.repositorySource, namespace, repoName);
		logger.info({ codeTaskId, namespace, repoName, workspacePath }, 'Using shared workspace path.');
	}
	return workspacePath;
}
