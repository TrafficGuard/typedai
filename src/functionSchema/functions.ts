// Definitions for LLM function calling

import type { TypeDefinition } from './typeDefinition';

// If the FunctionSchema/FunctionParameter interfaces change then the loading of cached schemas in the
// parser will need to check for the old schema and discard

/** Character which separates the class name and the method name in the function name */
export const FUNC_SEP = '_';

/**
 * Specification of a class method which can be called by agents
 */
export interface FunctionSchema {
	class: string;
	name: string;
	description: string;
	parameters: FunctionParameter[];
	returns?: string;
	returnType?: string;
	/** Type definitions for custom types used in return type or parameters */
	typeDefinitions?: TypeDefinition[];
}

export interface FunctionParameter {
	index: number;
	name: string;
	type: string;
	optional?: boolean;
	description: string;
}

/**
 * Sets the function schemas on a class prototype
 * @param ctor the function class constructor function
 * @param schemas
 */
export function setFunctionSchemas(ctor: new (...args: any[]) => any, schemas: Record<string, FunctionSchema>): void {
	ctor.prototype.__functions = schemas;
}

/**
 * Gets the function schemas for an instance of a function class
 * @param instance
 */
export function getFunctionSchemas(instance: any): Record<string, FunctionSchema> {
	const functionSchemas: Record<string, FunctionSchema> | undefined = Object.getPrototypeOf(instance).__functions;
	if (functionSchemas === undefined) {
		throw new Error(`Instance prototype did not have function schemas. Does the class have the @funcClass decorator? Object: ${JSON.stringify(instance)}`);
	}
	return functionSchemas;
}

/**
 * Get the function schemas of the provided instances of function classes.
 * @param instances
 */
export function getAllFunctionSchemas(instances: any[]): FunctionSchema[] {
	const schemas: FunctionSchema[] = [];
	for (const instance of instances) {
		schemas.push(...Object.values(getFunctionSchemas(instance)));
	}
	return schemas;
}
