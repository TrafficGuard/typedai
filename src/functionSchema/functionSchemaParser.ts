import { readFileSync, writeFileSync } from 'node:fs';
import fs, { writeFile } from 'node:fs';
import path, { join } from 'node:path';
import { promisify } from 'node:util';
import {
	type ClassDeclaration,
	type Decorator,
	type InterfaceDeclaration,
	type JSDoc,
	type JSDocTag,
	type MethodDeclaration,
	type ParameterDeclaration,
	Project,
	type PropertySignature,
	type SourceFile,
	type Type,
} from 'ts-morph';
import { systemDir } from '#app/appDirs';
import { FUNC_DECORATOR_NAME } from '#functionSchema/functionSchemaTypes';
import { logger } from '#o11y/logger';
import { type FunctionJsonSchema, functionSchemaToJsonSchemaParameters } from './functionSchemaToJsonSchema';
import type { FunctionParameter } from './functions';
import type { TypeDefinition, TypeProperty } from './typeDefinition';

const writeFileAsync = promisify(writeFile);

const getCachedBasePath = () => `${systemDir()}/functions/`;

/**
 * Parses a source file which is expected to have a class with the @funClass decorator.
 *
 * The JSON function schema is cached to file to avoid the overhead of ts-morph on startup.
 *
 * With the example class:
 * <code>
 * \@funcClass(__filename)
 * export class FuncClass {
 *    /**
 *     * Description of simple method
 *     *\/
 *    \@func()
 *    simpleMethod(): void {}
 *
 *   /**
 *     * Description of complexMethod
 *     * \@param {string} arg1 the first arg
 *     * \@param {number} arg2 the second arg
 *     * \@return Promise<Date> the current date
 *     *\/
 *    \@func()
 *    async complexMethod(arg1: string, arg2?: number): Promise<Date> {
 *        return new Date()
 *    }
 * }
 * </code>
 * Then the parsed result would be:
 * {
 * 	 "FuncClass_simpleMethod": {
 *      "name": "FuncClass_simpleMethod",
 *      "class": "FuncClass",
 *      "description": "Description of simple method",
 *      "returns": "",
 *      "params": []
 *    },
 * 	  "FuncClass_complexMethod": {
 *      "name": "FuncClass_complexMethod",
 *      "class": "FuncClass",
 *      "description": "Description of complexMethod",
 *      "returns": "Date - the current date",
 *      "params": [
 *          {
 *          	"name": "arg1",
 *          	"type": "string",
 *          	"description": "the first arg"
 *          },
 *          {
 *            "name": "arg2",
 *            "type": "string",
 *            "description": "the second arg",
 *            "optional": true
 *          }
 *      ]
 *   }
 * }
 * @param {string} sourceFilePath the full path to the source file
 * @returns An object containing FunctionJsonSchema objects
 */
export function functionSchemaParser(sourceFilePath: string): Record<string, FunctionJsonSchema> {
	const cwd = process.cwd();
	let cachedPath = path.relative(cwd, sourceFilePath);
	// trim the .ts file extension
	cachedPath = cachedPath.slice(0, cachedPath.length - 3);
	cachedPath = path.join(getCachedBasePath(), cachedPath);

	const sourceUpdatedTimestamp = getFileUpdatedTimestamp(sourceFilePath);
	const jsonUpdatedTimestamp = getFileUpdatedTimestamp(`${cachedPath}.json`);

	// If the cached schemas are newer than or equal to the source file, then we can use them
	// Using >= handles fresh git checkouts where all files have the same timestamp
	if (jsonUpdatedTimestamp && sourceUpdatedTimestamp && jsonUpdatedTimestamp >= sourceUpdatedTimestamp) {
		try {
			const json = readFileSync(`${cachedPath}.json`).toString();
			if (logger) logger.debug(`Loading cached function schemas from ${cachedPath}.json`);
			return JSON.parse(json);
		} catch (e) {
			if (logger) logger.info(`Error loading cached function schemas: ${e.message}`);
			else console.log(`Error loading cached function schemas: ${e.message}`);
		}
	}

	logger.info(`Generating schema for ${sourceFilePath}`);
	const project = new Project();
	// create the temp file in the same dir as the source file so the imports are resolved
	const tempPath = join(sourceFilePath, '..', 'temp.ts');
	const sourceFile = project.createSourceFile(tempPath, readFileSync(sourceFilePath, 'utf8'));

	const classes = sourceFile.getClasses();

	const functionSchemas: Record<string, FunctionJsonSchema> = {};

	classes.forEach((cls: ClassDeclaration) => {
		const className = cls.getName()!;

		cls.getMethods().forEach((method: MethodDeclaration) => {
			const methodName = method.getName();
			const methodDescription = method.getJsDocs()[0]?.getDescription().trim() ?? '';

			const hasFuncDecorator = method.getDecorators().some((decorator: Decorator) => decorator.getName() === FUNC_DECORATOR_NAME);
			if (!hasFuncDecorator) return;

			if (method.getJsDocs().length === 0) {
				logger.warn(`No JSDocs found for ${methodName}. Skipping function schema`);
				return;
			}

			const jsDocs: JSDoc | undefined = method.getJsDocs()[0];
			let returns = '';
			let returnType = '';
			let rawReturnType = '';
			const paramDescriptions = {};
			let paramIndex = 0;
			jsDocs?.getTags().forEach((tag: JSDocTag) => {
				if (tag.getTagName() === 'returns' || tag.getTagName() === 'return') {
					rawReturnType = method.getReturnType().getText();
					// Normalize the return type (remove Promise wrapper and import paths)
					returnType = normalizeReturnType(rawReturnType);

					returns = tag.getText().replace('@returns', '').replace('@return', '').trim();
					// Remove type information from returns if present
					if (returns.startsWith('{') && returns.includes('}')) {
						returns = returns.slice(returns.indexOf('}') + 1).trim();
					}
					if (returns.length) {
						returns = returns.charAt(0).toUpperCase() + returns.slice(1);
					}
				}
				if (tag.getTagName() === 'param') {
					// For a @param tag the getText() should be in the format
					// @param {number} a - The first number to add.
					// We will handle the type (e.g. {number}) being optional, as it's not required.
					// And handle the dash "-" separator being optional
					// The @params must be in the same order and have the same name as the function arguments

					const text = tag.getText().trim();

					// remove the @param tag
					let descriptionParts = text.split(' ').slice(1);
					// remove the type if there is one
					if (descriptionParts[0]?.startsWith('{')) {
						const closingBrace = descriptionParts.findIndex((value) => value.trim().endsWith('}'));
						descriptionParts = descriptionParts.slice(closingBrace + 1);
					}
					// Remove the arg name, which must match the actual argument name
					const argName = method.getParameters()[paramIndex]?.getName()!;
					if (descriptionParts[0]?.trim() === argName) {
						descriptionParts = descriptionParts.slice(1);
						paramIndex++;
					} else {
						throw new Error(`JSDoc param name ${descriptionParts[0]} does not match arg name ${argName} for ${className}.${methodName}`);
					}
					if (descriptionParts[0]?.trim() === '-') {
						descriptionParts = descriptionParts.slice(1);
					}
					let description = descriptionParts.join(' ');
					if (description.endsWith('*')) {
						description = description.slice(0, -1).trim();
					}
					if (description.length) {
						description = description.charAt(0).toUpperCase() + description.slice(1);
					}
					logger.debug(`Parsed description for ${className}_${methodName}.${argName} to be: ${description}`);
					paramDescriptions[argName] = description;
				}
			});

			const parameterDeclarations: ParameterDeclaration[] = method.getParameters();
			const params: FunctionParameter[] = [];
			parameterDeclarations.forEach((param, index) => {
				const paramDef: FunctionParameter = {
					index,
					name: param.getName(),
					type: param.getType().getText(),
					description: paramDescriptions[param.getName()] || '',
				};
				if (param.isOptional() || param.hasInitializer()) {
					paramDef.optional = true;
				}
				if (paramDef.description) {
					params.push(paramDef);
				} else {
					logger.info(`No description for param ${className}_${methodName}.${param.getName()}`);
				}
			});

			const funcDef: FunctionJsonSchema = {
				class: className,
				name: `${className}_${methodName}`,
				description: methodDescription,
				parameters: params,
				// inputSchema will be added after all properties are set
				inputSchema: { type: 'object', properties: {}, required: [] },
			};
			if (returnType && returnType !== 'void') {
				funcDef.returnType = returnType;
				if (returns) funcDef.returns = returns;

				// Extract type definitions if return type is a custom interface
				if (rawReturnType && isCustomInterfaceType(rawReturnType)) {
					const typeDefinitions = extractTypeDefinitions(rawReturnType, sourceFile);
					if (typeDefinitions.length > 0) {
						funcDef.typeDefinitions = typeDefinitions;
					}
				}
			}
			// Generate JSON Schema for the function parameters
			funcDef.inputSchema = functionSchemaToJsonSchemaParameters(funcDef);
			functionSchemas[funcDef.name] = funcDef;
		});
	});
	fs.mkdirSync(path.join(cachedPath, '..'), { recursive: true });
	writeFileAsync(`${cachedPath}.json`, JSON.stringify(functionSchemas, null, 2)).catch((e) => logger.info(`Error writing cached schema: ${e.message}`));
	return functionSchemas;
}

function getFileUpdatedTimestamp(filePath: string): Date | null {
	try {
		const stats = fs.statSync(filePath); // Get the stats object
		return stats.mtime; // mtime is the "modified time"
	} catch (error) {
		return null;
	}
}

/**
 * Extracts a simple type name from a potentially complex type string
 * E.g., "import(...).SimpleProject" -> "SimpleProject"
 * E.g., "import(...).SimpleProject[]" -> "SimpleProject"
 * E.g., "Promise<import(...).SimpleProject>" -> "SimpleProject"
 */
function extractSimpleTypeName(typeText: string): string {
	let result = typeText;

	// Remove import path if present (e.g., "import(...).SimpleProject" -> "SimpleProject")
	if (result.includes('import(')) {
		const parts = result.split('.');
		result = parts[parts.length - 1];

		// Remove trailing > from Promise/Generic wrapper (e.g., "SimpleProject>" -> "SimpleProject")
		result = result.replace(/>+$/, '');

		// Remove array brackets (e.g., "SimpleProject[]>" -> "SimpleProject")
		result = result.replace(/\[\]>*/g, '');
	}

	// Remove array brackets for non-import types
	result = result.replace(/\[\]$/, '');

	return result;
}

/**
 * Checks if a type is a custom interface (not a built-in type)
 */
function isCustomInterfaceType(typeText: string): boolean {
	// Check if it contains import path (indicates custom type)
	if (typeText.includes('import(')) {
		return true;
	}

	// Check if it's a simple custom type (starts with uppercase)
	const baseType = extractSimpleTypeName(typeText);
	return /^[A-Z]/.test(baseType) && !['Record', 'Array', 'Promise', 'Map', 'Set'].includes(baseType);
}

/**
 * Normalizes a return type string by removing import paths and Promise wrappers
 */
function normalizeReturnType(typeText: string): string {
	let normalized = typeText;

	// Remove Promise wrapper
	if (normalized.startsWith('Promise<') && normalized.endsWith('>')) {
		normalized = normalized.slice(8, -1);
	}

	// Check if this is an array type
	const isArray = normalized.endsWith('[]') || /\[\]$/.test(normalized);

	// Extract simple name
	const simpleName = extractSimpleTypeName(normalized);

	// Reconstruct with array brackets if needed
	return isArray ? `${simpleName}[]` : simpleName;
}

/**
 * Extracts type definition from an interface declaration
 */
function extractInterfaceDefinition(interfaceDecl: InterfaceDeclaration, sourceFile: SourceFile): TypeDefinition {
	const interfaceName = interfaceDecl.getName();
	const description = interfaceDecl.getJsDocs()[0]?.getDescription().trim();
	const properties: TypeProperty[] = [];
	const dependencies = new Set<string>();

	for (const prop of interfaceDecl.getProperties()) {
		const propName = prop.getName();
		// Use getTypeNode() to get the actual type syntax, not the simplified type
		const typeNode = prop.getTypeNode();
		const propType = typeNode ? typeNode.getText() : prop.getType().getText(prop);
		const isOptional = prop.hasQuestionToken();
		const propDescription = prop.getJsDocs()[0]?.getDescription().trim();

		// Normalize property type (remove import paths)
		let normalizedType = propType;
		if (propType.includes('import(')) {
			const simpleName = extractSimpleTypeName(propType);
			normalizedType = propType.replace(/import\([^)]+\)\./, '');

			// Track dependency if it's a custom type
			if (isCustomInterfaceType(propType) && simpleName !== interfaceName) {
				dependencies.add(simpleName);
			}
		}

		properties.push({
			name: propName,
			type: normalizedType,
			optional: isOptional,
			description: propDescription,
		});
	}

	return {
		name: interfaceName,
		description,
		properties,
		dependencies: dependencies.size > 0 ? Array.from(dependencies) : undefined,
	};
}

/**
 * Finds and extracts interface definition by name from source file
 */
function findInterfaceDefinition(interfaceName: string, sourceFile: SourceFile): TypeDefinition | null {
	const interfaces = sourceFile.getInterfaces();
	const interfaceDecl = interfaces.find((i) => i.getName() === interfaceName);

	if (!interfaceDecl) {
		return null;
	}

	return extractInterfaceDefinition(interfaceDecl, sourceFile);
}

/**
 * Recursively extracts all type definitions for a return type and its dependencies
 */
function extractTypeDefinitions(returnType: string, sourceFile: SourceFile, visited: Set<string> = new Set()): TypeDefinition[] {
	const typeDefinitions: TypeDefinition[] = [];

	// Get the base type name (without array brackets)
	const baseTypeName = extractSimpleTypeName(returnType);

	// Avoid circular dependencies
	if (visited.has(baseTypeName)) {
		return typeDefinitions;
	}
	visited.add(baseTypeName);

	// Find the interface definition
	const typeDef = findInterfaceDefinition(baseTypeName, sourceFile);
	if (!typeDef) {
		return typeDefinitions;
	}

	// Recursively extract dependencies first (so they appear before the main type)
	if (typeDef.dependencies) {
		for (const dep of typeDef.dependencies) {
			const depDefs = extractTypeDefinitions(dep, sourceFile, visited);
			typeDefinitions.push(...depDefs);
		}
	}

	// Add the main type definition
	typeDefinitions.push(typeDef);

	return typeDefinitions;
}

export function generatePythonClass(type: Type): void {
	if (type.isInterface()) {
	} else if (type.isTypeParameter()) {
	}
}
