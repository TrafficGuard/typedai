import { expect } from 'chai';
import type { FastifyInstance } from 'fastify';
import type { User } from '#shared/model/user.model';

import { createTestFastify } from '../routeTestUtils';

describe.skip('Profile Routes', () => {
	let fastify: FastifyInstance;
	let mockUser: User;

	beforeEach(async () => {
		fastify = await createTestFastify();

		// Setup mock user data
		mockUser = {
			id: '1',
			email: 'test@test.com',
			enabled: true,
			hilBudget: 0,
			hilCount: 0,
			createdAt: new Date(),
			chat: {
				temperature: 0.7,
				topP: 0.9,
				presencePenalty: 0.5,
				frequencyPenalty: 0.5,
				enabledLLMs: {},
				defaultLLM: 'test-llm',
			},
			llmConfig: {
				anthropicKey: '',
				openaiKey: '',
				groqKey: '',
				togetheraiKey: '',
			},
			functionConfig: {},
		};
	});

	afterEach(async () => {
		await fastify.close();
	});

	describe('POST /api/profile/update', () => {
		it('should update user chat settings', async () => {
			// Prepare test data
			const updates = {
				chat: {
					temperature: 1.5,
					topP: 0.8,
					presencePenalty: 0.3,
					frequencyPenalty: 0.4,
					enabledLLMs: { 'test-llm': true },
					defaultLLM: 'test-llm',
				},
			};

			// Make request to update profile
			const response = await fastify.inject({
				method: 'POST',
				url: '/api/profile/update',
				payload: { user: updates },
			});

			// Verify response
			expect(response.statusCode).to.equal(200);
			const updatedUser = JSON.parse(response.payload);
			expect(updatedUser.chat).to.deep.equal(updates.chat);
		});

		it('should validate chat settings ranges', async () => {
			// Test invalid temperature value
			const response = await fastify.inject({
				method: 'POST',
				url: '/api/profile/update',
				payload: {
					user: {
						chat: {
							temperature: 3.0, // Invalid: should be <= 2.0
						},
					},
				},
			});

			expect(response.statusCode).to.equal(400);
		});
	});
});
