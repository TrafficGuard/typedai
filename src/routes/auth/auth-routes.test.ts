import { expect } from 'chai';
import { initInMemoryApplicationContext } from '../../applicationContext';
import { AppFastifyInstance } from '../../applicationTypes';
import { initFastify } from '../../fastify';
import { authRoutes } from './auth-routes';

describe.skip('Auth Routes', () => {
	let fastify: AppFastifyInstance;
	const testUser = {
		email: 'test@example.com',
		password: 'testPassword123',
	};

	before(async () => {
		// Initialize with in-memory services
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
			// Try to create same user again
			const response1 = await fastify.inject({
				method: 'POST',
				url: '/api/auth/signup',
				payload: testUser,
			});

			expect(response1.statusCode).to.equal(400);

			const response2 = await fastify.inject({
				method: 'POST',
				url: '/api/auth/signup',
				payload: testUser,
			});

			expect(response2.statusCode).to.equal(400);
			// const body = JSON.parse(response.body);
			// expect(body.error).to.equal('User already exists');
		});
	});

	describe('POST /api/auth/signin', () => {
		it('should successfully authenticate existing user', async () => {
			await fastify.inject({
				method: 'POST',
				url: '/api/auth/signup',
				payload: testUser,
			});

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
			// const body = JSON.parse(response.body);
			// expect(body.data.error).to.equal('Invalid credentials');
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
			// const body = JSON.parse(response.body);
			// expect(body.data.error).to.equal('Invalid credentials');
		});
	});
});
