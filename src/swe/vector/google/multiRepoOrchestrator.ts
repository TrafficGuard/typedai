import { logger } from '#o11y/logger';
import { VectorStoreConfig } from '../core/config';
import { SearchResult } from '../core/interfaces';
import { GoogleVectorServiceConfig } from './googleVectorConfig';
import { VectorSearchOrchestrator } from './vectorSearchOrchestrator';

export interface RepositoryConfig {
	name: string;
	dataStoreId: string;
	enabled: boolean;
	team?: string;
	product?: string;
	description?: string;
}

export interface MultiRepoSearchOptions {
	maxResults?: number;
	repositories?: string[]; // Optional: limit to specific repos
	reranking?: boolean;
	fileFilter?: string[];
	languageFilter?: string[];
}

/**
 * Orchestrator for searching across multiple code repositories
 * Each repository has its own data store
 * Implements fan-out search pattern with result merging
 */
export class MultiRepositoryOrchestrator {
	private orchestrators: Map<string, VectorSearchOrchestrator>;
	private repositories: Map<string, RepositoryConfig>;

	constructor(
		private googleConfig: GoogleVectorServiceConfig,
		repositories: RepositoryConfig[],
		private config?: VectorStoreConfig,
	) {
		this.orchestrators = new Map();
		this.repositories = new Map();

		// Create orchestrator for each enabled repository
		for (const repo of repositories.filter((r) => r.enabled)) {
			const repoConfig = { ...googleConfig, dataStoreId: repo.dataStoreId };
			this.orchestrators.set(repo.name, new VectorSearchOrchestrator(repoConfig, this.config));
			this.repositories.set(repo.name, repo);
		}

		logger.info({ repositoryCount: this.orchestrators.size }, 'Multi-repository orchestrator initialized');
	}

	/**
	 * Search across multiple repositories
	 * Fan-out query to all data stores, merge and rank results
	 */
	async searchAcrossRepositories(query: string, options?: MultiRepoSearchOptions): Promise<SearchResult[]> {
		const maxResults = options?.maxResults || 10;
		const targetRepos = options?.repositories || Array.from(this.orchestrators.keys());

		logger.info(
			{
				query,
				targetRepoCount: targetRepos.length,
				allRepoCount: this.orchestrators.size,
				maxResults,
			},
			'Starting multi-repository search',
		);

		const startTime = Date.now();

		// Fan-out search to all repositories in parallel
		const searchPromises = targetRepos
			.filter((repo) => this.orchestrators.has(repo))
			.map(async (repoName) => {
				try {
					const orchestrator = this.orchestrators.get(repoName)!;
					const repoConfig = this.repositories.get(repoName)!;

					// Get more candidates from each repo for better merging
					const candidateCount = Math.max(maxResults, 20);

					const results = await orchestrator.search(query, {
						maxResults: candidateCount,
						fileFilter: options?.fileFilter,
						languageFilter: options?.languageFilter,
					});

					// Add repository metadata to results
					return results.map((result) => ({
						...result,
						metadata: {
							...result.metadata,
							repository: repoName,
							repositoryTeam: repoConfig.team,
							repositoryProduct: repoConfig.product,
						},
					}));
				} catch (error) {
					logger.error({ error, repository: repoName }, 'Search failed for repository');
					return [];
				}
			});

		// Wait for all searches to complete
		const allResults = await Promise.all(searchPromises);

		// Merge and sort by score
		const mergedResults = allResults
			.flat()
			.sort((a, b) => b.score - a.score)
			.slice(0, maxResults);

		const duration = Date.now() - startTime;

		logger.info(
			{
				totalResults: mergedResults.length,
				searchedRepositories: targetRepos.length,
				durationMs: duration,
			},
			'Multi-repository search completed',
		);

		return mergedResults;
	}

	/**
	 * Search within a single repository
	 */
	async searchRepository(
		repository: string,
		query: string,
		options?: {
			maxResults?: number;
			fileFilter?: string[];
			languageFilter?: string[];
		},
	): Promise<SearchResult[]> {
		const orchestrator = this.orchestrators.get(repository);
		if (!orchestrator) {
			throw new Error(`Repository not found: ${repository}`);
		}

		logger.info({ repository, query }, 'Searching single repository');

		const results = await orchestrator.search(query, options);

		// Add repository metadata
		const repoConfig = this.repositories.get(repository)!;
		return results.map((result) => ({
			...result,
			metadata: {
				...result.metadata,
				repository,
				repositoryTeam: repoConfig.team,
				repositoryProduct: repoConfig.product,
			},
		}));
	}

	/**
	 * Search repositories by team
	 */
	async searchByTeam(team: string, query: string, options?: MultiRepoSearchOptions): Promise<SearchResult[]> {
		const teamRepos = Array.from(this.repositories.values())
			.filter((repo) => repo.team === team)
			.map((repo) => repo.name);

		logger.info({ team, repositoryCount: teamRepos.length }, 'Searching repositories by team');

		return this.searchAcrossRepositories(query, {
			...options,
			repositories: teamRepos,
		});
	}

	/**
	 * Search repositories by product
	 */
	async searchByProduct(product: string, query: string, options?: MultiRepoSearchOptions): Promise<SearchResult[]> {
		const productRepos = Array.from(this.repositories.values())
			.filter((repo) => repo.product === product)
			.map((repo) => repo.name);

		logger.info({ product, repositoryCount: productRepos.length }, 'Searching repositories by product');

		return this.searchAcrossRepositories(query, {
			...options,
			repositories: productRepos,
		});
	}

	/**
	 * Index a specific repository
	 */
	async indexRepository(
		repository: string,
		repoPath: string,
		options?: {
			incremental?: boolean;
			config?: VectorStoreConfig;
		},
	): Promise<void> {
		const orchestrator = this.orchestrators.get(repository);
		if (!orchestrator) {
			throw new Error(`Repository not found: ${repository}`);
		}

		logger.info({ repository, repoPath, incremental: options?.incremental }, 'Indexing repository');

		return orchestrator.indexRepository(repoPath, options);
	}

	/**
	 * Get list of available repositories
	 */
	getRepositories(): RepositoryConfig[] {
		return Array.from(this.repositories.values());
	}

	/**
	 * Get repository configuration by name
	 */
	getRepository(name: string): RepositoryConfig | undefined {
		return this.repositories.get(name);
	}

	/**
	 * Get repositories by team
	 */
	getRepositoriesByTeam(team: string): RepositoryConfig[] {
		return Array.from(this.repositories.values()).filter((repo) => repo.team === team);
	}

	/**
	 * Get repositories by product
	 */
	getRepositoriesByProduct(product: string): RepositoryConfig[] {
		return Array.from(this.repositories.values()).filter((repo) => repo.product === product);
	}
}
