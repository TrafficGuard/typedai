import { execSync } from 'node:child_process';
import path from 'node:path';
import { getFileSystem } from '#agent/agentContextUtils';
import { logger } from '#o11y/logger';

/**
 * Gets a unique repository identifier from the git remote URL.
 * Format: host/owner/repo (e.g., "gitlab.com/team/repo-name")
 *
 * Falls back to the directory name if no git remote is configured.
 */
export async function getRepositoryId(): Promise<string> {
	const fss = getFileSystem();
	const workingDir = fss.getWorkingDirectory();

	try {
		// Get the remote URL
		const remoteUrl = execSync('git config --get remote.origin.url', {
			cwd: workingDir,
			encoding: 'utf-8',
			stdio: ['pipe', 'pipe', 'pipe'],
		}).trim();

		if (remoteUrl) {
			const repoId = normalizeGitUrl(remoteUrl);
			logger.debug({ remoteUrl, repoId }, 'Resolved repository ID from git remote');
			return repoId;
		}
	} catch (error) {
		logger.debug({ error }, 'Failed to get git remote URL');
	}

	// Fall back to directory name
	const dirName = path.basename(workingDir);
	logger.debug({ dirName }, 'Using directory name as repository ID (no git remote)');
	return `local/${dirName}`;
}

/**
 * Normalize a git URL to a consistent repository ID format.
 * Handles various URL formats:
 * - SSH: git@gitlab.com:team/repo.git
 * - HTTPS: https://gitlab.com/team/repo.git
 * - SSH with port: ssh://git@gitlab.com:22/team/repo.git
 */
export function normalizeGitUrl(url: string): string {
	// Lowercase first for consistent protocol checks
	let normalized = url.toLowerCase();

	// Remove .git suffix
	normalized = normalized.replace(/\.git$/, '');

	// Handle SSH format: git@host:path
	if (normalized.startsWith('git@')) {
		// git@gitlab.com:team/repo -> gitlab.com/team/repo
		normalized = normalized.replace(/^git@([^:]+):(.+)$/, '$1/$2');
	}

	// Handle HTTPS format: https://host/path
	if (normalized.startsWith('https://') || normalized.startsWith('http://')) {
		normalized = normalized.replace(/^https?:\/\//, '');
		// Remove any authentication info (user:pass@)
		normalized = normalized.replace(/^[^@]+@/, '');
	}

	// Handle SSH with port: ssh://git@host:port/path
	if (normalized.startsWith('ssh://')) {
		normalized = normalized.replace(/^ssh:\/\/[^@]+@([^:\/]+)(:\d+)?\/(.+)$/, '$1/$3');
	}

	// Remove any leading slashes
	normalized = normalized.replace(/^\/+/, '');

	return normalized;
}

/**
 * Checks if the current directory is a git repository
 */
export async function isGitRepository(): Promise<boolean> {
	const fss = getFileSystem();
	const workingDir = fss.getWorkingDirectory();

	try {
		execSync('git rev-parse --git-dir', {
			cwd: workingDir,
			encoding: 'utf-8',
			stdio: ['pipe', 'pipe', 'pipe'],
		});
		return true;
	} catch {
		return false;
	}
}
