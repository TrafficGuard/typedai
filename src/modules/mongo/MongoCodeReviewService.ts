import { type Collection, type Db, ObjectId } from 'mongodb';
import type { CodeReviewConfig } from '#shared/codeReview/codeReview.model';
import type { CodeReviewService } from '#swe/codeReview/codeReviewService';
import type { CodeReviewFingerprintCache } from '#swe/codeReview/codeReviewTaskModel';

const CODE_REVIEW_CONFIGS_COLLECTION = 'codeReviewConfigs';

export class MongoCodeReviewService implements CodeReviewService {
	private readonly codeReviewConfigsCollection: Collection<any>;

	constructor(private db: Db) {
		this.codeReviewConfigsCollection = this.db.collection<any>(CODE_REVIEW_CONFIGS_COLLECTION);
	}

	async getCodeReviewConfig(id: string): Promise<CodeReviewConfig | null> {
		try {
			let objectId: ObjectId;
			try {
				objectId = new ObjectId(id);
			} catch (e) {
				// Consistent with MongoChatService.loadChat, throw an error for invalid ID format.
				// The outer catch block will log this error.
				throw new Error(`Invalid ID format for CodeReviewConfig: "${id}"`);
			}

			const doc = await this.codeReviewConfigsCollection.findOne({ _id: objectId });

			if (!doc) {
				return null;
			}

			// Map MongoDB document to CodeReviewConfig object
			// The 'doc' is of type 'any' or 'Document' from MongoDB driver.
			// Explicitly cast to access properties, or ensure proper typing if possible.
			const dbDoc = doc as any;

			const config: CodeReviewConfig = {
				id: dbDoc._id.toString(),
				title: dbDoc.title ?? '',
				enabled: dbDoc.enabled ?? false,
				description: dbDoc.description ?? '',
				fileExtensions: {
					include: dbDoc.fileExtensions?.include ?? [],
				},
				requires: {
					text: dbDoc.requires?.text ?? [],
				},
				tags: dbDoc.tags ?? [],
				projectPaths: dbDoc.projectPaths ?? [],
				examples: dbDoc.examples ?? [], // examples is IExample[]
			};
			return config;
		} catch (error) {
			// Log any errors and re-throw them.
			// Using console.error as per requirement and consistency with MongoChatService.
			console.error(`MongoCodeReviewService.getCodeReviewConfig: Error fetching config for id "${id}":`, error);
			throw error;
		}
	}

	async listCodeReviewConfigs(): Promise<CodeReviewConfig[]> {
		try {
			const mongoDocs = await this.codeReviewConfigsCollection.find({}).toArray();

			if (!mongoDocs || mongoDocs.length === 0) {
				return [];
			}

			return mongoDocs.map((doc: any) => {
				// Map MongoDB document to CodeReviewConfig object
				// Same mapping logic as in getCodeReviewConfig
				const dbDoc = doc as any;
				const config: CodeReviewConfig = {
					id: dbDoc._id.toString(),
					title: dbDoc.title ?? '',
					enabled: dbDoc.enabled ?? false,
					description: dbDoc.description ?? '',
					fileExtensions: {
						include: dbDoc.fileExtensions?.include ?? [],
					},
					requires: {
						text: dbDoc.requires?.text ?? [],
					},
					tags: dbDoc.tags ?? [],
					projectPaths: dbDoc.projectPaths ?? [],
					examples: dbDoc.examples ?? [],
				};
				return config;
			});
		} catch (error) {
			// Log any errors and re-throw them.
			console.error('MongoCodeReviewService.listCodeReviewConfigs: Error listing configs:', error);
			throw error;
		}
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
