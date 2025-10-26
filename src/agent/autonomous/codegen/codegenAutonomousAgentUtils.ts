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
 * Extracts the text within <code-review></code-review> tags.
 * @param llmResponse response from the LLM
 */
export function extractCodeReview(llmResponse: string): string {
	return extractLastXmlTagContent(llmResponse, 'code-review');
}

/**
 * Extracts the text within <plan></plan> tags.
 * @param llmResponse response from the LLM
 */
export function extractAgentPlan(llmResponse: string): string {
	return extractLastXmlTagContent(llmResponse, 'plan');
}

/**
 * Extracts python global variable definitions from the last <python:globals> block.
 * @param llmResponse The full response string from the LLM.
 * @returns A record where keys are variable names and values are their string content.
 */
/**
 * Extracts Python global variable definitions from <agent:python_global> tags.
 * Globals can be emitted as independent tags anywhere in the response.
 * Later occurrences of the same variable name will override earlier ones.
 * If no <agent:python_global> tags are found, it falls back to the legacy <python:globals> block.
 * @param llmResponse The full response string from the LLM.
 * @returns A record where keys are variable names and values are their string content.
 */
export function extractPythonGlobals(llmResponse: string): Record<string, string> {
	const globals: Record<string, string> = {};
	let newStyleTagFound = false;

	// Scan for all individual <agent:python_global> tags
	const re = /<agent:python_global\b[^>]*var="([^"]+)"[^>]*>([\s\S]*?)<\/agent:python_global>/gi;
	let m: RegExpExecArray | null;
	// biome-ignore lint/suspicious/noAssignInExpressions: ok
	while ((m = re.exec(llmResponse)) !== null) {
		newStyleTagFound = true;
		const varName = m[1].trim();
		const value = m[2].replace(/\r?$/, ''); // Remove trailing carriage return if present
		if (varName) {
			globals[varName] = value;
		}
	}

	if (newStyleTagFound) {
		return globals; // If any new-style tag found, return the merged content
	}

	// Fallback to legacy <python:globals> block if no new-style tags are present (last one wins)
	const openTag = '<python:globals>';
	const closeTag = '</python:globals>';
	const startIndex = llmResponse.lastIndexOf(openTag);
	if (startIndex === -1) return {}; // No legacy tag either
	const endIndex = llmResponse.indexOf(closeTag, startIndex);
	if (endIndex === -1) return {};

	const globalsBlock = llmResponse.substring(startIndex + openTag.length, endIndex);

	const legacyRe = /<python:global\s+var="([^"]+)"\s*>([\s\S]*?)<\/python:global>/g;
	let legacyM: RegExpExecArray | null;
	const legacyGlobals: Record<string, string> = {}; // Use a separate object for legacy to avoid mixing
	// biome-ignore lint/suspicious/noAssignInExpressions: ok
	while ((legacyM = legacyRe.exec(globalsBlock)) !== null) {
		const varName = legacyM[1].trim();
		const value = legacyM[2].replace(/\r?$/, '');
		if (varName) {
			legacyGlobals[varName] = value;
		}
	}
	return legacyGlobals;
}
