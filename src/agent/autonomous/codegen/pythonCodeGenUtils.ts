import { extractLastXmlTagContent } from '#agent/autonomous/codegen/codegenAutonomousAgentUtils';
import type { FunctionParameter, FunctionSchema } from '#functionSchema/functions';
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

async def main():
${pythonMainFnCode
	.split('\n')
	.map((line) => `    ${line}`)
	.join('\n')}

main()`.trim();
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
	// Unproxy already if caller hasn’t
	args = args.map((a) => (typeof a?.toJs === 'function' ? a.toJs() : a));

	const potentialKwargs =
		args.length === 1 && typeof args[0] === 'object' && args[0] !== null && !Array.isArray(args[0]) ? (args[0] as Record<string, unknown>) : null;

	const isKeywordArgs = potentialKwargs ? isKeywordArgumentCall(potentialKwargs, expectedParamNames) : false;

	const parameters: Record<string, any> = {};
	let finalArgs: any[];

	if (isKeywordArgs) {
		logger.debug(`Detected keyword arguments: ${JSON.stringify(potentialKwargs)}`);
		finalArgs = [];
		// Reconstruct the arguments array in the order defined by the schema
		for (const paramName of expectedParamNames) {
			const snakeName = camelToSnake(paramName);
			const value = Object.hasOwn(potentialKwargs, paramName) ? potentialKwargs[paramName] : potentialKwargs[snakeName];
			finalArgs.push(value);
			if (Object.hasOwn(potentialKwargs, paramName) || Object.hasOwn(potentialKwargs, snakeName)) {
				parameters[paramName] = value;
			}
		}
	} else {
		if (potentialKwargs)
			logger.warn(
				`Keyword object did not match expected keys. Received ${JSON.stringify(Object.keys(potentialKwargs))}, expected ${JSON.stringify(expectedParamNames)}`,
			);
		finalArgs = args;
		// Populate parameters for logging history based on position
		for (let i = 0; i < finalArgs.length; i++) {
			if (expectedParamNames[i]) parameters[expectedParamNames[i]] = finalArgs[i];
			else parameters[`arg_${i}`] = finalArgs[i];
		}
	}

	// Final un-proxy on parameters / finalArgs
	for (const [k, v] of Object.entries(parameters)) if (v?.toJs) parameters[k] = v.toJs();
	finalArgs = finalArgs.map((a) => (a?.toJs ? a.toJs() : a));

	return { finalArgs, parameters };
}

/**
 * Converts the JSON function schemas to Python function declarations with docString
 * @param jsonDefinitions The JSON object containing function schemas
 * @returns A string containing the functions
 */
export function convertJsonToPythonDeclaration(jsonDefinitions: FunctionSchema[]): string {
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
	if (!originalTsType) {
		return '';
	}

	// 1. Strip Promise wrapper first
	const processedType = originalTsType.replace(/^Promise<(.+)>$/, '$1').trim();
	if (!processedType) {
		return 'None'; // Handle Promise<void>
	}

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
	if (processedType === 'Uint8Array' || processedType === 'Buffer' || processedType === 'ArrayBuffer') {
		return 'bytes';
	}
	if ((processedType.startsWith('{') && processedType.endsWith('}') && processedType.includes(':')) || processedType === 'object') {
		return 'Dict[str, Any]';
	}

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
 * Extracts the text within <python-code></python-code> tags
 * @param llmResponse response from the LLM
 */
export function extractPythonCode(llmResponse: string): string {
	const index = llmResponse.lastIndexOf('<python-code>');
	if (index < 0) {
		logger.error(llmResponse);
		throw new Error('Could not find <python-code> in response');
	}

	const resultText = llmResponse.slice(index);
	const regexXml = /<python-code>(.*)<\/python-code>/is;
	const matchXml = regexXml.exec(resultText);

	if (!matchXml) throw new Error(`Could not find <python-code></python-code> in the response \n${resultText}`);

	const xmlContents = matchXml[1].trim();
	return removePythonMarkdownWrapper(xmlContents);
}

/**
 * Extracts the text within <draft-python-code></draft-python-code> tags.
 * @param llmResponse response from the LLM
 */
export function extractDraftPythonCode(llmResponse: string): string {
	return extractLastXmlTagContent(llmResponse, 'draft-python-code');
}
