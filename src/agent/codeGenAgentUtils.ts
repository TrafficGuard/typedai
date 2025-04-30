import type { FunctionParameter, FunctionSchema } from '#functionSchema/functions';
import { logger } from '#o11y/logger';

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
 * Extracts text content from a specified XML-like tag.
 * Searches from the end of the string for the last occurrence.
 * Returns an empty string if the tag is not found.
 * @param llmResponse The full response string from the LLM.
 * @param tagName The name of the tag (e.g., 'expanded_user_request').
 * @returns The extracted text content or an empty string.
 */
export function extractLastXmlTagContent(llmResponse: string, tagName: string): string {
	const openTag = `<${tagName}>`;
	const closeTag = `</${tagName}>`;
	const startIndex = llmResponse.lastIndexOf(openTag);

	if (startIndex === -1) {
		// logger.warn(`Could not find opening tag <${tagName}> in response`);
		return ''; // Return empty string if start tag not found
	}

	const endIndex = llmResponse.indexOf(closeTag, startIndex);

	if (endIndex === -1) {
		// logger.warn(`Could not find closing tag </${tagName}> after index ${startIndex} in response`);
		return ''; // Return empty string if end tag not found after start tag
	}

	// Add length of the opening tag to get the start of the content
	const contentStart = startIndex + openTag.length;
	return llmResponse.substring(contentStart, endIndex).trim();
}

/**
 * Extracts the text within <expanded_user_request></expanded_user_request> tags.
 * @param llmResponse response from the LLM
 */
export function extractExpandedUserRequest(llmResponse: string): string {
	return extractLastXmlTagContent(llmResponse, 'expanded_user_request');
}

/**
 * Extracts the text within <observations-reasoning></observations-reasoning> tags.
 * @param llmResponse response from the LLM
 */
export function extractObservationsReasoning(llmResponse: string): string {
	return extractLastXmlTagContent(llmResponse, 'observations-reasoning');
}

/**
 * Extracts the text within <next_step_details></next_step_details> tags.
 * @param llmResponse response from the LLM
 */
export function extractNextStepDetails(llmResponse: string): string {
	return extractLastXmlTagContent(llmResponse, 'next_step_details');
}

/**
 * Extracts the text within <plan></plan> tags.
 * @param llmResponse response from the LLM
 */
export function extractAgentPlan(llmResponse: string): string {
	return extractLastXmlTagContent(llmResponse, 'plan');
}
