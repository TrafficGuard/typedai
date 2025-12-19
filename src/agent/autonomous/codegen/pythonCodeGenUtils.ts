import { extractLastXmlTagContent } from '#agent/autonomous/codegen/codegenAutonomousAgentUtils';
import type { FunctionJsonSchema, FunctionParameter } from '#functionSchema/functions';
import type { TypeDefinition } from '#functionSchema/typeDefinition';
import { logger } from '#o11y/logger';

/** Packages that the agent generated code is allowed to use */
const ALLOWED_PYTHON_IMPORTS = ['json', 're', 'math', 'datetime'];

/**
 * Converts the python code produced by the agent LLM to the complete script which will be executed
 * @param pythonMainFnCode python code
 */
export function mainFnCodeToFullScript(pythonMainFnCode: string): string {
	// Add the imports from the allowed packages being used in the script
	let pythonScript = ALLOWED_PYTHON_IMPORTS.filter((pkg) => pythonMainFnCode.includes(`${pkg}.`) || pkg === 'json') // always need json for JsProxyEncoder
		.map((pkg) => `import ${pkg}\n`)
		.join('\n');

	pythonScript += `
from typing import Any, List, Dict, Tuple, Optional, Union, TypedDict, Callable, Iterable, Mapping, Sequence, Set, Final
from pyodide.ffi import JsProxy

class ImageSource:
    def __init__(self, type: str, source: str, data: Dict[int, str]):
        self.type = type
        self.source = source
        self.data = data
        
class JsProxyEncoder(json.JSONEncoder):
    def default(self, obj):
        if isinstance(obj, JsProxy):
            return obj.to_py()
        # Let the base class default method raise the TypeError
        return super().default(obj)

`.trim();
	pythonScript += `\n\n${pythonMainFnCode}`;
	return pythonScript;
}

/**
 * Utility helpers shared by the CodeGen agent for analysing / transforming
 * Python-generated function calls coming back through Pyodide.
 */

/**
 * Convert a camelCase or PascalCase string to snake_case.
 */
export function camelToSnake(camel: string): string {
	return camel
		.replace(/([A-Z]+)/g, '_$1')
		.replace(/^_/, '')
		.toLowerCase();
}

/**
 * Returns true if the supplied object looks like a keyword-argument map for the
 * provided parameter names.  A key is considered a match if it is exactly the
 * camelCase parameter name or its snake_case equivalent.
 */
export function isKeywordArgumentCall(argObj: unknown, expectedParamNames: string[]): boolean {
	if (typeof argObj !== 'object' || argObj === null || Array.isArray(argObj)) return false;

	const keys = Object.keys(argObj as Record<string, unknown>);
	if (keys.length === 0) return false;

	// Allow both camelCase and snake_case
	const allowedKeys = new Set<string>();
	for (const name of expectedParamNames) {
		allowedKeys.add(name);
		allowedKeys.add(camelToSnake(name));
	}

	return keys.every((k) => allowedKeys.has(k));
}

/**
 * Normalises positional / keyword-argument calls coming from the generated
 * Python and returns the arguments in correct positional order together with a
 * parameter map for history/logging.
 *
 * Accepts both camelCase and snake_case keyword names.
 */
export function processFunctionArguments(args: any[], expectedParamNames: string[]): { finalArgs: any[]; parameters: Record<string, any> } {
	// Unproxy the top-level arguments. A dict of kwargs will become a JS object
	// but its values (e.g., lists) might still be proxies if toJs is not fully recursive on them.
	// We use dict_converter to get plain objects instead of Maps.
	args = args.map((a) => (typeof a?.toJs === 'function' ? a.toJs({ dict_converter: Object.fromEntries }) : a));

	const potentialKwargs =
		args.length === 1 && typeof args[0] === 'object' && args[0] !== null && !Array.isArray(args[0]) ? (args[0] as Record<string, unknown>) : null;

	const isKeywordArgs = potentialKwargs ? isKeywordArgumentCall(potentialKwargs, expectedParamNames) : false;

	let finalArgs: any[];

	if (isKeywordArgs) {
		logger.debug(`Detected keyword arguments: ${JSON.stringify(potentialKwargs)}`);
		finalArgs = [];
		// Reconstruct the arguments array in the order defined by the schema.
		// The values may still be proxies if they were nested.
		const kwargs = potentialKwargs ?? {};
		for (const paramName of expectedParamNames) {
			const snakeName = camelToSnake(paramName);
			const value = Object.hasOwn(kwargs, paramName) ? kwargs[paramName] : kwargs[snakeName];
			finalArgs.push(value);
		}
	} else {
		if (potentialKwargs)
			logger.warn(
				`Keyword object did not match expected keys. Received ${JSON.stringify(Object.keys(potentialKwargs))}, expected ${JSON.stringify(expectedParamNames)}`,
			);
		finalArgs = args;
	}

	// Now, deep-convert any remaining proxies in finalArgs. This is the definitive conversion.
	// This ensures that even if the initial toJs was shallow, everything is converted before use.
	finalArgs = finalArgs.map((a) => (a?.toJs ? a.toJs({ dict_converter: Object.fromEntries }) : a));

	// Finally, build the `parameters` object for logging from the fully converted `finalArgs`.
	const parameters: Record<string, any> = {};
	if (isKeywordArgs) {
		// For keyword args, only include parameters that were actually passed.
		const kwargs = potentialKwargs ?? {};
		for (let i = 0; i < expectedParamNames.length; i++) {
			const paramName = expectedParamNames[i];
			const snakeName = camelToSnake(paramName);
			if (Object.hasOwn(kwargs, paramName) || Object.hasOwn(kwargs, snakeName)) {
				parameters[paramName] = finalArgs[i];
			}
		}
	} else {
		// For positional args, map them directly.
		for (let i = 0; i < finalArgs.length; i++) {
			if (expectedParamNames[i]) {
				parameters[expectedParamNames[i]] = finalArgs[i];
			} else {
				parameters[`arg_${i}`] = finalArgs[i];
			}
		}
	}

	return { finalArgs, parameters };
}

/**
 * Converts the JSON function schemas to Python function declarations with docString
 * @param jsonDefinitions The JSON object containing function schemas
 * @returns A string containing the functions
 */
export function convertJsonToPythonDeclaration(jsonDefinitions: FunctionJsonSchema[]): string {
	let functions = '<functions>';

	for (const def of jsonDefinitions) {
		functions += `
fun ${def.name}(${def.parameters.map((p) => `${p.name}: ${p.optional ? `Optional[${pythonType(p)}]` : pythonType(p)}`).join(', ')}) -> ${
			def.returnType ? convertTypeScriptToPython(def.returnType) : 'None'
		}
    """
    ${def.description}

    Args:
        ${def.parameters.map((p) => `${p.name}: ${p.description}`).join('\n        ')}
    ${def.returns ? `Returns:\n        ${def.returns}\n    """` : '"""'}
	`;
	}
	functions += '\n</functions>';
	// arg and return typings. Shouldn't need to duplicate in the docstring
	// (${p.optional ? `Optional[${type(p)}]` : type(p)}):
	// ${def.returnType}:
	return functions;
}

export function convertTypeScriptToPython(tsType: string): string {
	// 0. Handle base cases and trim input
	const originalTsType = tsType.trim();
	if (!originalTsType) return '';

	// 1. Strip Promise wrapper first
	const processedType = originalTsType.replace(/^Promise<(.+)>$/, '$1').trim();
	if (!processedType) return 'None'; // Handle Promise<void>

	// 2. Handle Unions by splitting and recursion
	// Always try splitting by '|' and recurse on parts.
	// This relies on subsequent steps correctly handling partial/full types.
	if (processedType.includes('|')) {
		// Avoid splitting if inside quotes (e.g., literal types - not handled here yet)
		// Basic check: if no < or { are involved, split directly
		// If < or { are involved, assume it's complex and let later steps handle maybe?
		// Let's try splitting always for now and see if recursion handles it.
		return processedType
			.split('|')
			.map((part) => convertTypeScriptToPython(part.trim())) // Recursive call for each part
			.join(' | ');
	}

	// --- Process Single Type Part ---

	// 3. Handle specific known types first (Binary, Object Literal, object keyword)
	if (processedType === 'Uint8Array' || processedType === 'Buffer' || processedType === 'ArrayBuffer') return 'bytes';
	if ((processedType.startsWith('{') && processedType.endsWith('}') && processedType.includes(':')) || processedType === 'object') return 'Dict[str, Any]';

	// 4. Handle base keywords
	const keywordMappings: { [key: string]: string } = {
		string: 'str',
		number: 'float',
		boolean: 'bool',
		any: 'Any',
		void: 'None',
		undefined: 'None',
		null: 'None',
	};
	if (keywordMappings[processedType]) {
		return keywordMappings[processedType];
	}

	// 5. Handle Generics (Array<T>, Record<string, T>) - Allow whitespace
	// Match Array < ... >
	// Regex: Start, 'Array', optional space, '<', optional space, capture content, optional space, '>', optional space, End
	const arrayMatch = processedType.match(/^Array\s*<\s*(.+)\s*>\s*$/);
	if (arrayMatch) {
		const innerType = arrayMatch[1];
		return `List[${convertTypeScriptToPython(innerType)}]`; // Recurse on inner type
	}

	// Match Record < string , ... >
	// Regex: Start, 'Record', optional space, '<', optional space, 'string', optional space, ',', optional space, capture content, optional space, '>', optional space, End
	const recordMatch = processedType.match(/^Record\s*<\s*string\s*,\s*(.+)\s*>\s*$/);
	if (recordMatch) {
		const valueType = recordMatch[1];
		return `Dict[str, ${convertTypeScriptToPython(valueType)}]`; // Recurse on value type
	}

	// 6. If none matched, return the processed type as is
	return processedType;
}

export function pythonType(param: FunctionParameter): string {
	return convertTypeScriptToPython(param.type);
}

/**
 * Sometimes an LLM will wrap the reformatted code in Markdown tags, remove them if there.
 * @param code
 */
export function removePythonMarkdownWrapper(code: string): string {
	if (code.startsWith('```python') && code.endsWith('```')) {
		// Remove the markdown lines
		code = code.slice(9, -3).trim();
	}
	return code;
}

/**
 * Extracts the text within <agent:python_code></agent:python_code> tags.
 * @param llmResponse response from the LLM
 */
export function extractPythonCode(llmResponse: string): string {
	const agentCodeMatches = [...llmResponse.matchAll(/<agent:python_code\b[^>]*>([\s\S]*?)<\/agent:python_code>/gi)];
	if (agentCodeMatches.length === 0) {
		logger.error(llmResponse);
		throw new Error('Could not find <agent:python_code> in response');
	}
	const lastMatch = agentCodeMatches.at(-1)!;
	return removePythonMarkdownWrapper(lastMatch[1].trim());
}

/**
 * Extracts the text within the FIRST <agent:python_code> tags if there is more than one.
 * @param llmResponse response from the LLM
 */
export function extractDraftPythonCode(llmResponse: string): string | undefined {
	// Prioritize the new <agent:python_code> tag, taking the FIRST occurrence
	const agentCodeMatch = llmResponse.match(/<agent:python_code\b[^>]*>([\s\S]*?)<\/agent:python_code>/i);
	if (agentCodeMatch && agentCodeMatch.length > 1) {
		return removePythonMarkdownWrapper(agentCodeMatch[0].trim());
	}
	return undefined;
}

/**
 * Converts a TypeScript type to a Python type annotation for use in TypedDict.
 * Uses modern Python syntax (list, dict instead of List, Dict).
 * @param tsType The TypeScript type string
 * @returns The Python type annotation
 */
export function convertTypeScriptTypeToPython(tsType: string): string {
	const trimmed = tsType.trim();

	// Handle basic types
	const basicTypes: Record<string, string> = {
		string: 'str',
		number: 'int',
		boolean: 'bool',
		any: 'Any',
		void: 'None',
		null: 'None',
		undefined: 'None',
	};

	if (basicTypes[trimmed]) {
		return basicTypes[trimmed];
	}

	// Handle array types (both T[] and Array<T> syntax)
	if (trimmed.endsWith('[]')) {
		const elementType = trimmed.slice(0, -2);
		return `list[${convertTypeScriptTypeToPython(elementType)}]`;
	}

	const arrayMatch = trimmed.match(/^Array<(.+)>$/);
	if (arrayMatch) {
		return `list[${convertTypeScriptTypeToPython(arrayMatch[1])}]`;
	}

	// Handle Record<string, T>
	const recordMatch = trimmed.match(/^Record<string,\s*(.+)>$/);
	if (recordMatch) {
		return `dict[str, ${convertTypeScriptTypeToPython(recordMatch[1])}]`;
	}

	// Handle union types
	if (trimmed.includes('|')) {
		const parts = trimmed.split('|').map((p) => p.trim());

		// Special case: T | null or T | undefined => Optional[T]
		if (parts.includes('null') || parts.includes('undefined')) {
			const nonNullParts = parts.filter((p) => p !== 'null' && p !== 'undefined');
			if (nonNullParts.length === 1) {
				return `Optional[${convertTypeScriptTypeToPython(nonNullParts[0])}]`;
			}
		}

		// Other unions: convert each part and join with |
		return parts.map((p) => convertTypeScriptTypeToPython(p)).join(' | ');
	}

	// Keep custom types (interfaces) as-is
	return trimmed;
}

/**
 * Converts a TypeDefinition to a Python TypedDict class declaration
 * @param typeDef The interface definition to convert
 * @returns Python TypedDict class code
 */
export function convertInterfaceToTypedDict(typeDef: TypeDefinition): string {
	const lines: string[] = [];

	// Determine if we need total=False (when we have mix of required and optional)
	const hasOptional = typeDef.properties.some((p) => p.optional);
	const hasRequired = typeDef.properties.some((p) => !p.optional);
	const useTotalFalse = hasOptional && hasRequired;

	// Class declaration
	if (useTotalFalse) {
		lines.push(`class ${typeDef.name}(TypedDict, total=False):`);
	} else {
		lines.push(`class ${typeDef.name}(TypedDict):`);
	}

	// Class docstring
	if (typeDef.description) {
		lines.push(`    """${typeDef.description}"""`);
	}

	// Properties
	for (const prop of typeDef.properties) {
		const pythonName = camelToSnake(prop.name);
		let pythonType = convertTypeScriptTypeToPython(prop.type);

		// If using total=False, wrap required fields with Required[]
		if (useTotalFalse && !prop.optional) {
			pythonType = `Required[${pythonType}]`;
		}

		// Add the property
		lines.push(`    ${pythonName}: ${pythonType}`);

		// Add property description as inline docstring
		if (prop.description) {
			lines.push(`    """${prop.description}"""`);
		}
	}

	return lines.join('\n');
}

/**
 * Generates the type definitions section for the Python script
 * @param typeDefinitions Array of type definitions to generate
 * @returns Python code with all TypedDict definitions, or empty string if no definitions
 */
export function generateTypeDefinitionsSection(typeDefinitions: TypeDefinition[]): string {
	if (!typeDefinitions || typeDefinitions.length === 0) {
		return '';
	}

	// Remove duplicates based on type name
	const uniqueTypes = new Map<string, TypeDefinition>();
	for (const typeDef of typeDefinitions) {
		if (!uniqueTypes.has(typeDef.name)) {
			uniqueTypes.set(typeDef.name, typeDef);
		}
	}

	// Generate TypedDict for each unique type
	const typeDeclarations = Array.from(uniqueTypes.values()).map((typeDef) => convertInterfaceToTypedDict(typeDef));

	// Join with double newlines for spacing
	return typeDeclarations.join('\n\n');
}
