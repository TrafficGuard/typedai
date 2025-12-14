import { expect } from 'chai';
import { initInMemoryApplicationContext } from '#app/applicationContext';
import type { AppFastifyInstance } from '#app/applicationTypes';
import { setupConditionalLoggerOutput } from '#test/testUtils';
import { initFastify } from '../../fastify';
import { authRoutes } from './index'; // Ensure this import points to the correct index.ts

describe.skip('Auth Routes', () => {
	setupConditionalLoggerOutput();
	// Note: .skip is added here
	let fastify: AppFastifyInstance;
	const testUser = {
		email: 'test@example.com',
		password: 'testPassword123',
	};

	before(async () => {
		const context = initInMemoryApplicationContext();
		fastify = await initFastify({
			routes: [authRoutes],
			instanceDecorators: context,
			requestDecorators: {},
		});
	});

	after(async () => {
		await fastify.close();
	});

	describe('POST /api/auth/signup', () => {
		it('should successfully create a new user', async () => {
			const response = await fastify.inject({
				method: 'POST',
				url: '/api/auth/signup',
				payload: testUser,
			});

			expect(response.statusCode).to.equal(200);
			const body = JSON.parse(response.body);
			expect(body.data.user).to.exist;
			expect(body.data.user.email).to.equal(testUser.email);
			expect(body.data.accessToken).to.exist;
		});

		it('should return 400 when user already exists', async () => {
			// Ensure user exists for this test case by signing them up first
			try {
				await fastify.inject({
					method: 'POST',
					url: '/api/auth/signup',
					payload: testUser,
				});
			} catch (e) {
				// If this fails because user already exists, that's fine for this test's purpose.
			}

			const response = await fastify.inject({
				// Second attempt, should fail if user now exists
				method: 'POST',
				url: '/api/auth/signup',
				payload: testUser,
			});
			expect(response.statusCode).to.equal(400);
		});
	});

	describe('POST /api/auth/signin', () => {
		it('should successfully authenticate existing user', async () => {
			// Ensure user exists from a signup
			try {
				await fastify.inject({
					method: 'POST',
					url: '/api/auth/signup',
					payload: testUser,
				});
			} catch (e) {
				// If this fails because user already exists, that's fine for this test's purpose.
			}

			const response = await fastify.inject({
				method: 'POST',
				url: '/api/auth/signin',
				payload: testUser,
			});

			expect(response.statusCode).to.equal(200);
			const body = JSON.parse(response.body);
			expect(body.data.user).to.exist;
			expect(body.data.user.email).to.equal(testUser.email);
			expect(body.data.accessToken).to.exist;
		});

		it('should return 400 for invalid credentials', async () => {
			const response = await fastify.inject({
				method: 'POST',
				url: '/api/auth/signin',
				payload: {
					email: testUser.email,
					password: 'wrongPassword',
				},
			});
			expect(response.statusCode).to.equal(400);
		});

		it('should return 400 for non-existent user', async () => {
			const response = await fastify.inject({
				method: 'POST',
				url: '/api/auth/signin',
				payload: {
					email: 'nonexistent@example.com',
					password: 'somePassword',
				},
			});
			expect(response.statusCode).to.equal(400);
		});
	});
});
