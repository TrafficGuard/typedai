import type { MergeRequestDiffSchema } from '@gitbeaker/rest';

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
 * AI review of a git diff
 */
export interface CodeReviewResult {
	task: CodeReviewTask;
	/** Code review comments */
	comments: Array<{ comment: string; lineNumber: number }>;
}

export interface CodeReviewTask {
	config: CodeReviewConfig;
	diff: MergeRequestDiffSchema;
	// Code string with line number comments for the LLM to identify the line to post a review comment
	codeWithLineNums: string;
	// Raw code from the diff
	code: string;
	// Fingerprint generated using raw code line numbers, so it isn't affected by further MR commits moving the starting position of the code block.
	fingerprint: string;
}

/**
 * Caches a fingerprint of a reviewed diff so a merge/pull request can be re-reviewed after
 * new commits, and not have the unchanged diffs be re-reviewed.
 */
export type CodeReviewFingerprintCache = {
	/** Unix timestamp (milliseconds) of the last update */
	lastUpdated: number;
	/** Set containing the unique fingerprint hashes marked as clean */
	fingerprints: Set<string>;
	hashes?: Map<string, Set<string>>;
};

/**
 * Default empty cache structure used when no cache exists or on error.
 * Note: Creates a new Set each time to avoid shared references.
 */
export const EMPTY_CACHE = (): CodeReviewFingerprintCache => ({
	lastUpdated: 0,
	fingerprints: new Set(),
	hashes: new Map(),
});

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
