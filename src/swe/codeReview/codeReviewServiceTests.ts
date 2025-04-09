import {CodeReviewService} from "#swe/codeReview/codeReviewService";
import sinon from "sinon";

export function runCodeReviewServiceTests(
    createService: () => CodeReviewService,
    beforeEachHook: () => Promise<void> | void = () => {},
    afterEachHook: () => Promise<void> | void = () => {},
) {

    let service: CodeReviewService;

    beforeEach(async () => {
        await beforeEachHook();
        service = createService();
    });

    afterEach(async () => {
        sinon.restore();
        await afterEachHook();
    });

}import { expect } from 'chai';
import type { CodeReviewConfig, MergeRequestFingerprintCache } from '#swe/codeReview/codeReviewModel';
import type { CodeReviewService } from '#swe/codeReview/codeReviewService';

// Helper function to compare Sets for equality
function expectSetsEqual<T>(actual: Set<T>, expected: Set<T>): void {
	expect(actual.size).to.equal(expected.size, `Set sizes should be equal (expected: ${expected.size}, actual: ${actual.size})`);
	for (const item of expected) {
		expect(actual.has(item)).to.be.true(`Expected set to contain item: ${String(item)}`);
	}
	// Also check the other way to ensure no extra items
	for (const item of actual) {
		expect(expected.has(item)).to.be.true(`Actual set contained unexpected item: ${String(item)}`);
	}
}

export function runCodeReviewServiceTests(
	serviceProvider: () => CodeReviewService,
	hooks: {
		beforeEach?: () => Promise<void> | void;
		afterEach?: () => Promise<void> | void;
	} = {},
) {
	let service: CodeReviewService;

	// --- Test Data ---
	const sampleConfig1: Omit<CodeReviewConfig, 'id'> = {
		title: 'Test Config 1',
		description: 'Description 1',
		enabled: true,
		fileExtensions: { include: ['.ts'] },
		requires: { text: ['TODO'] },
		tags: ['typescript', 'backend'],
		projectPaths: ['src/'],
		examples: [{ code: 'const x = 1;', reviewComment: 'Use let' }],
	};

	const sampleConfig2: Omit<CodeReviewConfig, 'id'> = {
		title: 'Test Config 2',
		description: 'Description 2',
		enabled: false,
		fileExtensions: { include: ['.py', '.java'] },
		requires: { text: [] },
		tags: ['python'],
		projectPaths: [],
		examples: [],
	};

	const projectId = 'test-project-123';
	const mrIid = 42;
	const initialFingerprints = new Set(['fp1', 'fp2']);
	const updatedFingerprints = new Set(['fp1', 'fp3', 'fp4']);

	// --- Hooks ---
	beforeEach(async () => {
		if (hooks.beforeEach) {
			await hooks.beforeEach();
		}
		service = serviceProvider(); // Get a fresh service instance for each test
	});

	afterEach(async () => {
		if (hooks.afterEach) {
			await hooks.afterEach();
		}
		// Add potential cleanup specific to the service instance if needed,
		// though usually handled by the provider/hooks
	});

	// --- Test Suite ---
	describe('CodeReviewService Shared Tests', () => {
		describe('Config Management', () => {
			it('should create a code review config and retrieve it', async () => {
				const createdId = await service.createCodeReviewConfig(sampleConfig1);
				expect(createdId).to.be.a('string');

				const retrievedConfig = await service.getCodeReviewConfig(createdId);
				expect(retrievedConfig).to.not.be.null;
				// Use deep.include to avoid matching the 'id' which we don't know beforehand
				expect(retrievedConfig).to.deep.include(sampleConfig1);
				expect(retrievedConfig?.id).to.equal(createdId);
			});

			it('should return null when retrieving a non-existent config', async () => {
				const retrievedConfig = await service.getCodeReviewConfig('non-existent-id');
				expect(retrievedConfig).to.be.null;
			});

			it('should list all created code review configs', async () => {
				const id1 = await service.createCodeReviewConfig(sampleConfig1);
				const id2 = await service.createCodeReviewConfig(sampleConfig2);

				const configs = await service.listCodeReviewConfigs();
				expect(configs).to.be.an('array').with.lengthOf(2);

				// Check if the retrieved configs contain the data we created (order might vary)
				const config1 = configs.find((c) => c.id === id1);
				const config2 = configs.find((c) => c.id === id2);

				expect(config1).to.deep.include(sampleConfig1);
				expect(config2).to.deep.include(sampleConfig2);
			});

			it('should return an empty list when no configs exist', async () => {
				const configs = await service.listCodeReviewConfigs();
				expect(configs).to.be.an('array').that.is.empty;
			});

			it('should update an existing code review config', async () => {
				const createdId = await service.createCodeReviewConfig(sampleConfig1);
				const updates: Partial<CodeReviewConfig> = {
					title: 'Updated Title',
					enabled: false,
					tags: ['updated', 'typescript'],
				};

				await service.updateCodeReviewConfig(createdId, updates);

				const retrievedConfig = await service.getCodeReviewConfig(createdId);
				expect(retrievedConfig).to.not.be.null;
				expect(retrievedConfig?.title).to.equal(updates.title);
				expect(retrievedConfig?.enabled).to.equal(updates.enabled);
				expect(retrievedConfig?.tags).to.deep.equal(updates.tags);
				// Ensure other fields remain unchanged
				expect(retrievedConfig?.description).to.equal(sampleConfig1.description);
				expect(retrievedConfig?.fileExtensions).to.deep.equal(sampleConfig1.fileExtensions);
			});

			it('should not throw when updating a non-existent config (implementation specific)', async () => {
				const updates: Partial<CodeReviewConfig> = { title: 'Non Existent Update' };
				// Firestore update throws if doc doesn't exist, InMemory might not.
				// The service interface doesn't mandate behavior here.
				// We test that *retrieving* still returns null.
				try {
					await service.updateCodeReviewConfig('non-existent-id', updates);
				} catch (error) {
					// Log if an error occurs, but don't fail the test based on this.
					// Specific implementations might have tests for their throwing behavior.
					console.warn('Update non-existent config threw error (might be expected for some implementations):', error);
				}
				// Verify that no config was accidentally created
				const retrieved = await service.getCodeReviewConfig('non-existent-id');
				expect(retrieved).to.be.null;
			});

			it('should delete an existing code review config', async () => {
				const createdId = await service.createCodeReviewConfig(sampleConfig1);

				// Verify it exists
				let retrievedConfig = await service.getCodeReviewConfig(createdId);
				expect(retrievedConfig).to.not.be.null;

				// Delete it
				await service.deleteCodeReviewConfig(createdId);

				// Verify it's gone
				retrievedConfig = await service.getCodeReviewConfig(createdId);
				expect(retrievedConfig).to.be.null;

				// Verify it's not in the list
				const configs = await service.listCodeReviewConfigs();
				expect(configs.find((c) => c.id === createdId)).to.be.undefined;
			});

			it('should not throw when deleting a non-existent config', async () => {
				// Use await expect(...).to.not.be.rejected for async functions
				await expect(service.deleteCodeReviewConfig('non-existent-id')).to.not.be.rejected;
				// Verify list is still empty or unchanged
				const configs = await service.listCodeReviewConfigs();
				expect(configs.find((c) => c.id === 'non-existent-id')).to.be.undefined;
			});
		});

		describe('Merge Request Review Cache', () => {
			it('should return an empty cache for a non-existent MR', async () => {
				const cache = await service.getMergeRequestReviewCache(projectId, mrIid);
				expect(cache).to.be.an('object');
				expect(cache.lastUpdated).to.equal(0);
				expect(cache.fingerprints).to.be.instanceOf(Set);
				expect(cache.fingerprints.size).to.equal(0);
			});

			it('should update and retrieve the MR review cache', async () => {
				const initialCache: MergeRequestFingerprintCache = {
					lastUpdated: 0, // This will be ignored on update, but needed for type
					fingerprints: initialFingerprints,
				};

				const startTime = Date.now();
				// Allow a small buffer before for timing checks
				await new Promise((resolve) => setTimeout(resolve, 1));
				await service.updateMergeRequestReviewCache(projectId, mrIid, initialCache);
				// Allow a small buffer after for timing checks
				await new Promise((resolve) => setTimeout(resolve, 1));
				const endTime = Date.now();

				const retrievedCache = await service.getMergeRequestReviewCache(projectId, mrIid);

				expect(retrievedCache).to.be.an('object');
				expect(retrievedCache.lastUpdated).to.be.a('number');
				// Check timestamp is within the expected range (roughly now)
				expect(retrievedCache.lastUpdated).to.be.at.least(startTime);
				expect(retrievedCache.lastUpdated).to.be.at.most(endTime);
				expect(retrievedCache.fingerprints).to.be.instanceOf(Set);
				expectSetsEqual(retrievedCache.fingerprints, initialFingerprints);
			});

			it('should overwrite existing MR review cache on update', async () => {
				// First update
				const firstCache: MergeRequestFingerprintCache = { lastUpdated: 0, fingerprints: initialFingerprints };
				await service.updateMergeRequestReviewCache(projectId, mrIid, firstCache);
				const retrievedAfterFirst = await service.getMergeRequestReviewCache(projectId, mrIid);
				const firstTimestamp = retrievedAfterFirst.lastUpdated;
				expect(firstTimestamp).to.be.greaterThan(0); // Should have been set
				expectSetsEqual(retrievedAfterFirst.fingerprints, initialFingerprints);

				// Ensure some time passes for timestamp check to be meaningful
				await new Promise((resolve) => setTimeout(resolve, 10)); // Wait 10ms

				// Second update (overwrite)
				const secondCache: MergeRequestFingerprintCache = { lastUpdated: 0, fingerprints: updatedFingerprints };
				const startTime = Date.now();
				await new Promise((resolve) => setTimeout(resolve, 1));
				await service.updateMergeRequestReviewCache(projectId, mrIid, secondCache);
				await new Promise((resolve) => setTimeout(resolve, 1));
				const endTime = Date.now();

				// Retrieve and verify
				const retrievedAfterSecond = await service.getMergeRequestReviewCache(projectId, mrIid);
				expect(retrievedAfterSecond.lastUpdated).to.be.a('number');
				expect(retrievedAfterSecond.lastUpdated).to.be.at.least(startTime);
				expect(retrievedAfterSecond.lastUpdated).to.be.at.most(endTime);
				expect(retrievedAfterSecond.lastUpdated).to.be.greaterThan(firstTimestamp); // Timestamp must increase
				expectSetsEqual(retrievedAfterSecond.fingerprints, updatedFingerprints); // Fingerprints must be the new set
			});

			it('should handle different project IDs and MR IIDs independently', async () => {
				const projectId2 = 'other-project-456';
				const mrIid2 = 99;

				const cache1: MergeRequestFingerprintCache = { lastUpdated: 0, fingerprints: initialFingerprints };
				const cache2: MergeRequestFingerprintCache = { lastUpdated: 0, fingerprints: updatedFingerprints };

				// Update caches for different MRs/Projects
				await service.updateMergeRequestReviewCache(projectId, mrIid, cache1);
				await service.updateMergeRequestReviewCache(projectId2, mrIid, cache1); // Same cache, different project
				await service.updateMergeRequestReviewCache(projectId, mrIid2, cache2); // Different cache, different MR

				// Retrieve and verify they are distinct
				const retrieved1 = await service.getMergeRequestReviewCache(projectId, mrIid);
				const retrieved2 = await service.getMergeRequestReviewCache(projectId2, mrIid);
				const retrieved3 = await service.getMergeRequestReviewCache(projectId, mrIid2);
				const retrievedNonExistent = await service.getMergeRequestReviewCache(projectId2, mrIid2); // Should be empty

				expectSetsEqual(retrieved1.fingerprints, initialFingerprints);
				expectSetsEqual(retrieved2.fingerprints, initialFingerprints);
				expectSetsEqual(retrieved3.fingerprints, updatedFingerprints);
				expect(retrievedNonExistent.fingerprints.size).to.equal(0);
				expect(retrievedNonExistent.lastUpdated).to.equal(0); // Check timestamp too
			});
		});

		// Add tests for cleanupExpiredFingerprints if/when it's added to the interface
		// describe('Merge Request Cache Cleanup', () => {
		// 	it('should remove expired fingerprints', async () => {
		// 		// Setup cache with old and new fingerprints
		// 		// Call cleanupExpiredFingerprints
		// 		// Verify only non-expired remain
		// 	});
		// });
	});
}
