/**
 * Represents a document, typically a code file, for embedding and search.
 */
export interface CodeDoc {
	/**
	 * The title of the document, often representing the file path.
	 */
	title: string;
	/**
	 * The textual content of the document, e.g., source code.
	 */
	text: string;
}

/**
 * A collection of CodeDoc objects, indexed by a string key (e.g., file path or a unique ID).
 */
export type Corpus = Record<string, CodeDoc>;
