// Definitions for LLM function calling

// Re-export JSON Schema types for consumers
export type { FunctionJsonSchema, JsonSchemaParameters, JsonSchemaProperty, JsonSchemaToolDefinition } from './functionSchemaToJsonSchema';

/** Character which separates the class name and the method name in the function name */
export const FUNC_SEP = '_';

/**
 * Function parameter definition
 */
export interface FunctionParameter {
	index: number;
	name: string;
	type: string;
	optional?: boolean;
	description: string;
}

// Import the main type after exporting FunctionParameter (to avoid circular dep)
import type { FunctionJsonSchema } from './functionSchemaToJsonSchema';

/**
 * Sets the function schemas on a class prototype
 * @param ctor the function class constructor function
 * @param schemas
 */
export function setFunctionSchemas(ctor: new (...args: any[]) => any, schemas: Record<string, FunctionJsonSchema>): void {
	ctor.prototype.__functions = schemas;
}

/**
 * Gets the function schemas for an instance of a function class
 * @param instance
 */
export function getFunctionSchemas(instance: any): Record<string, FunctionJsonSchema> {
	const functionSchemas: Record<string, FunctionJsonSchema> | undefined = Object.getPrototypeOf(instance).__functions;
	if (functionSchemas === undefined) {
		throw new Error(`Instance prototype did not have function schemas. Does the class have the @funcClass decorator? Object: ${JSON.stringify(instance)}`);
	}
	return functionSchemas;
}

/**
 * Get the function schemas of the provided instances of function classes.
 * @param instances
 */
export function getAllFunctionSchemas(instances: any[]): FunctionJsonSchema[] {
	const schemas: FunctionJsonSchema[] = [];
	for (const instance of instances) {
		schemas.push(...Object.values(getFunctionSchemas(instance)));
	}
	return schemas;
}
