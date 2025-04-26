import { GitHub } from '#functions/scm/github';
import { GitLab } from '#functions/scm/gitlab';
import type { SourceControlManagement } from '#functions/scm/sourceControlManagement';
import { logger } from '#o11y/logger';

/**
 * Service for managing and accessing configured Source Control Management (SCM) providers.
 */
export class ScmService {
	private providers: SourceControlManagement[] = [];

	constructor() {
		this.initializeProviders();
	}

	private initializeProviders(): void {
		const potentialProviders: SourceControlManagement[] = [new GitHub(), new GitLab()];

		this.providers = potentialProviders.filter((provider) => {
			try {
				if (provider.isConfigured()) {
					logger.info(`SCM provider '${provider.getType()}' is configured.`);
					return true;
				} else {
					logger.info(`SCM provider '${provider.getType()}' is not configured.`);
					return false;
				}
			} catch (error) {
				logger.error(error, `Error checking configuration for SCM provider '${provider.getType()}'`);
				return false;
			}
		});
	}

	/**
	 * Gets all configured SCM providers.
	 * @returns An array of configured SourceControlManagement instances.
	 */
	getConfiguredProviders(): SourceControlManagement[] {
		return this.providers;
	}

	/**
	 * Gets a specific configured SCM provider by its type.
	 * @param type The type of the provider (e.g., 'github', 'gitlab').
	 * @returns The SourceControlManagement instance or undefined if not configured or not found.
	 */
	getProvider(type: 'github' | 'gitlab' | string): SourceControlManagement | undefined {
		return this.providers.find((provider) => provider.getType() === type);
	}

	/**
	 * Checks if any SCM provider is configured.
	 * @returns True if at least one provider is configured, false otherwise.
	 */
	hasConfiguredProvider(): boolean {
		return this.providers.length > 0;
	}
}

// Optional: Export a singleton instance if desired for application-wide use
// export const scmService = new ScmService();
