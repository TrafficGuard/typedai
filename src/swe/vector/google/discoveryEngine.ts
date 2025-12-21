import { DataStoreServiceClient, DocumentServiceClient, SearchServiceClient } from '@google-cloud/discoveryengine';
import { google } from '@google-cloud/discoveryengine/build/protos/protos';
import { cacheRetry } from '#cache/cacheRetry';
import { logger } from '#o11y/logger';
import { quotaRetry } from '#utils/quotaRetry';
import { RateLimitCircuitBreaker, type RateLimitCircuitBreakerConfig } from '#utils/rateLimitCircuitBreaker';
import {
	CIRCUIT_BREAKER_FAILURE_THRESHOLD,
	CIRCUIT_BREAKER_RETRY_INTERVAL_MS,
	CIRCUIT_BREAKER_SUCCESS_THRESHOLD,
	GoogleVectorServiceConfig,
} from './googleVectorConfig';

/**
 * Vector Search engine using Google AI Application Vertex AI Search (Discovery Engine)
 * https://cloud.google.com/generative-ai-app-builder/docs/create-datastore-ingest
 * https://cloud.google.com/generative-ai-app-builder/docs/create-data-store-es#api-json
 * https://cloud.google.com/generative-ai-app-builder/docs/configure-field-settings
 * https://cloud.google.com/nodejs/docs/reference/discoveryengine/latest
 */
type DiscoveryEngineClients = {
	documentClient?: DocumentServiceClient;
	searchClient?: SearchServiceClient;
	dataStoreClient?: DataStoreServiceClient;
};

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
	private branchPath: string;
	private circuitBreaker: RateLimitCircuitBreaker;

	constructor(config: GoogleVectorServiceConfig, circuitBreakerConfig?: RateLimitCircuitBreakerConfig, clients?: DiscoveryEngineClients) {
		this.project = config.project;
		this.location = config.discoveryEngineLocation;
		this.collection = config.collection;
		this.dataStoreId = config.dataStoreId;

		// Client options - pass projectId to ensure correct project is used for API calls
		const clientOptions = {
			apiEndpoint: `${config.discoveryEngineLocation}-discoveryengine.googleapis.com`,
			projectId: config.project,
		};

		this.documentClient = clients?.documentClient || new DocumentServiceClient(clientOptions);
		this.searchClient = clients?.searchClient || new SearchServiceClient(clientOptions);
		this.dataStoreClient = clients?.dataStoreClient || new DataStoreServiceClient(clientOptions);
		this.parentPath = `projects/${this.project}/locations/${this.location}/collections/${this.collection}`;
		this.datastoreName = `${this.parentPath}/dataStores/${this.dataStoreId}`;
		this.dataStorePath = this.datastoreName;
		this.branchPath = `${this.datastoreName}/branches/default_branch`;

		// Initialize circuit breaker with config or defaults
		this.circuitBreaker = new RateLimitCircuitBreaker(
			circuitBreakerConfig || {
				serviceName: 'Discovery Engine',
				retryIntervalMs: CIRCUIT_BREAKER_RETRY_INTERVAL_MS,
				failureThreshold: CIRCUIT_BREAKER_FAILURE_THRESHOLD,
				successThreshold: CIRCUIT_BREAKER_SUCCESS_THRESHOLD,
			},
		);
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

	async importDocuments(documents: google.cloud.discoveryengine.v1.IDocument[]): Promise<void> {
		if (documents.length === 0) return;

		// Execute through circuit breaker for quota management
		await this.circuitBreaker.execute(async () => {
			await this._importDocumentsInternal(documents);
		});
	}

	/**
	 * Internal import method with retry decorators
	 * Circuit breaker wraps this to handle quota exhaustion
	 */
	@cacheRetry({ retries: 3, backOffMs: 1000 })
	@quotaRetry()
	private async _importDocumentsInternal(documents: google.cloud.discoveryengine.v1.IDocument[]): Promise<void> {
		await this.ensureDataStoreExists();

		const request: google.cloud.discoveryengine.v1.IImportDocumentsRequest = {
			parent: this.branchPath,
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
	 * Get circuit breaker for status monitoring
	 */
	getCircuitBreaker(): RateLimitCircuitBreaker {
		return this.circuitBreaker;
	}

	/**
	 * https://cloud.google.com/generative-ai-app-builder/docs/delete-datastores#discoveryengine_v1_generated_DocumentService_PurgeDocuments_sync-nodejs
	 */
	async purgeAllDocuments(): Promise<void> {
		await this.ensureDataStoreExists();

		const request: google.cloud.discoveryengine.v1.IPurgeDocumentsRequest = {
			parent: this.branchPath,
			filter: '*',
			force: true,
		};
		const [operation] = await this.documentClient.purgeDocuments(request);
		await operation.promise();
	}

	async purgeDocuments(filePaths: string[]): Promise<number> {
		if (filePaths.length === 0) return 0;
		await this.ensureDataStoreExists();

		const targets = new Set(filePaths);
		logger.info({ targetCount: targets.size }, 'Purging documents for deleted files');

		const documentNames = await this.findDocumentNamesByFilePath(targets);

		if (documentNames.length === 0) {
			logger.info('No matching documents found to purge');
			return 0;
		}

		for (const name of documentNames) {
			await this.documentClient.deleteDocument({ name });
			logger.debug({ documentName: name }, 'Deleted Discovery Engine document');
		}

		return documentNames.length;
	}

	async search(searchRequest: google.cloud.discoveryengine.v1.ISearchRequest): Promise<google.cloud.discoveryengine.v1.SearchResponse.ISearchResult[]> {
		const start = Date.now();
		const [results] = await this.searchClient.search(searchRequest, { autoPaginate: false });
		logger.info(`DiscoveryEngine vector search completed in ${((Date.now() - start) / 1000).toFixed(1)}s`);
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
		const parent = this.branchPath;

		try {
			// autoPaginate: false is required to respect pageSize, otherwise the client fetches all documents
			const [documents] = await this.documentClient.listDocuments(
				{
					parent,
					pageSize,
				},
				{ autoPaginate: false },
			);

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
		const name = `${this.branchPath}/documents/${documentId}`;

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

	private async findDocumentNamesByFilePath(targets: Set<string>): Promise<string[]> {
		const matchingNames: string[] = [];
		try {
			const iterable = this.documentClient.listDocumentsAsync({
				parent: this.branchPath,
				pageSize: 100,
			});

			for await (const document of iterable) {
				const filePath = document.structData?.fields?.filePath?.stringValue;
				if (filePath && document.name && targets.has(filePath)) {
					matchingNames.push(document.name);
				}
			}
		} catch (error) {
			logger.error({ error }, 'Failed to list documents while purging specific files');
			throw error;
		}
		return matchingNames;
	}
}
