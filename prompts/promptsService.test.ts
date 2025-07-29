import { expect } from 'chai';
import type { PromptsService } from './promptsService';
import sinon from 'sinon'; // Assuming sinon is used for testing as per DOCS.md examples

// This structure is based on the example in src/DOCS.md for shared service tests.
// You might need to adjust imports and types based on your actual PromptsService interface and test setup.

/**
 * Generic test suite for any implementation of PromptsService.
 * @param createService A factory function that returns an instance of PromptsService.
 * @param beforeEachHook Optional hook to run before each test specific to the service implementation (e.g., DB cleanup).
 * @param afterEachHook Optional hook to run after each test specific to the service implementation (e.g., DB connection close).
 */
export function runPromptsServiceTests(
	createService: () => PromptsService,
	beforeEachHook: () => Promise<void> | void = () => {},
	afterEachHook: () => Promise<void> | void = () => {},
): void {
	let service: PromptsService;

	beforeEach(async () => {
		await beforeEachHook();
		service = createService();
	});

	afterEach(async () => {
		sinon.restore(); // Restore any sinon stubs, spies, mocks
		await afterEachHook();
	});

	// Example test - adapt and expand based on PromptsService interface
	describe('Common PromptsService Tests', () => {
		it('should be creatable', () => {
			expect(service).to.be.ok;
		});

		// Add more tests here to cover the PromptsService interface methods:
		// - getPrompt
		// - getPromptVersion
		// - listPromptsForUser
		// - createPrompt
		// - updatePrompt
		// - deletePrompt

		// Example for createPrompt (adapt with actual data and assertions)
		// describe('#createPrompt', () => {
		// 	it('should create a new prompt and return it', async () => {
		// 		const userId = 'test-user-123';
		// 		const promptData = {
		// 			name: 'My Test Prompt',
		// 			tags: ['test', 'example'],
		// 			messages: [{ role: 'user', content: 'Hello!' }],
		// 			settings: { temperature: 0.7 },
		// 			// parentId, appId might be optional
		// 		};
		//
		// 		const createdPrompt = await service.createPrompt(promptData, userId);
		//
		// 		expect(createdPrompt).to.be.an('object');
		// 		expect(createdPrompt.id).to.be.a('string');
		// 		expect(createdPrompt.userId).to.equal(userId);
		// 		expect(createdPrompt.name).to.equal(promptData.name);
		// 		expect(createdPrompt.revisionId).to.equal(1); // Assuming first revision is 1
		//
		// 		// Optionally, verify by trying to get the prompt
		// 		const fetchedPrompt = await service.getPrompt(createdPrompt.id, userId);
		// 		expect(fetchedPrompt).to.deep.equal(createdPrompt);
		// 	});
		// });
	});
}
