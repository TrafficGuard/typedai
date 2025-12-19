/**
 * Converts TypeScript types and FunctionSchema to JSON Schema format
 * compatible with OpenAI/Anthropic tool calling and Vercel AI SDK.
 *
 * @module functionSchema/functionSchemaToJsonSchema
 */

import type { FunctionParameter } from './functions';
import type { TypeDefinition } from './typeDefinition';

/**
 * JSON Schema property definition
 */
export interface JsonSchemaProperty {
	type: 'string' | 'number' | 'integer' | 'boolean' | 'object' | 'array' | 'null';
	description?: string;
	enum?: string[];
	items?: JsonSchemaProperty;
	properties?: Record<string, JsonSchemaProperty>;
	required?: string[];
	additionalProperties?: boolean | JsonSchemaProperty;
}

/**
 * JSON Schema parameters object (for function parameters)
 */
export interface JsonSchemaParameters {
	type: 'object';
	properties: Record<string, JsonSchemaProperty>;
	required: string[];
	additionalProperties?: boolean;
}

/**
 * Standard JSON Schema tool definition format (OpenAI/Anthropic compatible)
 */
export interface JsonSchemaToolDefinition {
	type: 'function';
	function: {
		name: string;
		description: string;
		parameters: JsonSchemaParameters;
	};
}

/**
 * Function schema with JSON Schema format for tool calling
 */
export interface FunctionJsonSchema {
	/** The class name this function belongs to */
	class: string;
	/** The fully qualified function name (ClassName_methodName) */
	name: string;
	/** Description of the function */
	description: string;
	/** Parameter definitions (legacy format for internal use) */
	parameters: FunctionParameter[];
	/** JSON Schema representation of the function parameters */
	inputSchema: JsonSchemaParameters;
	/** Human-readable return description */
	returns?: string;
	/** The return type */
	returnType?: string;
	/** Type definitions for custom types used in return type or parameters */
	typeDefinitions?: TypeDefinition[];
}

/**
 * Converts a TypeScript type string to a JSON Schema property definition.
 *
 * Supports:
 * - Primitive types: string, number, boolean, void, null, undefined, any
 * - Arrays: string[], Array<string>
 * - Union literals: 'a' | 'b' | 'c' (converts to enum)
 * - Union types: string | number
 * - Objects: { foo: string, bar: number }
 * - Record types: Record<string, T>
 * - Optional marker types
 *
 * @param typeStr The TypeScript type string
 * @param typeDefinitions Optional type definitions for resolving custom types
 * @returns JSON Schema property definition
 */
export function typeToJsonSchema(typeStr: string, typeDefinitions?: TypeDefinition[]): JsonSchemaProperty {
	const trimmed = typeStr.trim();

	// Handle empty or void types
	if (!trimmed || trimmed === 'void' || trimmed === 'undefined') {
		return { type: 'null' };
	}

	// Handle null
	if (trimmed === 'null') {
		return { type: 'null' };
	}

	// Handle primitive types
	const primitiveMap: Record<string, JsonSchemaProperty['type']> = {
		string: 'string',
		number: 'number',
		boolean: 'boolean',
		any: 'string', // Treat any as string for JSON Schema
		unknown: 'string',
	};

	if (primitiveMap[trimmed]) {
		return { type: primitiveMap[trimmed] };
	}

	// Handle binary types
	if (trimmed === 'Uint8Array' || trimmed === 'Buffer' || trimmed === 'ArrayBuffer') {
		return { type: 'string', description: 'Base64 encoded binary data' };
	}

	// Handle string literal union (enum): 'a' | 'b' | 'c'
	if (trimmed.includes("'") && trimmed.includes('|')) {
		const literals = trimmed
			.split('|')
			.map((s) => s.trim())
			.filter((s) => s.startsWith("'") && s.endsWith("'"))
			.map((s) => s.slice(1, -1));

		if (literals.length > 0) {
			return { type: 'string', enum: literals };
		}
	}

	// Handle double-quoted string literal union: "a" | "b" | "c"
	if (trimmed.includes('"') && trimmed.includes('|')) {
		const literals = trimmed
			.split('|')
			.map((s) => s.trim())
			.filter((s) => s.startsWith('"') && s.endsWith('"'))
			.map((s) => s.slice(1, -1));

		if (literals.length > 0) {
			return { type: 'string', enum: literals };
		}
	}

	// Handle array types: string[] or Array<string>
	if (trimmed.endsWith('[]')) {
		const elementType = trimmed.slice(0, -2).trim();
		return {
			type: 'array',
			items: typeToJsonSchema(elementType, typeDefinitions),
		};
	}

	const arrayMatch = trimmed.match(/^Array\s*<\s*(.+)\s*>$/);
	if (arrayMatch) {
		return {
			type: 'array',
			items: typeToJsonSchema(arrayMatch[1], typeDefinitions),
		};
	}

	// Handle Record<string, T>
	const recordMatch = trimmed.match(/^Record\s*<\s*string\s*,\s*(.+)\s*>$/);
	if (recordMatch) {
		return {
			type: 'object',
			additionalProperties: typeToJsonSchema(recordMatch[1], typeDefinitions),
		};
	}

	// Handle object literal: { foo: string, bar: number }
	if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
		const inner = trimmed.slice(1, -1).trim();
		if (!inner) {
			return { type: 'object', additionalProperties: true };
		}

		// Simple parsing - split by comma and parse each property
		// This is a simplified parser; complex nested objects may need more sophisticated parsing
		const properties: Record<string, JsonSchemaProperty> = {};
		const required: string[] = [];

		// Parse properties - handle simple cases
		const propParts = splitObjectProperties(inner);
		for (const part of propParts) {
			const colonIndex = part.indexOf(':');
			if (colonIndex === -1) continue;

			let propName = part.slice(0, colonIndex).trim();
			const propType = part.slice(colonIndex + 1).trim();

			// Check for optional property
			const isOptional = propName.endsWith('?');
			if (isOptional) {
				propName = propName.slice(0, -1).trim();
			}

			properties[propName] = typeToJsonSchema(propType, typeDefinitions);
			if (!isOptional) {
				required.push(propName);
			}
		}

		return {
			type: 'object',
			properties,
			...(required.length > 0 ? { required } : {}),
		};
	}

	// Handle Promise wrapper
	const promiseMatch = trimmed.match(/^Promise\s*<\s*(.+)\s*>$/);
	if (promiseMatch) {
		return typeToJsonSchema(promiseMatch[1], typeDefinitions);
	}

	// Handle union types (that aren't string literals)
	if (trimmed.includes('|') && !trimmed.includes("'") && !trimmed.includes('"')) {
		// For now, use the first non-null type
		const parts = trimmed.split('|').map((s) => s.trim());
		const nonNullPart = parts.find((p) => p !== 'null' && p !== 'undefined');
		if (nonNullPart) {
			return typeToJsonSchema(nonNullPart, typeDefinitions);
		}
	}

	// Handle custom types from typeDefinitions
	if (typeDefinitions) {
		const typeDef = typeDefinitions.find((td) => td.name === trimmed);
		if (typeDef) {
			return typeDefinitionToJsonSchema(typeDef, typeDefinitions);
		}
	}

	// Handle import() type references - extract the type name
	if (trimmed.includes('import(')) {
		const importMatch = trimmed.match(/import\([^)]+\)\.(\w+)/);
		if (importMatch) {
			const typeName = importMatch[1];
			// Try to find in type definitions
			if (typeDefinitions) {
				const typeDef = typeDefinitions.find((td) => td.name === typeName);
				if (typeDef) {
					return typeDefinitionToJsonSchema(typeDef, typeDefinitions);
				}
			}
			// Return as object if not found
			return { type: 'object', additionalProperties: true };
		}
	}

	// Default: treat unknown types as objects
	return { type: 'object', additionalProperties: true };
}

/**
 * Converts a TypeDefinition (interface) to JSON Schema
 */
export function typeDefinitionToJsonSchema(typeDef: TypeDefinition, allTypeDefinitions?: TypeDefinition[]): JsonSchemaProperty {
	const properties: Record<string, JsonSchemaProperty> = {};
	const required: string[] = [];

	for (const prop of typeDef.properties) {
		const propSchema = typeToJsonSchema(prop.type, allTypeDefinitions);
		if (prop.description) {
			propSchema.description = prop.description;
		}
		properties[prop.name] = propSchema;

		if (!prop.optional) {
			required.push(prop.name);
		}
	}

	const schema: JsonSchemaProperty = {
		type: 'object',
		properties,
	};

	if (required.length > 0) {
		schema.required = required;
	}

	if (typeDef.description) {
		schema.description = typeDef.description;
	}

	return schema;
}

/**
 * Helper to split object property definitions, handling nested braces
 */
function splitObjectProperties(inner: string): string[] {
	const parts: string[] = [];
	let current = '';
	let braceDepth = 0;
	let angleDepth = 0;

	for (const char of inner) {
		if (char === '{') braceDepth++;
		if (char === '}') braceDepth--;
		if (char === '<') angleDepth++;
		if (char === '>') angleDepth--;

		if (char === ',' && braceDepth === 0 && angleDepth === 0) {
			if (current.trim()) {
				parts.push(current.trim());
			}
			current = '';
		} else {
			current += char;
		}
	}

	if (current.trim()) {
		parts.push(current.trim());
	}

	return parts;
}

/**
 * Converts a FunctionParameter to a JSON Schema property
 */
export function functionParameterToJsonSchema(param: FunctionParameter, typeDefinitions?: TypeDefinition[]): JsonSchemaProperty {
	const schema = typeToJsonSchema(param.type, typeDefinitions);

	// Add description if not already present
	if (param.description && !schema.description) {
		schema.description = param.description;
	}

	return schema;
}

/**
 * Input for generating JSON Schema parameters from function parameters
 */
interface FunctionSchemaInput {
	parameters: FunctionParameter[];
	typeDefinitions?: TypeDefinition[];
}

/**
 * Converts function parameters to JSON Schema parameters format
 */
export function functionSchemaToJsonSchemaParameters(schema: FunctionSchemaInput): JsonSchemaParameters {
	const properties: Record<string, JsonSchemaProperty> = {};
	const required: string[] = [];

	for (const param of schema.parameters) {
		properties[param.name] = functionParameterToJsonSchema(param, schema.typeDefinitions);

		if (!param.optional) {
			required.push(param.name);
		}
	}

	return {
		type: 'object',
		properties,
		required,
		additionalProperties: false,
	};
}

/**
 * Converts a FunctionJsonSchema to a standard JSON Schema tool definition
 * (OpenAI/Anthropic compatible format)
 */
export function functionSchemaToJsonSchemaToolDefinition(schema: FunctionJsonSchema): JsonSchemaToolDefinition {
	return {
		type: 'function',
		function: {
			name: schema.name,
			description: schema.description,
			parameters: schema.inputSchema,
		},
	};
}

/**
 * Converts an array of FunctionJsonSchemas to JSON Schema tool definitions
 */
export function functionSchemasToJsonSchemaToolDefinitions(schemas: FunctionJsonSchema[]): JsonSchemaToolDefinition[] {
	return schemas.map(functionSchemaToJsonSchemaToolDefinition);
}
