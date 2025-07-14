export interface VectorSearch {
	search(query: string, maxResults: number): Promise<SearchResult[]>;
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
	 * Full index of a repository
	 * @param rootDir
	 */
	indexRepository(rootDir: string): Promise<void>;

	// TODO incremental update
}

export interface VectorStore extends VectorIndex, VectorSearch {}
