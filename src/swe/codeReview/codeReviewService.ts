import type { CodeReviewConfig } from '#shared/model/codeReview.model';
import type { CodeReviewFingerprintCache } from '#swe/codeReview/codeReviewTaskModel';

export interface CodeReviewService {
	getCodeReviewConfig(id: string): Promise<CodeReviewConfig | null>;

	listCodeReviewConfigs(): Promise<CodeReviewConfig[]>;

	createCodeReviewConfig(config: Omit<CodeReviewConfig, 'id'>): Promise<string>;

	updateCodeReviewConfig(id: string, config: Partial<CodeReviewConfig>): Promise<void>;

	deleteCodeReviewConfig(id: string): Promise<void>;

	/** Loads the entire fingerprint cache map for a given Merge Request. */
	getMergeRequestReviewCache(projectId: string | number, mrIid: number): Promise<CodeReviewFingerprintCache>;

	/** Saves/updates the entire fingerprint cache map for a given Merge Request. */
	updateMergeRequestReviewCache(projectId: string | number, mrIid: number, fingerprintsToSave: CodeReviewFingerprintCache): Promise<void>;

	/** Optional: Method to clean up expired fingerprints within an MR document */
	// cleanupExpiredFingerprints(projectId: string | number, mrIid: number): Promise<void>;
}
