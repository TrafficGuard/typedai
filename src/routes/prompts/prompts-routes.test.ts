import { expect } from 'chai';
import sinon from 'sinon';
import type { AppFastifyInstance } from '#app/applicationTypes';
import { createTestFastify } from '#routes/routeTestUtils';
import type { PromptGenerateResponseSchemaModel } from '#shared/prompts/prompts.schema';
import type { User } from '#shared/user/user.model';
import type { ChatSettings, LLMServicesConfig } from '#shared/user/user.model';
import { promptRoutes } from './prompts-routes';

// Mock currentUser from #user/userContext
const mockUser: User = {
	id: 'test-user-id',
	email: 'test@example.com',
	name: 'Test User',
	enabled: true, // 'active' from instructions mapped to 'enabled'
	// Add other required fields from User model to make the mock compliant
	createdAt: new Date(),
	hilBudget: 0,
	hilCount: 0,
	llmConfig: {} as LLMServicesConfig, // Assuming empty or default config
	chat: {} as ChatSettings, // Assuming empty or default settings
	functionConfig: {},
};

describe.skip('POST /api/prompts/:promptId/generate', () => {
	let app: AppFastifyInstance;

	before(async () => {
		// Mocks should be established before createTestFastify if they influence route registration or app setup.
		// If #user/userContext is imported by prompts-routes.ts at the module level, the top-level vi.mock is crucial.
		app = await createTestFastify(promptRoutes);
	});

	after(async () => {
		await app.close();
		sinon.restore();
	});

	describe('POST /api/prompts/:promptId/generate', () => {
		// Test cases will go here
		// It might be useful to clear mocks before each test if they are stateful or modified by tests.
		// beforeEach(() => {
		//    vi.clearAllMocks(); // Clears call counts etc.
		//    // Re-establish mocks if needed, e.g., if currentUser mock itself is changed by a test
		//    vi.mocked(currentUser).mockReturnValue(mockUser);
		// });

		it('should return a 200 with a mock generated message', async () => {
			const promptId = 'test-prompt-123';
			// Example payload, ensure it matches PromptGeneratePayloadSchema if strict validation is on
			const payload = { options: { temperature: 0.7 } }; // An empty object {} should also be valid if options is optional

			const response = await app.inject({
				method: 'POST',
				url: `/api/prompts/${promptId}/generate`,
				payload,
				// headers: { 'authorization': 'Bearer test-token' }, // Add if auth is enforced by buildTestApp
			});

			expect(response.statusCode).to.eq(200);
			const responseBody = JSON.parse(response.payload) as PromptGenerateResponseSchemaModel;

			expect(responseBody.generatedMessage).to.not.eq(undefined);
			expect(responseBody.generatedMessage.role).to.eq('assistant');
			expect(responseBody.generatedMessage.content).to.eq('This is a mock generated message from the new /api/prompts/:promptId/generate endpoint.');
			expect(responseBody.generatedMessage.stats).to.not.eq(undefined);
			expect(responseBody.generatedMessage.stats?.llmId).to.eq('mock-llm');
		});
	});
});
