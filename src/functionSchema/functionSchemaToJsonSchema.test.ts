import { expect } from 'chai';
import {
	functionParameterToJsonSchema,
	functionSchemaToJsonSchemaParameters,
	functionSchemaToJsonSchemaToolDefinition,
	functionSchemasToJsonSchemaToolDefinitions,
	typeDefinitionToJsonSchema,
	typeToJsonSchema,
} from './functionSchemaToJsonSchema';
import type { FunctionJsonSchema, FunctionParameter } from './functions';
import type { TypeDefinition } from './typeDefinition';

describe('functionSchemaToJsonSchema', () => {
	describe('typeToJsonSchema', () => {
		describe('primitive types', () => {
			it('should convert string type', () => {
				expect(typeToJsonSchema('string')).to.deep.equal({ type: 'string' });
			});

			it('should convert number type', () => {
				expect(typeToJsonSchema('number')).to.deep.equal({ type: 'number' });
			});

			it('should convert boolean type', () => {
				expect(typeToJsonSchema('boolean')).to.deep.equal({ type: 'boolean' });
			});

			it('should convert void type to null', () => {
				expect(typeToJsonSchema('void')).to.deep.equal({ type: 'null' });
			});

			it('should convert null type', () => {
				expect(typeToJsonSchema('null')).to.deep.equal({ type: 'null' });
			});

			it('should convert undefined type to null', () => {
				expect(typeToJsonSchema('undefined')).to.deep.equal({ type: 'null' });
			});

			it('should convert any type to string', () => {
				expect(typeToJsonSchema('any')).to.deep.equal({ type: 'string' });
			});
		});

		describe('array types', () => {
			it('should convert string[] to array with string items', () => {
				expect(typeToJsonSchema('string[]')).to.deep.equal({
					type: 'array',
					items: { type: 'string' },
				});
			});

			it('should convert number[] to array with number items', () => {
				expect(typeToJsonSchema('number[]')).to.deep.equal({
					type: 'array',
					items: { type: 'number' },
				});
			});

			it('should convert Array<string> to array with string items', () => {
				expect(typeToJsonSchema('Array<string>')).to.deep.equal({
					type: 'array',
					items: { type: 'string' },
				});
			});

			it('should convert Array<number> to array with number items', () => {
				expect(typeToJsonSchema('Array<number>')).to.deep.equal({
					type: 'array',
					items: { type: 'number' },
				});
			});

			it('should handle Array with whitespace', () => {
				expect(typeToJsonSchema('Array< string >')).to.deep.equal({
					type: 'array',
					items: { type: 'string' },
				});
			});
		});

		describe('union literal types (enums)', () => {
			it('should convert single-quoted string literal union to enum', () => {
				expect(typeToJsonSchema("'a' | 'b' | 'c'")).to.deep.equal({
					type: 'string',
					enum: ['a', 'b', 'c'],
				});
			});

			it('should convert double-quoted string literal union to enum', () => {
				expect(typeToJsonSchema('"foo" | "bar"')).to.deep.equal({
					type: 'string',
					enum: ['foo', 'bar'],
				});
			});

			it('should handle enum with whitespace', () => {
				expect(typeToJsonSchema("  'read'  |  'write'  ")).to.deep.equal({
					type: 'string',
					enum: ['read', 'write'],
				});
			});
		});

		describe('Record types', () => {
			it('should convert Record<string, string> to object with additionalProperties', () => {
				expect(typeToJsonSchema('Record<string, string>')).to.deep.equal({
					type: 'object',
					additionalProperties: { type: 'string' },
				});
			});

			it('should convert Record<string, number> to object with additionalProperties', () => {
				expect(typeToJsonSchema('Record<string, number>')).to.deep.equal({
					type: 'object',
					additionalProperties: { type: 'number' },
				});
			});

			it('should handle Record with whitespace', () => {
				expect(typeToJsonSchema('Record< string , boolean >')).to.deep.equal({
					type: 'object',
					additionalProperties: { type: 'boolean' },
				});
			});
		});

		describe('Promise types', () => {
			it('should unwrap Promise<string>', () => {
				expect(typeToJsonSchema('Promise<string>')).to.deep.equal({
					type: 'string',
				});
			});

			it('should unwrap Promise<number>', () => {
				expect(typeToJsonSchema('Promise<number>')).to.deep.equal({
					type: 'number',
				});
			});
		});

		describe('object types', () => {
			it('should convert empty object to object with additionalProperties', () => {
				expect(typeToJsonSchema('{}')).to.deep.equal({
					type: 'object',
					additionalProperties: true,
				});
			});

			it('should convert object literal type', () => {
				expect(typeToJsonSchema('{ foo: string, bar: number }')).to.deep.equal({
					type: 'object',
					properties: {
						foo: { type: 'string' },
						bar: { type: 'number' },
					},
					required: ['foo', 'bar'],
				});
			});

			it('should handle optional properties in object literal', () => {
				expect(typeToJsonSchema('{ foo: string, bar?: number }')).to.deep.equal({
					type: 'object',
					properties: {
						foo: { type: 'string' },
						bar: { type: 'number' },
					},
					required: ['foo'],
				});
			});
		});

		describe('binary types', () => {
			it('should convert Uint8Array to string with description', () => {
				expect(typeToJsonSchema('Uint8Array')).to.deep.equal({
					type: 'string',
					description: 'Base64 encoded binary data',
				});
			});

			it('should convert Buffer to string with description', () => {
				expect(typeToJsonSchema('Buffer')).to.deep.equal({
					type: 'string',
					description: 'Base64 encoded binary data',
				});
			});
		});
	});

	describe('typeDefinitionToJsonSchema', () => {
		it('should convert a simple TypeDefinition to JSON Schema', () => {
			const typeDef: TypeDefinition = {
				name: 'SimpleType',
				properties: [
					{ name: 'foo', type: 'string', optional: false },
					{ name: 'bar', type: 'number', optional: false },
				],
			};

			expect(typeDefinitionToJsonSchema(typeDef)).to.deep.equal({
				type: 'object',
				properties: {
					foo: { type: 'string' },
					bar: { type: 'number' },
				},
				required: ['foo', 'bar'],
			});
		});

		it('should handle optional properties', () => {
			const typeDef: TypeDefinition = {
				name: 'TypeWithOptional',
				properties: [
					{ name: 'required', type: 'string', optional: false },
					{ name: 'optional', type: 'number', optional: true },
				],
			};

			expect(typeDefinitionToJsonSchema(typeDef)).to.deep.equal({
				type: 'object',
				properties: {
					required: { type: 'string' },
					optional: { type: 'number' },
				},
				required: ['required'],
			});
		});

		it('should include property descriptions', () => {
			const typeDef: TypeDefinition = {
				name: 'TypeWithDescriptions',
				properties: [{ name: 'foo', type: 'string', optional: false, description: 'The foo property' }],
			};

			expect(typeDefinitionToJsonSchema(typeDef)).to.deep.equal({
				type: 'object',
				properties: {
					foo: { type: 'string', description: 'The foo property' },
				},
				required: ['foo'],
			});
		});

		it('should include type description', () => {
			const typeDef: TypeDefinition = {
				name: 'TypeWithDescription',
				description: 'A type with a description',
				properties: [{ name: 'foo', type: 'string', optional: false }],
			};

			expect(typeDefinitionToJsonSchema(typeDef)).to.deep.equal({
				type: 'object',
				description: 'A type with a description',
				properties: {
					foo: { type: 'string' },
				},
				required: ['foo'],
			});
		});
	});

	describe('functionParameterToJsonSchema', () => {
		it('should convert a simple string parameter', () => {
			const param: FunctionParameter = {
				index: 0,
				name: 'input',
				type: 'string',
				description: 'The input value',
			};

			expect(functionParameterToJsonSchema(param)).to.deep.equal({
				type: 'string',
				description: 'The input value',
			});
		});

		it('should convert a number parameter', () => {
			const param: FunctionParameter = {
				index: 0,
				name: 'count',
				type: 'number',
				description: 'The count value',
			};

			expect(functionParameterToJsonSchema(param)).to.deep.equal({
				type: 'number',
				description: 'The count value',
			});
		});

		it('should convert an array parameter', () => {
			const param: FunctionParameter = {
				index: 0,
				name: 'items',
				type: 'string[]',
				description: 'The items array',
			};

			expect(functionParameterToJsonSchema(param)).to.deep.equal({
				type: 'array',
				items: { type: 'string' },
				description: 'The items array',
			});
		});

		it('should convert an enum parameter', () => {
			const param: FunctionParameter = {
				index: 0,
				name: 'mode',
				type: "'read' | 'write'",
				description: 'The mode',
			};

			expect(functionParameterToJsonSchema(param)).to.deep.equal({
				type: 'string',
				enum: ['read', 'write'],
				description: 'The mode',
			});
		});
	});

	describe('functionSchemaToJsonSchemaParameters', () => {
		it('should convert a schema with no parameters', () => {
			const schema = {
				parameters: [],
			};

			expect(functionSchemaToJsonSchemaParameters(schema)).to.deep.equal({
				type: 'object',
				properties: {},
				required: [],
				additionalProperties: false,
			});
		});

		it('should convert a schema with required parameters', () => {
			const schema = {
				parameters: [
					{ index: 0, name: 'arg1', type: 'string', description: 'First arg' },
					{ index: 1, name: 'arg2', type: 'number', description: 'Second arg' },
				],
			};

			expect(functionSchemaToJsonSchemaParameters(schema)).to.deep.equal({
				type: 'object',
				properties: {
					arg1: { type: 'string', description: 'First arg' },
					arg2: { type: 'number', description: 'Second arg' },
				},
				required: ['arg1', 'arg2'],
				additionalProperties: false,
			});
		});

		it('should handle optional parameters', () => {
			const schema = {
				parameters: [
					{ index: 0, name: 'required', type: 'string', description: 'Required arg' },
					{ index: 1, name: 'optional', type: 'number', description: 'Optional arg', optional: true },
				],
			};

			expect(functionSchemaToJsonSchemaParameters(schema)).to.deep.equal({
				type: 'object',
				properties: {
					required: { type: 'string', description: 'Required arg' },
					optional: { type: 'number', description: 'Optional arg' },
				},
				required: ['required'],
				additionalProperties: false,
			});
		});
	});

	describe('functionSchemaToJsonSchemaToolDefinition', () => {
		it('should convert a FunctionJsonSchema to a tool definition', () => {
			const schema: FunctionJsonSchema = {
				class: 'Jira',
				name: 'Jira_getIssue',
				description: 'Get a Jira issue by key',
				parameters: [{ index: 0, name: 'issueKey', type: 'string', description: 'The issue key' }],
				inputSchema: {
					type: 'object',
					properties: {
						issueKey: { type: 'string', description: 'The issue key' },
					},
					required: ['issueKey'],
					additionalProperties: false,
				},
			};

			expect(functionSchemaToJsonSchemaToolDefinition(schema)).to.deep.equal({
				type: 'function',
				function: {
					name: 'Jira_getIssue',
					description: 'Get a Jira issue by key',
					parameters: {
						type: 'object',
						properties: {
							issueKey: { type: 'string', description: 'The issue key' },
						},
						required: ['issueKey'],
						additionalProperties: false,
					},
				},
			});
		});
	});

	describe('functionSchemasToJsonSchemaToolDefinitions', () => {
		it('should convert an array of FunctionJsonSchemas to tool definitions', () => {
			const schemas: FunctionJsonSchema[] = [
				{
					class: 'Test',
					name: 'Test_methodA',
					description: 'Method A',
					parameters: [],
					inputSchema: {
						type: 'object',
						properties: {},
						required: [],
						additionalProperties: false,
					},
				},
				{
					class: 'Test',
					name: 'Test_methodB',
					description: 'Method B',
					parameters: [{ index: 0, name: 'input', type: 'string', description: 'Input' }],
					inputSchema: {
						type: 'object',
						properties: {
							input: { type: 'string', description: 'Input' },
						},
						required: ['input'],
						additionalProperties: false,
					},
				},
			];

			const result = functionSchemasToJsonSchemaToolDefinitions(schemas);

			expect(result).to.have.length(2);
			expect(result[0].function.name).to.equal('Test_methodA');
			expect(result[1].function.name).to.equal('Test_methodB');
			expect(result[1].function.parameters.properties.input).to.deep.equal({
				type: 'string',
				description: 'Input',
			});
		});
	});
});
