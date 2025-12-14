import { expect } from 'chai';
import { describe, it } from 'mocha';
import { setupConditionalLoggerOutput } from '#test/testUtils';
import { DiscoveryEngine } from './discoveryEngine';
import type { GoogleVectorServiceConfig } from './googleVectorConfig';

class FakeDocumentClient {
	public deletedNames: string[] = [];
	private readonly documents: any[];

	constructor(documents: any[]) {
		this.documents = documents;
	}

	listDocumentsAsync() {
		const docs = this.documents;
		return {
			async *[Symbol.asyncIterator]() {
				for (const doc of docs) {
					yield doc;
				}
			},
		};
	}

	async deleteDocument(request: { name: string }) {
		this.deletedNames.push(request.name);
		return [{}];
	}
}

class FakeDataStoreClient {
	async getDataStore() {
		return [{}];
	}
}

const baseConfig: GoogleVectorServiceConfig = {
	project: 'test',
	region: 'global',
	discoveryEngineLocation: 'global',
	collection: 'default_collection',
	dataStoreId: 'repo',
	embeddingModel: 'model',
};

const branchPath = 'projects/test/locations/global/collections/default_collection/dataStores/repo/branches/default_branch';

const createDocument = (name: string, filePath: string) => ({
	name,
	structData: {
		fields: {
			filePath: { stringValue: filePath },
		},
	},
});

describe('DiscoveryEngine purgeDocuments', () => {
	setupConditionalLoggerOutput();

	it('deletes matching documents for provided file paths', async () => {
		const documentClient = new FakeDocumentClient([
			createDocument(`${branchPath}/documents/docA`, 'src/foo.ts'),
			createDocument(`${branchPath}/documents/docB`, 'src/bar.ts'),
		]);
		const engine = new DiscoveryEngine(baseConfig, undefined, {
			documentClient: documentClient as any,
			dataStoreClient: new FakeDataStoreClient() as any,
			searchClient: {} as any,
		});

		await engine.purgeDocuments(['src/bar.ts']);

		expect(documentClient.deletedNames).to.deep.equal([`${branchPath}/documents/docB`]);
	});

	it('skips purge when no documents match file paths', async () => {
		const documentClient = new FakeDocumentClient([createDocument(`${branchPath}/documents/docA`, 'src/foo.ts')]);
		const engine = new DiscoveryEngine(baseConfig, undefined, {
			documentClient: documentClient as any,
			dataStoreClient: new FakeDataStoreClient() as any,
			searchClient: {} as any,
		});

		await engine.purgeDocuments(['src/missing.ts']);

		expect(documentClient.deletedNames).to.be.empty;
	});
});
