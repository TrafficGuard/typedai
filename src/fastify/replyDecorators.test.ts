import { Type } from '@sinclair/typebox';
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

	describe('reply.sendJSON status code handling with schema inference', () => {
		let app: AppFastifyInstance; // Ensure app is typed

		before(async () => {
			app = await createTestFastify(async (fastify) => {
				// Route with schema defining 201 success
				fastify.get(
					'/test-schema-201',
					{
						schema: {
							response: {
								201: Type.Object({ message: Type.String(), detail: Type.String() }),
								400: Type.Object({ error: Type.String() }), // Non-2xx to ensure it's ignored for success path
							},
						},
					},
					async (request, reply) => {
						return reply.sendJSON({ message: 'created by schema', detail: 'detail from 201 schema' });
					},
				);

				// Route with schema defining 200 success explicitly
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

				// Route with schema defining multiple 2xx (e.g., 200 and 202) - sendJSON should pick the non-200 2xx (202)
				fastify.get(
					'/test-schema-multiple-2xx',
					{
						schema: {
							response: {
								200: Type.Object({ message: Type.String() }),
								202: Type.Object({ message: Type.String(), status: Type.String() }), // Should be preferred
							},
						},
					},
					async (request, reply) => {
						return reply.sendJSON({ message: 'accepted via schema', status: 'processing' });
					},
				);

				// Route with schema defining 204 (no content)
				fastify.get(
					'/test-schema-204-no-content',
					{
						schema: {
							response: {
								204: Type.Null(), // Schema for a JSON null payload
								// 204: Type.Undefined() // Alternative for truly empty body, sendJSON might not be ideal then.
								// For sendJSON(null) with Type.Null(), expect "null" payload.
								200: Type.Object({ message: Type.String() }), // Another 2xx to ensure 204 is picked if appropriate
							},
						},
					},
					async (request, reply) => {
						return reply.sendJSON(null); // Test sending null for a 204 response
					},
				);

				// Route with no relevant 2xx schema (e.g., only 4xx/5xx defined or no response schema at all)
				fastify.get(
					'/test-no-2xx-schema',
					{
						schema: {
							// No response schema property at all, or:
							// response: { 400: Type.Object({ error: Type.String() }) }
						},
					},
					async (request, reply) => {
						return reply.sendJSON({ message: 'default ok, no 2xx schema' });
					},
				);

				// Route with reply.code(200) before sendJSON, with schema defining 201
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
						reply.code(StatusCodes.OK); // Explicitly 200
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
			expect(response.payload).to.equal('null'); // Fastify serializes null to "null" for application/json
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
