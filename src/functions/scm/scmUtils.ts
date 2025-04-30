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
 * Parses a prefixed project ID string (e.g., "GitLab:group/project" or "GitHub:owner/repo")
 * into its provider type and the actual project ID/path.
 * @param prefixedProjectId The project identifier string with the provider prefix.
 * @returns An object containing the provider type and the project ID.
 * @throws Error if the format is invalid or the provider type is unsupported.
 */
export function parseScmProjectId(prefixedProjectId: string): { providerType: string; projectId: string } {
	const separatorIndex = prefixedProjectId.indexOf(':');
	if (separatorIndex === -1 || separatorIndex === 0 || separatorIndex === prefixedProjectId.length - 1) {
		logger.error(`Invalid project ID format: ${prefixedProjectId}. Expected 'ProviderType:ProjectId'.`);
		throw new Error(`Invalid project ID format: ${prefixedProjectId}. Expected 'ProviderType:ProjectId'.`);
	}

	const providerType = prefixedProjectId.substring(0, separatorIndex);
	const projectId = prefixedProjectId.substring(separatorIndex + 1);

	// Optional: Add validation for supported provider types if needed
	// const supportedProviders = ['GitLab', 'GitHub']; // Example
	// if (!supportedProviders.includes(providerType)) {
	//     logger.warn(`Unsupported SCM provider type: ${providerType}`);
	//     throw new Error(`Unsupported SCM provider type: ${providerType}`);
	// }

	return { providerType, projectId };
}
