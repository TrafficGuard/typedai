import { DOMParser } from 'xmldom';
import { logger } from '#o11y/logger';
import type { FunctionCalls } from './llm';

/**
 * Extracts the function call details from an LLM response.
 * The XML will be in the format described in the xml-agent-system-prompt files
 * @param response
 * @returns the function call parameters
 */
export function parseFunctionCallsXml(response: string): FunctionCalls {
	const funcCallIndex = response.lastIndexOf('<function_calls>');
	if (funcCallIndex < 0) throw new Error('Could not find <function_calls> in the response');
	const xmlString = response.slice(funcCallIndex);

	const parser = new DOMParser();
	// TODO if XML parsing fails because of a syntax error we could have a fallback using a LLM to parse the result
	const doc = parser.parseFromString(xmlString, 'text/xml');

	const functionCallsHolder: FunctionCalls = { functionCalls: [] };

	const functionCalls = doc.getElementsByTagName('function_call');
	for (let i = 0; i < functionCalls.length; i++) {
		const functionCall = functionCalls[i];

		const functionName = functionCall.getElementsByTagName('function_name')[0].textContent;
		const parameters: { [key: string]: string } = {};
		const params = functionCall.getElementsByTagName('parameters')[0];
		if (params) {
			const nodeList: NodeList = params.childNodes;
			for (const node of Object.values(nodeList)) {
				// if node is an element
				if (node.nodeType !== 1) continue;
				const param = node as Element;

				if (param.tagName === 'parameter') {
					const paramName = param.getElementsByTagName('name')[0].textContent.trim();
					const paramValue = param.getElementsByTagName('value')[0].textContent.trim();
					// const param = params[j];
					// const paramName = param.tagName;
					// const paramValue = param.textContent;
					parameters[paramName] = paramValue;
				} else {
					const paramName = param.tagName;
					const paramValue = param.textContent;
					parameters[paramName] = paramValue;
				}
			}
		}
		functionCallsHolder.functionCalls.push({
			function_name: functionName,
			parameters: parameters,
		});
	}

	return functionCallsHolder;
}

/**
 * Parses text into an object.
 * The provided string may be a well-formed JSON string, or it might be wrapped in markdown lines (i.e. starting with the line ```json and ending with the line ```)
 * @param rawText
 */
export function extractJsonResult(rawText: string): any {
	let text = rawText.trim();
	try {
		const jsonMarkdownIndex = rawText.toLowerCase().lastIndexOf('```json');
		if (jsonMarkdownIndex > -1 && text.endsWith('```')) {
			return JSON.parse(text.slice(jsonMarkdownIndex + 7, -3));
		}

		const regex = /```[jJ][sS][oO][nN]\n({.*})\n```/s;
		const match = regex.exec(text);
		if (match) {
			return JSON.parse(match[1]);
		}

		const regexXml = /<json>(.*)<\/json>/is;
		const matchXml = regexXml.exec(text);
		if (matchXml) {
			let match = matchXml[1].trim();
			if (match.startsWith('```json') && text.endsWith('```')) match = match.slice(7, -3);
			return JSON.parse(match);
		}

		// Sometimes more than three trailing backticks
		while (text.endsWith('`')) {
			text = text.slice(0, -1);
		}
		// If there's some chit-chat before the JSON then remove it.
		const firstSquare = text.indexOf('[');
		const fistCurly = text.indexOf('{');
		if (fistCurly > 0 || firstSquare > 0) {
			if (firstSquare < 0) text = text.slice(fistCurly);
			else if (fistCurly < 0) text = text.slice(firstSquare);
			else text = text.slice(Math.min(firstSquare, fistCurly));
		}

		return JSON.parse(text);
	} catch (e) {
		logger.error(`Could not parse:\n${text}`);
		throw e;
	}
}

/**
 * Extracts the text within <tagName></tagName> tags
 * @param response response from the LLM
 * @param tagName the name of the XML tag to extract the contents of
 */
export function extractTag(response: string, tagName: string): string {
	const index = response.lastIndexOf(`<${tagName}>`);
	if (index < 0) throw new Error(`Could not find <${tagName}> in response`);
	const resultText = response.slice(index);
	const regexXml = new RegExp(`<${tagName}>(.*)<\/${tagName}>`, 'is');
	const matchXml = regexXml.exec(resultText);

	if (!matchXml) throw new Error(`Could not find <${tagName}></${tagName}> in the response \n${response}`);

	return matchXml[1].trim();
}

/**
 * Extracts reasoning text and a JSON object from a raw text response.
 * Expects the JSON to be in a ```json ... ``` markdown block or a <json> ... </json> XML block,
 * ideally at the end of the text.
 * @param rawText The raw text response from the LLM.
 * @returns An object containing the reasoning, the parsed JSON object, and the raw JSON string.
 * @throws Error if a structured JSON block is not found and the text cannot be parsed as plain JSON.
 * @throws SyntaxError if the extracted JSON string is malformed.
 */
export function extractReasoningAndJson<T>(rawText: string): { reasoning: string; object: T; jsonString: string } {
	const text = rawText.trim();

	// Pattern for ```json ... ```
	const mdRegex = /([\s\S]*?)```[jJ][sS][oO][nN]\s*([\s\S]+?)\s*```/s;
	// Pattern for <json> ... </json>
	const xmlRegex = /([\s\S]*?)<json>\s*([\s\S]+?)\s*<\/json>/is;

	let match = text.match(mdRegex);
	let jsonString: string | undefined;
	let reasoning: string | undefined;

	if (match) {
		reasoning = match[1].trim();
		jsonString = match[2].trim();
	} else {
		match = text.match(xmlRegex);
		if (match) {
			reasoning = match[1].trim();
			jsonString = match[2].trim();
			// Handle case where <json> block itself contains a ```json ... ``` block
			const innerMdMatch = jsonString.match(/^```[jJ][sS][oO][nN]\s*([\s\S]+?)\s*```$/s);
			if (innerMdMatch) {
				jsonString = innerMdMatch[1].trim();
			}
		}
	}

	if (jsonString !== undefined && reasoning !== undefined) {
		try {
			const object = JSON.parse(jsonString) as T;
			return { reasoning, object, jsonString };
		} catch (e: any) {
			logger.error(e, `Failed to parse extracted JSON string. Reasoning: "${reasoning}", JSON String: "${jsonString}"`);
			throw new SyntaxError(`Failed to parse JSON content: ${e.message}. Extracted JSON string: "${jsonString}"`);
		}
	}

	// Fallback: If no markdown or XML block is found at the end,
	// try to parse the entire text as JSON, assuming no reasoning.
	try {
		const object = JSON.parse(text) as T;
		return { reasoning: '', object, jsonString: text };
	} catch (e) {
		// This catch means it's not plain JSON either.
	}

	logger.error(`Failed to find a structured JSON block (markdown or XML) at the end of the text, and the entire text is not valid JSON. Text: ${rawText}`);
	throw new Error('Failed to extract structured JSON. Expected ```json ... ``` or <json> ... </json> block at the end, or the entire response to be plain JSON.');
}
