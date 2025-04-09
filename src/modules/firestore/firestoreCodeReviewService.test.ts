import { expect } from 'chai';
import sinon from 'sinon';
import type { CodeReviewConfig } from '#swe/codeReview/codeReviewModel';
import { FirestoreCodeReviewService } from './firestoreCodeReviewService';

describe('FirestoreCodeReviewService', () => {
	let service: FirestoreCodeReviewService;
	let mockFirestore: any;

	beforeEach(() => {
		mockFirestore = {
			doc: sinon.stub(),
			collection: sinon.stub(),
		};
		service = new FirestoreCodeReviewService();
		(service as any).db = mockFirestore;
	});

	afterEach(() => {
		sinon.restore();
	});

	describe('getCodeReviewConfig', () => {
		it('should return a code review config when it exists', async () => {
			const mockDocRef = {
				get: sinon.stub().resolves({
					exists: true,
					id: 'testId',
					data: () => ({ description: 'Test Config' }),
				}),
			};
			mockFirestore.doc.returns(mockDocRef);

			const result = await service.getCodeReviewConfig('testId');

			expect(result).to.deep.equal({
				id: 'testId',
				description: 'Test Config',
			});
			expect(mockFirestore.doc.calledWith('CodeReviewConfig/testId')).to.be.true;
		});

		it('should return null when the config does not exist', async () => {
			const mockDocRef = {
				get: sinon.stub().resolves({
					exists: false,
				}),
			};
			mockFirestore.doc.returns(mockDocRef);

			const result = await service.getCodeReviewConfig('nonExistentId');

			expect(result).to.be.null;
			expect(mockFirestore.doc.calledWith('CodeReviewConfig/nonExistentId')).to.be.true;
		});
	});

	describe('listCodeReviewConfigs', () => {
		it('should return an array of code review configs', async () => {
			const mockQuerySnapshot = {
				docs: [
					{ id: 'id1', data: () => ({ description: 'Config 1' }) },
					{ id: 'id2', data: () => ({ description: 'Config 2' }) },
				],
			};
			const mockCollectionRef = {
				get: sinon.stub().resolves(mockQuerySnapshot),
			};
			mockFirestore.collection.returns(mockCollectionRef);

			const result = await service.listCodeReviewConfigs();

			expect(result).to.deep.equal([
				{ id: 'id1', description: 'Config 1' },
				{ id: 'id2', description: 'Config 2' },
			]);
			expect(mockFirestore.collection.calledWith('CodeReviewConfig')).to.be.true;
		});
	});

	describe('createCodeReviewConfig', () => {
		it('should create a new code review config and return its id', async () => {
			const newConfig: Omit<CodeReviewConfig, 'id'> = {
				title: 'Test Configuration',
				description: 'New Config',
				enabled: true,
				fileExtensions: {
					include: ['.ts', '.js'],
				},
				requires: {
					text: ['TODO', 'FIXME'],
				},
				tags: [],
				projectPaths: [],
				examples: [
					{
						code: 'console.log("Hello, world!");',
						reviewComment: 'Consider using a logging library for better control over log levels.',
					},
				],
			};
			const mockDocRef = { id: 'newId' };
			const mockCollectionRef = {
				add: sinon.stub().resolves(mockDocRef),
			};
			mockFirestore.collection.returns(mockCollectionRef);

			const result = await service.createCodeReviewConfig(newConfig);

			expect(result).to.equal('newId');
			expect(mockFirestore.collection.calledWith('CodeReviewConfig')).to.be.true;
			expect(mockCollectionRef.add.calledWith(newConfig)).to.be.true;
		});
	});

	describe('updateCodeReviewConfig', () => {
		it('should update an existing code review config', async () => {
			const updateData = { description: 'Updated Config' };
			const mockDocRef = {
				update: sinon.stub().resolves(),
			};
			mockFirestore.doc.returns(mockDocRef);

			await service.updateCodeReviewConfig('existingId', updateData);

			expect(mockFirestore.doc.calledWith('CodeReviewConfig/existingId')).to.be.true;
			expect(mockDocRef.update.calledWith(updateData)).to.be.true;
		});
	});

	describe('deleteCodeReviewConfig', () => {
		it('should delete an existing code review config', async () => {
			const mockDocRef = {
				delete: sinon.stub().resolves(),
			};
			mockFirestore.doc.returns(mockDocRef);

			await service.deleteCodeReviewConfig('existingId');

			expect(mockFirestore.doc.calledWith('CodeReviewConfig/existingId')).to.be.true;
			expect(mockDocRef.delete.calledOnce).to.be.true;
		});
	});
});
