import { expect } from 'chai';
import { StatusCodes } from 'http-status-codes';
import type { AppFastifyInstance } from '#app/applicationTypes';
import { createTestFastify } from '#routes/routeTestUtils';
import { setupConditionalLoggerOutput } from '#test/testUtils';

describe('Fastify Reply Decorators', () => {
	setupConditionalLoggerOutput();
	let app: AppFastifyInstance;

	describe('reply.sendJSON status code handling', () => {
		before(async () => {
			app = await createTestFastify(async (fastify) => {
				fastify.get('/test-code-before-sendjson', async (request, reply) => {
					reply.code(StatusCodes.CREATED); // 201
					return reply.sendJSON({ message: 'created' });
				});

				fastify.get('/test-sendjson-default', async (request, reply) => {
					return reply.sendJSON({ message: 'ok default' });
				});

				fastify.get('/test-code-before-sendjson-explicit', async (request, reply) => {
					reply.code(StatusCodes.OK); // 200
					return reply.sendJSON({ message: 'accepted explicit' }, StatusCodes.ACCEPTED); // Explicit 202
				});

				fastify.get('/test-sendjson-explicit-only', async (request, reply) => {
					return reply.sendJSON({ message: 'explicit no prior code' }, StatusCodes.NON_AUTHORITATIVE_INFORMATION); // Explicit 203
				});
			});
		});

		after(async () => {
			if (app) {
				await app.close();
			}
		});

		it('should use status from reply.code() if sendJSON has no explicit status', async () => {
			const response = await app.inject({
				method: 'GET',
				url: '/test-code-before-sendjson',
			});
			expect(response.statusCode).to.equal(StatusCodes.CREATED);
			expect(JSON.parse(response.payload)).to.deep.equal({ message: 'created' });
		});

		it('should default to StatusCodes.OK (200) if no reply.code() and no explicit status in sendJSON', async () => {
			const response = await app.inject({
				method: 'GET',
				url: '/test-sendjson-default',
			});
			expect(response.statusCode).to.equal(StatusCodes.OK);
			expect(JSON.parse(response.payload)).to.deep.equal({ message: 'ok default' });
		});

		it('should use explicit status from sendJSON even if reply.code() was called before', async () => {
			const response = await app.inject({
				method: 'GET',
				url: '/test-code-before-sendjson-explicit',
			});
			expect(response.statusCode).to.equal(StatusCodes.ACCEPTED);
			expect(JSON.parse(response.payload)).to.deep.equal({ message: 'accepted explicit' });
		});

		it('should use explicit status from sendJSON if no reply.code() was called before', async () => {
			const response = await app.inject({
				method: 'GET',
				url: '/test-sendjson-explicit-only',
			});
			expect(response.statusCode).to.equal(StatusCodes.NON_AUTHORITATIVE_INFORMATION);
			expect(JSON.parse(response.payload)).to.deep.equal({ message: 'explicit no prior code' });
		});
	});
});
