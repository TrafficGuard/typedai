import { FunctionParameter, FunctionSchema } from '#functionSchema/functions';

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
	const typeMappings: { [key: string]: string } = {
		string: 'str',
		number: 'float',
		boolean: 'bool',
		any: 'Any',
		void: 'None',
		undefined: 'None',
		null: 'None',
		// Include generics mapping as well
		'Array<': 'List<',
	};

	let pyType = tsType;

	for (const [mappedTsType, pyTypeEquivalent] of Object.entries(typeMappings)) {
		const regex = new RegExp(`\\b${mappedTsType}\\b`, 'g'); // Boundary to match whole words
		pyType = pyType.replace(regex, pyTypeEquivalent);
	}
	return pyType;
}

export function pythonType(param: FunctionParameter): string {
	return convertTypeScriptToPython(param.type);
}

/**
 * Extracts the text within <python-code></python-code> tags
 * @param llmResponse response from the LLM
 */
export function extractPythonCode(llmResponse: string): string {
	const index = llmResponse.lastIndexOf('<python-code>');
	if (index < 0) throw new Error('Could not find <python-code> in response');
	const resultText = llmResponse.slice(index);
	const regexXml = /<python-code>(.*)<\/python-code>/is;
	const matchXml = regexXml.exec(resultText);

	if (!matchXml) throw new Error(`Could not find <python-code></python-code> in the response \n${resultText}`);

	const xmlContents = matchXml[1].trim();
	return removePythonMarkdownWrapper(xmlContents);
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
