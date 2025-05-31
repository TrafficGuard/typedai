import type { CodeReviewConfig } from '#shared/codeReview/codeReview.model';
import type { CodeReviewService } from '#swe/codeReview/codeReviewService';
import type { CodeReviewFingerprintCache } from '#swe/codeReview/codeReviewTaskModel';
import { Db } from 'mongodb';

export class MongoCodeReviewService implements CodeReviewService {
	constructor(private db: Db) {}

	async getCodeReviewConfig(id: string): Promise<CodeReviewConfig | null> {
		// TODO: Implement method
		throw new Error('Method not implemented.');
	}

	async listCodeReviewConfigs(): Promise<CodeReviewConfig[]> {
		// TODO: Implement method
		throw new Error('Method not implemented.');
	}

	async createCodeReviewConfig(config: Omit<CodeReviewConfig, 'id'>): Promise<string> {
		// TODO: Implement method
		throw new Error('Method not implemented.');
	}

	async updateCodeReviewConfig(id: string, config: Partial<CodeReviewConfig>): Promise<void> {
		// TODO: Implement method
		throw new Error('Method not implemented.');
	}

	async deleteCodeReviewConfig(id: string): Promise<void> {
		// TODO: Implement method
		throw new Error('Method not implemented.');
	}

	async getMergeRequestReviewCache(projectId: string | number, mrIid: number): Promise<CodeReviewFingerprintCache> {
		// TODO: Implement method
		throw new Error('Method not implemented.');
	}

	async updateMergeRequestReviewCache(projectId: string | number, mrIid: number, fingerprintsToSave: CodeReviewFingerprintCache): Promise<void> {
		// TODO: Implement method
		throw new Error('Method not implemented.');
	}
}
