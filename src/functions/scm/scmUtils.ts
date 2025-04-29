import { logger } from '#o11y/logger';

/**
 * Extracts the owner and project name from a GitHub repository URL or path.
 * Handles common formats like 'owner/repo', 'https://github.com/owner/repo',
 * 'git@github.com:owner/repo.git'.
 * @param identifier The GitHub repository URL or path string.
 * @returns A tuple containing [owner, repo].
 * @throws Error if the format is unrecognized.
 */
export function extractOwnerProject(identifier: string): [string, string] {
	// Remove potential protocol, domain, and trailing '.git'
	const cleanedIdentifier = identifier
		.replace(/^(https|git|ssh)(:\/\/|@)/, '') // Remove protocol/ssh prefix
		.replace(/^[^\/:]+[\/:]([^\/:]+\/)/, '$1') // Remove domain for https/ssh, keep leading slash for path
		.replace(/\.git$/, ''); // Remove trailing .git

	// Split by '/' or ':'
	const parts = cleanedIdentifier.split(/[\/:]/);

	// Expecting 'owner/repo' structure at the end
	if (parts.length >= 2) {
		const repo = parts[parts.length - 1];
		const owner = parts[parts.length - 2];
		if (owner && repo) {
			return [owner, repo];
		}
	}

	logger.error(`Could not extract owner/project from identifier: ${identifier}`);
	throw new Error(`Invalid GitHub project identifier format: ${identifier}. Expected 'owner/repo'.`);
}

/**
 * Parses a prefixed project ID string (e.g., "GitHub:owner/repo") into its components.
 * @param prefixedProjectId The project ID string with a provider prefix.
 * @returns An object containing the provider type (lowercase) and the actual project ID.
 * @throws Error if the format is invalid.
 */
export function parseScmProjectId(prefixedProjectId: string): { providerType: string; projectId: string } {
	const parts = prefixedProjectId.split(':');
	if (parts.length < 2 || !parts[0] || !parts[1]) {
		throw new Error(`Invalid project ID format: '${prefixedProjectId}'. Expected 'Provider:ProjectId' (e.g., 'GitHub:owner/repo').`);
	}

	const providerType = parts[0].toLowerCase();
	const projectId = parts.slice(1).join(':'); // Re-join in case projectId contains ':'

	// Basic validation for known providers
	if (providerType !== 'github' && providerType !== 'gitlab') {
		logger.warn(`Unrecognized SCM provider type '${providerType}' in project ID '${prefixedProjectId}'. Proceeding, but may cause issues.`);
		// Depending on strictness, you might throw an error here instead.
	}

	return { providerType, projectId };
}
