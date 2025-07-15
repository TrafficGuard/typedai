export interface VectorSearch {
	/**
	 * Search for documents similar to the query
	 * @param query the search query
	 * @param maxResults (optional) the maximum number of results to return
	 */
	search(query: string, maxResults?: number): Promise<SearchResult[]>;
}

export interface SearchResult {
	id: string; // document id
	score: number; // similarity score
	document: {
		filePath: string;
		functionName?: string;
		startLine: number;
		endLine: number;
		language: string;
		naturalLanguageDescription: string;
		originalCode: string;
	};
}

export interface VectorIndex {
	/**
	 * Initial index of a repository
	 * @param rootDir the root directory of the repository
	 * @param subFolder (optional) only index files under this sub folder
	 */
	indexRepository(rootDir: string, subFolder?: string): Promise<void>;

	// TODO incremental update
}

export interface VectorStore extends VectorIndex, VectorSearch {}
