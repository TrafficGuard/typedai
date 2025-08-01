import { Type } from '@sinclair/typebox';
import { expect } from 'chai';
import { StatusCodes } from 'http-status-codes';
import type { AppFastifyInstance } from '#app/applicationTypes';
import { createTestFastify } from '#routes/routeTestUtils';
import { setupConditionalLoggerOutput } from '#test/testUtils';

describe('Fastify Reply Decorators', () => {
	setupConditionalLoggerOutput(); // Keep this at the top
	let app: AppFastifyInstance;

	before(async () => {
		app = await createTestFastify(async (fastify) => {
			// Routes for 'reply.sendJSON status code handling'
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

			// Routes for 'reply.sendJSON status code handling with schema inference'
			fastify.get(
				'/test-schema-201',
				{
					schema: {
						response: {
							201: Type.Object({ message: Type.String(), detail: Type.String() }),
							400: Type.Object({ error: Type.String() }),
						},
					},
				},
				async (request, reply) => {
					return reply.sendJSON({ message: 'created by schema', detail: 'detail from 201 schema' });
				},
			);

			fastify.get(
				'/test-schema-200',
				{
					schema: {
						response: {
							200: Type.Object({ message: Type.String() }),
						},
					},
				},
				async (request, reply) => {
					return reply.sendJSON({ message: 'ok by schema' });
				},
			);

			fastify.get(
				'/test-schema-multiple-2xx',
				{
					schema: {
						response: {
							200: Type.Object({ message: Type.String() }),
							202: Type.Object({ message: Type.String(), status: Type.String() }),
						},
					},
				},
				async (request, reply) => {
					return reply.sendJSON({ message: 'accepted via schema', status: 'processing' });
				},
			);

			fastify.get(
				'/test-schema-204-no-content',
				{
					schema: {
						response: {
							204: Type.Null(),
							200: Type.Object({ message: Type.String() }),
						},
					},
				},
				async (request, reply) => {
					return reply.sendJSON(null);
				},
			);

			fastify.get(
				'/test-no-2xx-schema',
				{
					schema: {},
				},
				async (request, reply) => {
					return reply.sendJSON({ message: 'default ok, no 2xx schema' });
				},
			);

			fastify.get(
				'/test-code-200-then-schema-201',
				{
					schema: {
						response: {
							201: Type.Object({ message: Type.String() }),
						},
					},
				},
				async (request, reply) => {
					reply.code(StatusCodes.OK);
					return reply.sendJSON({ message: 'should be 201 due to schema' });
				},
			);
		});
	});

	after(async () => {
		if (app) {
			await app.close();
		}
	});

	describe('reply.sendJSON status code handling', () => {
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

	describe('reply.sendJSON status code handling with schema inference', () => {
		// Tests in this block will use the 'app' instance from the parent scope.
		// The local 'app' variable, and its before/after hooks, are removed.

		it('should use schema-defined 201 status when no explicit status or prior relevant .code()', async () => {
			const response = await app.inject({
				method: 'GET',
				url: '/test-schema-201',
			});
			expect(response.statusCode).to.equal(StatusCodes.CREATED); // 201
			expect(JSON.parse(response.payload)).to.deep.equal({ message: 'created by schema', detail: 'detail from 201 schema' });
		});

		it('should use schema-defined 200 status when schema specifies 200 and no other overrides', async () => {
			const response = await app.inject({
				method: 'GET',
				url: '/test-schema-200',
			});
			expect(response.statusCode).to.equal(StatusCodes.OK); // 200
			expect(JSON.parse(response.payload)).to.deep.equal({ message: 'ok by schema' });
		});

		it('should prefer specific non-200 2xx status (e.g. 202) from schema if multiple 2xx are defined', async () => {
			const response = await app.inject({
				method: 'GET',
				url: '/test-schema-multiple-2xx',
			});
			expect(response.statusCode).to.equal(StatusCodes.ACCEPTED); // 202
			expect(JSON.parse(response.payload)).to.deep.equal({ message: 'accepted via schema', status: 'processing' });
		});

		it('should use schema-defined 204 status and send "null" payload for sendJSON(null)', async () => {
			const response = await app.inject({
				method: 'GET',
				url: '/test-schema-204-no-content',
			});
			expect(response.statusCode).to.equal(StatusCodes.NO_CONTENT); // 204
			expect(response.payload).to.equal(''); // A 204 response must have an empty body
		});

		it('should default to 200 if no relevant 2xx status is in schema and no other overrides', async () => {
			const response = await app.inject({
				method: 'GET',
				url: '/test-no-2xx-schema',
			});
			expect(response.statusCode).to.equal(StatusCodes.OK); // 200
			expect(JSON.parse(response.payload)).to.deep.equal({ message: 'default ok, no 2xx schema' });
		});

		it('should use schema-defined 201 status even if reply.code(200) was called before sendJSON', async () => {
			const response = await app.inject({
				method: 'GET',
				url: '/test-code-200-then-schema-201',
			});
			expect(response.statusCode).to.equal(StatusCodes.CREATED); // 201
			expect(JSON.parse(response.payload)).to.deep.equal({ message: 'should be 201 due to schema' });
		});
	});
});
