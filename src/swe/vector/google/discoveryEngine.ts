import { DataStoreServiceClient, DocumentServiceClient, SearchServiceClient } from '@google-cloud/discoveryengine';
import { google } from '@google-cloud/discoveryengine/build/protos/protos';
import pino from 'pino';
import { sleep } from '#utils/async-utils';
import { GoogleVectorServiceConfig } from './config';

const logger = pino({ name: 'DiscoveryEngineDataStore' });

const MAX_RETRIES = 3;
const INITIAL_RETRY_DELAY_MS = 1000;
const RETRY_DELAY_MULTIPLIER = 2;

export class DiscoveryEngine {
	private readonly project: string;
	private readonly location: string;
	private readonly collection: string;
	private dataStoreId: string;
	private dataStoreClient: DataStoreServiceClient;
	private documentClient: DocumentServiceClient;
	private searchClient: SearchServiceClient;
	private dataStorePath: string | null = null;

	constructor(config: GoogleVectorServiceConfig) {
		this.project = config.project;
		this.location = config.discoveryEngineLocation;
		this.collection = config.collection;
		this.dataStoreId = config.dataStoreId;

		this.documentClient = new DocumentServiceClient({
			apiEndpoint: `${config.discoveryEngineLocation}-discoveryengine.googleapis.com`,
		});
		this.searchClient = new SearchServiceClient({
			apiEndpoint: `${config.discoveryEngineLocation}-discoveryengine.googleapis.com`,
		});
		this.dataStoreClient = new DataStoreServiceClient({
			apiEndpoint: `${config.discoveryEngineLocation}-discoveryengine.googleapis.com`,
		});
	}

	async ensureDataStoreExists(): Promise<string> {
		if (this.dataStorePath) return this.dataStorePath;

		const parent = `projects/${this.project}/locations/${this.location}/collections/${this.collection}`;
		const prospectivePath = `${parent}/dataStores/${this.dataStoreId}`;

		try {
			await this.dataStoreClient.getDataStore({ name: prospectivePath });
			logger.info(`Data store "${this.dataStoreId}" already exists.`);
		} catch (error: any) {
			if (error.code === 5) {
				// gRPC code for NOT_FOUND
				logger.warn(`Data store "${this.dataStoreId}" not found. Creating...`);
				const [operation] = await this.dataStoreClient.createDataStore({
					parent,
					dataStoreId: this.dataStoreId,
					dataStore: {
						displayName: `Repo: ${this.dataStoreId}`,
						industryVertical: 'GENERIC',
						solutionTypes: [google.cloud.discoveryengine.v1beta.SolutionType.SOLUTION_TYPE_SEARCH],
						contentConfig: 'NO_CONTENT',
					},
				});
				await operation.promise();
				logger.info(`Successfully created data store "${this.dataStoreId}".`);
			} else {
				logger.error({ error }, `Failed to get or create data store "${this.dataStoreId}".`);
				throw error;
			}
		}
		this.dataStorePath = prospectivePath;
		return this.dataStorePath;
	}

	async importDocuments(documents: google.cloud.discoveryengine.v1beta.IDocument[]): Promise<void> {
		if (documents.length === 0) return;
		const dataStorePath = await this.ensureDataStoreExists();

		const request: google.cloud.discoveryengine.v1beta.IImportDocumentsRequest = {
			parent: `${dataStorePath}/branches/default_branch`,
			inlineSource: { documents },
			reconciliationMode: google.cloud.discoveryengine.v1beta.ImportDocumentsRequest.ReconciliationMode.INCREMENTAL,
		};

		for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
			try {
				const [operation] = await this.documentClient.importDocuments(request);
				logger.info(`ImportDocuments operation started: ${operation.name}`);
				await operation.promise(); // wait until the indexing finishes
				return;
			} catch (apiError: any) {
				const delay = INITIAL_RETRY_DELAY_MS * RETRY_DELAY_MULTIPLIER ** attempt;
				logger.error({ err: apiError, attempt: attempt + 1, delay }, 'API call failed for importDocuments. Retrying...');
				if (attempt < MAX_RETRIES - 1) {
					await sleep(delay);
				} else {
					logger.error(`All ${MAX_RETRIES} retries failed for importDocuments. Skipping batch.`);
					throw apiError;
				}
			}
		}
	}

	async purgeDocuments(filePaths: string[]): Promise<void> {
		if (filePaths.length === 0) return;
		const dataStorePath = await this.ensureDataStoreExists();
		logger.info(`Purging documents for ${filePaths.length} file(s)...`);

		const BATCH_SIZE_PURGE = 20;
		for (let i = 0; i < filePaths.length; i += BATCH_SIZE_PURGE) {
			const batchFilePaths = filePaths.slice(i, i + BATCH_SIZE_PURGE);
			const filter = batchFilePaths.map((p) => `struct_field("file_path") = "${p}"`).join(' OR ');

			const request: google.cloud.discoveryengine.v1beta.IPurgeDocumentsRequest = {
				parent: `${dataStorePath}/branches/default_branch`,
				filter: filter,
				force: true,
			};

			try {
				const [operation] = await this.documentClient.purgeDocuments(request);
				logger.info(`PurgeDocuments operation started for ${batchFilePaths.length} files: ${operation.name}`);
			} catch (error) {
				logger.error({ error, filter }, 'Failed to start PurgeDocuments operation.');
			}
		}
	}

	async search(searchRequest: google.cloud.discoveryengine.v1beta.ISearchRequest): Promise<google.cloud.discoveryengine.v1.SearchResponse.ISearchResult[]> {
		await this.ensureDataStoreExists();
		const [results] = await this.searchClient.search(searchRequest); // {autoPaginate: false}
		return results;
	}

	getServingConfigPath(): string {
		return this.searchClient.projectLocationDataStoreServingConfigPath(this.project, this.location, this.dataStoreId, 'default_config');
	}
}
