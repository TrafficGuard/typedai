import { agentContext } from '#agent/agentContext';
import { cacheRetry } from '#cache/cacheRetry';
import { func, funcClass } from '#functionSchema/functionDecorators';
import { logger } from '#o11y/logger';
import { createVectorOrchestrator, isVectorSearchAvailable } from '#swe/vector/core/config';
import type { IVectorSearchOrchestrator, SearchResult as VectorSearchResult } from '#swe/vector/core/interfaces';

@funcClass(__filename)
export class VectorStore {
	/**
	 * Performs a vector search
	 * @param query - The search query.
	 * @returns
	 */
	@cacheRetry()
	@func()
	async search(vectorSearchQuery: string): Promise<any[]> {
		const fss = agentContext()?.fileSystem;
		if (!fss) throw new Error('Filesystem is not available');

		let vectorOrchestrator: IVectorSearchOrchestrator | null = null;

		const vcsRoot = fss.getVcsRoot();
		if (isVectorSearchAvailable(fss.getWorkingDirectory())) vectorOrchestrator = await createVectorOrchestrator(fss.getWorkingDirectory());
		else if (vcsRoot && isVectorSearchAvailable(vcsRoot)) vectorOrchestrator = await createVectorOrchestrator(vcsRoot);

		if (!vectorOrchestrator) throw new Error('No vector search configuration found');

		return vectorOrchestrator?.search(vectorSearchQuery);
	}
}
