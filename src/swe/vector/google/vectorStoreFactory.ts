import { getFileSystem } from '#agent/agentContextUtils';
import { Git } from '#functions/scm/git';
import { VectorStore } from '../vector';
import { getGoogleVectorServiceConfig } from './googleVectorConfig';
import { GoogleVectorStore, sanitizeGitUrlForDataStoreId } from './googleVectorService';

/**
 * Creates and returns a VectorStore instance configured for the repository
 * in the specified directory.
 * @param repoPath The path to the root of the git repository.
 * @returns A promise that resolves to a configured VectorStore instance.
 */
export async function createGoogleVectorService(repoPath: string): Promise<VectorStore> {
	// const vcs = getFileSystem().getVcs();
	// if (!vcs) throw new Error('Could not determine git origin URL for the current repository')

	const git = new Git(getFileSystem());
	const originUrl = await git.getGitOriginUrl();
	if (!originUrl) {
		throw new Error('Could not determine git origin URL for the current repository');
	}
	const dataStoreId = sanitizeGitUrlForDataStoreId(originUrl);

	const config = getGoogleVectorServiceConfig();
	return new GoogleVectorStore({
		...config,
		dataStoreId: dataStoreId,
	});
}
