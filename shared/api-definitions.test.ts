import { type TSchema, Type } from '@sinclair/typebox';
import { expect } from 'chai';
import { defineRoute } from './api-definitions';
import { ApiErrorResponseSchema } from './common.schema';

describe('defineRoute default error schemas', () => {
	const defaultErrorStatusCodes: number[] = [400, 401, 403, 404, 409, 422, 429, 500, 502, 503, 504];

	// Mock schemas for testing
	const Success200Schema = Type.Object({ message: Type.String(), data: Type.Unknown() });
	const Custom400Schema = Type.Object({ customError: Type.String(), errorCode: Type.Number() });
	const Custom503Schema = Type.Object({ serviceUnavailable: Type.Boolean() });

	// Helper function to check default error schemas
	const checkDefaultErrorSchemas = (response: Record<number, TSchema> | undefined, excludeCodes: number[] = []) => {
		expect(response).to.be.an('object');
		if (!response) return; // Should not happen if expect above passes

		for (const statusCode of defaultErrorStatusCodes) {
			if (!excludeCodes.includes(statusCode)) {
				expect(response).to.have.property(String(statusCode), ApiErrorResponseSchema);
			}
		}
	};

	describe('Handling of Undefined or Empty response Configuration', () => {
		it('should apply default error schemas when config is undefined', () => {
			const route = defineRoute('GET', '/test-path');
			expect(route.schema.response).to.be.an('object');
			checkDefaultErrorSchemas(route.schema.response);
			expect(Object.keys(route.schema.response || {}).length).to.equal(defaultErrorStatusCodes.length);
		});

		it('should apply default error schemas when config.schema is undefined', () => {
			const route = defineRoute('GET', '/test-path', {});
			expect(route.schema.response).to.be.an('object');
			checkDefaultErrorSchemas(route.schema.response);
			expect(Object.keys(route.schema.response || {}).length).to.equal(defaultErrorStatusCodes.length);
		});

		it('should apply default error schemas when config.schema.response is undefined', () => {
			const route = defineRoute('GET', '/test-path', { schema: {} });
			expect(route.schema.response).to.be.an('object');
			checkDefaultErrorSchemas(route.schema.response);
			expect(Object.keys(route.schema.response || {}).length).to.equal(defaultErrorStatusCodes.length);
		});

		it('should apply default error schemas when config.schema.response is an empty object', () => {
			const route = defineRoute('GET', '/test-path', { schema: { response: {} } });
			expect(route.schema.response).to.be.an('object');
			checkDefaultErrorSchemas(route.schema.response);
			expect(Object.keys(route.schema.response || {}).length).to.equal(defaultErrorStatusCodes.length);
		});
	});

	describe('Preservation of Explicitly Defined Schemas', () => {
		it('should preserve an explicitly defined schema for a default error code and apply defaults for others', () => {
			const route = defineRoute('GET', '/test-path', { schema: { response: { 400: Custom400Schema } } });
			expect(route.schema.response).to.be.an('object');
			expect(route.schema.response).to.have.property(String(400), Custom400Schema);
			checkDefaultErrorSchemas(route.schema.response, [400]);
			expect(Object.keys(route.schema.response || {}).length).to.equal(defaultErrorStatusCodes.length);
		});

		it('should preserve an explicitly defined schema for a non-error code and apply all default error schemas', () => {
			const route = defineRoute('GET', '/test-path', { schema: { response: { 200: Success200Schema } } });
			expect(route.schema.response).to.be.an('object');
			expect(route.schema.response).to.have.property(String(200), Success200Schema);
			checkDefaultErrorSchemas(route.schema.response);
			expect(Object.keys(route.schema.response || {}).length).to.equal(defaultErrorStatusCodes.length + 1);
		});

		it('should preserve all explicitly defined schemas (error and non-error) and apply defaults for unspecified error codes', () => {
			const route = defineRoute('GET', '/test-path', {
				schema: {
					response: {
						200: Success200Schema,
						400: Custom400Schema,
						503: Custom503Schema,
					},
				},
			});
			expect(route.schema.response).to.be.an('object');
			expect(route.schema.response).to.have.property(String(200), Success200Schema);
			expect(route.schema.response).to.have.property(String(400), Custom400Schema);
			expect(route.schema.response).to.have.property(String(503), Custom503Schema);
			checkDefaultErrorSchemas(route.schema.response, [400, 503]);
			expect(Object.keys(route.schema.response || {}).length).to.equal(defaultErrorStatusCodes.length + 1);
		});
	});

	describe('Immutability of Input config.schema.response', () => {
		it('should not mutate the original config.schema.response object when it is provided and non-empty', () => {
			const originalResponseConfig = { 200: Success200Schema, 400: Custom400Schema };
			const originalResponseConfigCopy = { ...originalResponseConfig }; // For comparison

			const route = defineRoute('GET', '/test-path', { schema: { response: originalResponseConfig } });

			expect(route.schema.response).to.not.equal(originalResponseConfig);
			expect(originalResponseConfig).to.deep.equal(originalResponseConfigCopy);
			expect(Object.keys(originalResponseConfig).length).to.equal(2);

			expect(route.schema.response).to.have.property(String(200), Success200Schema);
			expect(route.schema.response).to.have.property(String(400), Custom400Schema);
			checkDefaultErrorSchemas(route.schema.response, [400]);
			expect(Object.keys(route.schema.response || {}).length).to.equal(defaultErrorStatusCodes.length + 1);
		});

		it('should not mutate the original config.schema.response object when it is an empty object', () => {
			const originalResponseConfig = {};

			const route = defineRoute('GET', '/test-path', { schema: { response: originalResponseConfig } });

			expect(route.schema.response).to.not.equal(originalResponseConfig);
			expect(originalResponseConfig).to.deep.equal({});

			checkDefaultErrorSchemas(route.schema.response);
			expect(Object.keys(route.schema.response || {}).length).to.equal(defaultErrorStatusCodes.length);
		});
	});
});
