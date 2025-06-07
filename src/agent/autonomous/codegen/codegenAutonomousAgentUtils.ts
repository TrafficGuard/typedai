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
