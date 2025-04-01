import { MergeRequestFingerprintCache } from '#firestore/firestoreCodeReviewService';
import { CodeReviewConfig } from '#swe/codeReview/codeReviewModel';
import { CodeReviewService } from '#swe/codeReview/codeReviewService';

export class InMemoryCodeReviewService implements CodeReviewService {
	private store: Map<string, CodeReviewConfig> = new Map<string, CodeReviewConfig>();

	private generateId(): string {
		return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
	}

	async getCodeReviewConfig(id: string): Promise<CodeReviewConfig | null> {
		return this.store.get(id) || null;
	}

	async listCodeReviewConfigs(): Promise<CodeReviewConfig[]> {
		return Array.from(this.store.values());
	}

	async createCodeReviewConfig(config: Omit<CodeReviewConfig, 'id'>): Promise<string> {
		const id = this.generateId();
		this.store.set(id, { ...config, id });
		return id;
	}

	async updateCodeReviewConfig(id: string, config: Partial<CodeReviewConfig>): Promise<void> {
		const existingConfig = this.store.get(id);
		if (existingConfig) {
			this.store.set(id, { ...existingConfig, ...config });
		}
	}

	async deleteCodeReviewConfig(id: string): Promise<void> {
		this.store.delete(id);
	}

	cleanupExpiredFingerprints(projectId: string | number, mrIid: number): Promise<void> {
		return Promise.resolve(undefined);
	}

	getMergeRequestReviewCache(projectId: string | number, mrIid: number): Promise<MergeRequestFingerprintCache> {
		return Promise.resolve(undefined);
	}

	updateMergeRequestReviewCache(projectId: string | number, mrIid: number, fingerprintsToSave: MergeRequestFingerprintCache): Promise<void> {
		return Promise.resolve(undefined);
	}
}
