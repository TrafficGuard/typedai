import type { CodeReviewConfig, MergeRequestFingerprintCache } from '#swe/codeReview/codeReviewModel';
import { EMPTY_CACHE } from '#swe/codeReview/codeReviewModel';
import type { CodeReviewService } from '#swe/codeReview/codeReviewService';

export class InMemoryCodeReviewService implements CodeReviewService {
	private configStore: Map<string, CodeReviewConfig> = new Map<string, CodeReviewConfig>();
	// Store MR cache using a composite key: "projectId|mrIid"
	private mrCacheStore: Map<string, MergeRequestFingerprintCache> = new Map<string, MergeRequestFingerprintCache>();

	private generateId(): string {
		return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
	}

	// --- Helper for MR Cache Key ---
	private getMRCacheKey(projectId: string | number, mrIid: number): string {
		return `${projectId}|${mrIid}`;
	}

	// --- Config Methods ---
	async getCodeReviewConfig(id: string): Promise<CodeReviewConfig | null> {
		return this.configStore.get(id) || null;
	}

	async listCodeReviewConfigs(): Promise<CodeReviewConfig[]> {
		return Array.from(this.configStore.values());
	}

	async createCodeReviewConfig(config: Omit<CodeReviewConfig, 'id'>): Promise<string> {
		const id = this.generateId();
		this.configStore.set(id, { ...config, id });
		return id;
	}

	async updateCodeReviewConfig(id: string, config: Partial<CodeReviewConfig>): Promise<void> {
		const existingConfig = this.configStore.get(id);
		if (existingConfig) {
			this.configStore.set(id, { ...existingConfig, ...config });
		}
		// Note: Unlike Firestore, this won't throw if the ID doesn't exist.
		// The shared test accounts for this implementation difference.
	}

	async deleteCodeReviewConfig(id: string): Promise<void> {
		this.configStore.delete(id);
	}

	// --- MR Cache Methods ---
	async getMergeRequestReviewCache(projectId: string | number, mrIid: number): Promise<MergeRequestFingerprintCache> {
		const key = this.getMRCacheKey(projectId, mrIid);
		const cached = this.mrCacheStore.get(key);
		// Return a copy to prevent direct modification of the stored object/Set
		return cached ? { ...cached, fingerprints: new Set(cached.fingerprints) } : EMPTY_CACHE();
	}

	async updateMergeRequestReviewCache(projectId: string | number, mrIid: number, cacheObject: MergeRequestFingerprintCache): Promise<void> {
		const key = this.getMRCacheKey(projectId, mrIid);
		const dataToStore: MergeRequestFingerprintCache = {
			lastUpdated: Date.now(),
			// Store a copy of the Set to prevent external modifications affecting the cache
			fingerprints: new Set(cacheObject.fingerprints),
		};
		this.mrCacheStore.set(key, dataToStore);
	}

	// cleanupExpiredFingerprints(projectId: string | number, mrIid: number): Promise<void> {
	// 	// Optional: Implement cleanup logic if needed for the in-memory version
	// 	return Promise.resolve();
	// }
}
