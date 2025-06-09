import { runCodeReviewServiceTests } from '#swe/codeReview/codeReviewService.test';
import { setupConditionalLoggerOutput } from '#test/testUtils';
import { InMemoryCodeReviewService } from './inMemoryCodeReviewService';

describe('InMemoryCodeReviewService', () => {
	setupConditionalLoggerOutput();
	runCodeReviewServiceTests(() => new InMemoryCodeReviewService());
});
