interface IExample {
	code: string;
	reviewComment: string;
}

// The code review fastify route schema and angular form group names must match the interface property names
export interface CodeReviewConfig {
	id: string;
	title: string;
	enabled: boolean;
	description: string;
	fileExtensions: {
		include: string[];
	};
	requires: {
		text: string[];
	};
	tags: string[];
	projectPaths: string[];
	examples: IExample[];
}

/**
 * Represents the structure of the entire Firestore document
 * used for caching clean code reviews for a Merge Request.
 */
export type MergeRequestFingerprintCache = {
	/** Unix timestamp (milliseconds) of the last update */
	lastUpdated: number;
	/** Set containing the unique fingerprint hashes marked as clean */
	fingerprints: Set<string>;
};

/**
 * Default empty cache structure used when no cache exists or on error.
 * Note: Creates a new Set each time to avoid shared references.
 */
export const EMPTY_CACHE = (): MergeRequestFingerprintCache => ({
	lastUpdated: 0,
	fingerprints: new Set<string>(),
});

// Interface for review results might also live here or near GitLabCodeReview
export interface DiffReviewComment {
	lineNumber: number;
	comment: string; // Markdown format expected
}

export interface DiffReview {
	code: string; // The code snippet sent to the LLM
	comments: DiffReviewComment[];
	// mrDiff: MergeRequestDiffSchema; // Assuming this type comes from GitLab client library
	// reviewConfig: CodeReviewConfig; // Assuming CodeReviewConfig is defined
}

export function codeReviewToXml(codeReview: CodeReviewConfig): string {
	let xml = '<code-review-config>';

	xml += `<title>${codeReview.title}</title>`;
	xml += `<description>\n${codeReview.description}\n</description>`;

	xml += '<examples>';
	for (const example of codeReview.examples) {
		xml += '<example>';
		xml += `<code><![CDATA[\n${example.code}\n]]></code>`;
		xml += `<review_comment><![CDATA[\n${example.reviewComment}\n]]></review_comment>`;
		xml += '</example>';
	}
	xml += '</examples>\n</code-review-config>';

	return xml;
}
