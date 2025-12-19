/**
 * Function Schema Module
 *
 * Provides function definition parsing, schema generation, and JSON Schema conversion
 * for LLM function calling.
 *
 * @module functionSchema
 */

// Core function schema types and utilities
export {
	FUNC_SEP,
	type FunctionJsonSchema,
	type FunctionParameter,
	getAllFunctionSchemas,
	getFunctionSchemas,
	type JsonSchemaParameters,
	type JsonSchemaProperty,
	type JsonSchemaToolDefinition,
	setFunctionSchemas,
} from './functions';

// Function decorators
export { func, funcClass, functionFactory, registerFunctionClasses, resetFunctionFactory } from './functionDecorators';

// Function schema parser
export { functionSchemaParser } from './functionSchemaParser';

// JSON Schema conversion utilities
export {
	functionParameterToJsonSchema,
	functionSchemaToJsonSchemaParameters,
	functionSchemaToJsonSchemaToolDefinition,
	functionSchemasToJsonSchemaToolDefinitions,
	typeDefinitionToJsonSchema,
	typeToJsonSchema,
} from './functionSchemaToJsonSchema';

// Type definitions
export type { TypeDefinition, TypeProperty } from './typeDefinition';
