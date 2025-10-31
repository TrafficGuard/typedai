import { DataStoreServiceClient, DocumentServiceClient, SearchServiceClient } from '@google-cloud/discoveryengine';
import { google } from '@google-cloud/discoveryengine/build/protos/protos';
import pino from 'pino';
import { RetryableError, cacheRetry } from '#cache/cacheRetry';
import { sleep } from '#utils/async-utils';
import { quotaRetry } from '#utils/quotaRetry';
import { CodeFile } from '../codeLoader';
import { GoogleVectorServiceConfig } from './googleVectorConfig';

const logger = pino({ name: 'DiscoveryEngineDataStore' });

/**
 * Vector Search engine using Google AI Application Vertex AI Search (Discovery Engine)
 * https://cloud.google.com/generative-ai-app-builder/docs/create-datastore-ingest
 * https://cloud.google.com/generative-ai-app-builder/docs/create-data-store-es#api-json
 * https://cloud.google.com/generative-ai-app-builder/docs/configure-field-settings
 * https://cloud.google.com/nodejs/docs/reference/discoveryengine/latest
 */
export class DiscoveryEngine {
	private readonly project: string;
	private readonly location: string;
	private readonly collection: string;
	private readonly dataStoreId: string;
	private dataStoreClient: DataStoreServiceClient;
	private documentClient: DocumentServiceClient;
	private searchClient: SearchServiceClient;
	private dataStorePath: string | null = null;
	private parentPath: string;
	private datastoreName: string;

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
		this.parentPath = `projects/${this.project}/locations/${this.location}/collections/${this.collection}`;
		this.datastoreName = `${this.parentPath}/dataStores/${this.dataStoreId}`;
		this.dataStorePath = this.datastoreName;
	}

	async ensureDataStoreExists(): Promise<void> {
		try {
			await this.dataStoreClient.getDataStore({ name: this.datastoreName });
		} catch (error: any) {
			if (error.code === 5) {
				// gRPC code for NOT_FOUND
				logger.warn(`Data store "${this.dataStoreId}" not found. Creating...`);
				const [operation] = await this.dataStoreClient.createDataStore({
					parent: this.parentPath,
					dataStoreId: this.dataStoreId,
					dataStore: {
						displayName: `Repo: ${this.dataStoreId}`,
						industryVertical: 'GENERIC',
						solutionTypes: [google.cloud.discoveryengine.v1.SolutionType.SOLUTION_TYPE_SEARCH],
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
	}

	@cacheRetry({ retries: 3, backOffMs: 1000 })
	@quotaRetry()
	async importDocuments(documents: google.cloud.discoveryengine.v1.IDocument[]): Promise<void> {
		if (documents.length === 0) return;
		await this.ensureDataStoreExists();

		const request: google.cloud.discoveryengine.v1.IImportDocumentsRequest = {
			parent: `${this.dataStorePath}/branches/default_branch`,
			inlineSource: { documents },
			reconciliationMode: google.cloud.discoveryengine.v1.ImportDocumentsRequest.ReconciliationMode.INCREMENTAL,
		};

		const operationStart = Date.now();
		const [operation] = await this.documentClient.importDocuments(request);
		logger.info({ operationName: operation.name, documentCount: documents.length }, 'ImportDocuments operation started');

		await operation.promise(); // wait until the import operation completes
		const operationDuration = Date.now() - operationStart;
		logger.info(
			{
				operationName: operation.name,
				documentCount: documents.length,
				durationMs: operationDuration,
				durationSeconds: (operationDuration / 1000).toFixed(1),
			},
			'ImportDocuments operation completed - documents may take additional time to become searchable due to eventual consistency',
		);
	}

	/**
	 * https://cloud.google.com/generative-ai-app-builder/docs/delete-datastores#discoveryengine_v1_generated_DocumentService_PurgeDocuments_sync-nodejs
	 */
	async purgeAllDocuments(): Promise<void> {
		const request: google.cloud.discoveryengine.v1.IPurgeDocumentsRequest = {
			parent: this.parentPath,
			filter: '*',
		};
		const [operation] = await this.documentClient.purgeDocuments(request);
		await operation.promise();
	}

	async purgeDocuments(filePaths: string[]): Promise<void> {
		logger.warn('purging not implemented');
		if (filePaths.length) return; // this is broken atm
		if (filePaths.length === 0) return;
		await this.ensureDataStoreExists();
		logger.info(`Purging documents for ${filePaths.length} file(s)...`);

		const BATCH_SIZE_PURGE = 20;
		for (let i = 0; i < filePaths.length; i += BATCH_SIZE_PURGE) {
			const batchFilePaths = filePaths.slice(i, i + BATCH_SIZE_PURGE);
			const filter = batchFilePaths.map((p) => `uri = "${p}"`).join(' OR ');

			const request: google.cloud.discoveryengine.v1.IPurgeDocumentsRequest = {
				parent: `${this.dataStorePath}/branches/default_branch`,
				filter: filter,
				force: true,
			};

			const [operation] = await this.documentClient.purgeDocuments(request);
			logger.info(`PurgeDocuments operation started for ${batchFilePaths.length} files: ${operation.name}`);
			await operation.promise(); // wait until the purge finishes
		}
	}

	async search(searchRequest: google.cloud.discoveryengine.v1.ISearchRequest): Promise<google.cloud.discoveryengine.v1.SearchResponse.ISearchResult[]> {
		const start = Date.now();
		const [results] = await this.searchClient.search(searchRequest, { autoPaginate: false });
		console.log(`Search completed in ${Date.now() - start}ms`);
		return results;
	}

	getServingConfigPath(): string {
		return this.searchClient.projectLocationDataStoreServingConfigPath(this.project, this.location, this.dataStoreId, 'default_config');
	}

	async deleteDataStore(): Promise<void> {
		try {
			const [operation] = await this.dataStoreClient.deleteDataStore({ name: this.dataStorePath });
			await operation.promise();
			logger.info(`Successfully deleted data store "${this.dataStorePath}".`);
		} catch (error: any) {
			if (error.code === 5) {
				logger.info(`Data store "${this.dataStorePath}" does not exist.`);
				return;
			}
			logger.error({ error }, `Failed to delete data store "${this.dataStorePath}".`);
			throw error;
		}
	}

	/**
	 * Lists all documents in the data store for diagnostic purposes
	 */
	async listDocuments(pageSize = 100): Promise<google.cloud.discoveryengine.v1.IDocument[]> {
		await this.ensureDataStoreExists();
		const parent = `${this.dataStorePath}/branches/default_branch`;

		try {
			const [documents] = await this.documentClient.listDocuments({
				parent,
				pageSize,
			});

			logger.info(`Found ${documents.length} documents in data store`);
			return documents;
		} catch (error: any) {
			logger.error({ error }, 'Failed to list documents');
			throw error;
		}
	}

	/**
	 * Gets a specific document by ID for diagnostic purposes
	 */
	async getDocument(documentId: string): Promise<google.cloud.discoveryengine.v1.IDocument | null> {
		await this.ensureDataStoreExists();
		const name = `${this.dataStorePath}/branches/default_branch/documents/${documentId}`;

		try {
			const [document] = await this.documentClient.getDocument({ name });
			logger.info({ documentId }, 'Retrieved document');
			return document;
		} catch (error: any) {
			if (error.code === 5) {
				logger.warn({ documentId }, 'Document not found');
				return null;
			}
			logger.error({ error, documentId }, 'Failed to get document');
			throw error;
		}
	}

	/**
	 * Gets the current data store info for diagnostic purposes
	 */
	async getDataStoreInfo(): Promise<any> {
		try {
			const [dataStore] = await this.dataStoreClient.getDataStore({ name: this.datastoreName });
			logger.info({ dataStore }, 'Data store info retrieved');
			return dataStore;
		} catch (error: any) {
			logger.error({ error }, 'Failed to get data store info');
			throw error;
		}
	}
}
