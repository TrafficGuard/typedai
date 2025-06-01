// import { expect } from 'chai'; // Now handled by shared tests
// import sinon from 'sinon'; // No longer needed for mocking Firestore internals here
// import type { CodeReviewConfig } from '#swe/codeReview/codeReviewModel'; // Now handled by shared tests

import { runCodeReviewServiceTests } from '#swe/codeReview/codeReviewService.test';
import { setupConditionalLoggerOutput } from '#test/testUtils';
import { FirestoreCodeReviewService } from './firestoreCodeReviewService';
import { resetFirestoreEmulator } from './resetFirestoreEmulator';

// --- Firestore Test Setup ---

// Determine if running against emulator (adjust logic as needed based on your env vars)
const useEmulator = !!process.env.FIRESTORE_EMULATOR_HOST;

const hooks = useEmulator
	? {
			// Reset emulator before each test for isolation
			beforeEach: async () => {
				// console.log('Resetting Firestore emulator...'); // Optional: for debugging
				await resetFirestoreEmulator();
				// console.log('Firestore emulator reset complete.'); // Optional: for debugging
			},
			afterEach: () => {
				// Optional cleanup after each test if needed, e.g., closing connections
			},
		}
	: {
			// No automatic cleanup for real Firestore, manual cleanup might be needed
			beforeEach: () => {
				console.warn('WARNING: Running Firestore tests against REAL Firestore database. Manual cleanup may be required.');
			},
			afterEach: () => {
				// Optional cleanup
			},
		};

// --- Run Shared Tests ---

describe('FirestoreCodeReviewService Specific Tests', () => {
	setupConditionalLoggerOutput();

	runCodeReviewServiceTests(() => new FirestoreCodeReviewService(), hooks);

	// Add tests that are unique to the Firestore implementation,
	// e.g., testing specific error handling related to Firestore limits,
	// or verifying internal document structure if absolutely necessary (though discouraged).

	// Example: Test Firestore-specific error handling if getCodeReviewConfig throws
	// it('should handle Firestore errors during getCodeReviewConfig gracefully', async () => {
	//     const service = new FirestoreCodeReviewService();
	//     // Mock the db connection to throw an error
	//     (service as any).db = {
	//         doc: () => ({
	//             get: sinon.stub().rejects(new Error('Firestore unavailable')),
	//         }),
	//     };
	//     // Depending on implementation, it might re-throw or return null/empty
	//     await expect(service.getCodeReviewConfig('some-id')).to.be.rejectedWith('Firestore unavailable');
	//     // or expect(await service.getCodeReviewConfig('some-id')).to.be.null;
	// });
});
