import { runCodeReviewServiceTests } from '#swe/codeReview/codeReviewServiceTests';
import { InMemoryCodeReviewService } from './inMemoryCodeReviewService';

// --- Run Shared Tests ---

// Pass a factory function (() => new InMemoryCodeReviewService())
// to ensure each test run gets a fresh, empty instance.
// No special hooks needed as the instance is recreated each time by the factory.
runCodeReviewServiceTests(() => new InMemoryCodeReviewService());

// --- Optional: Add InMemory-Specific Tests Here (if any) ---
/*
describe('InMemoryCodeReviewService Specific Tests', () => {
    // Add tests unique to the in-memory implementation if needed.
    // For example, testing internal state if necessary (though generally discouraged).

    it('should correctly generate unique IDs (internal detail test - example)', () => {
        const service = new InMemoryCodeReviewService();
        const id1 = (service as any).generateId();
        const id2 = (service as any).generateId();
        expect(id1).to.be.a('string').with.length.greaterThan(10);
        expect(id2).to.be.a('string').with.length.greaterThan(10);
        expect(id1).to.not.equal(id2);
    });
});
*/
