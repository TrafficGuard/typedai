// We don't want the actual CDATA tokens in the source code, as that would be problematic when we are using
// the framework to edit its own source code, so we'll break it up here for when we need to use it.
export const CDATA_START = '<![' + 'CDATA[';
export const CDATA_END = ']' + ']>';

/**
 * Helper function to decide between CDATA and escaping
 * @param content
 */
export function formatXmlContent(content: string | null | undefined): string {
	const text = content || '';
	// Check if the text contains characters that need CDATA or escaping
	if (/[<>&'"]/.test(text)) {
		// Check if the text contains the CDATA closing sequence ']]>'
		if (text.includes(CDATA_END)) {
			// If it contains ']]>', simple escaping is safer or requires complex CDATA handling.
			// For simplicity, we'll just escape it here.
			// A more robust solution might split the string and rejoin with nested CDATA sections,
			// but that adds significant complexity.
			return escapeXml(text);
		}
		// Otherwise, wrap in CDATA
		return `${CDATA_START}\n${text}\n${CDATA_END}`;
	}
	// If no special characters, just return the text (it's safe)
	// Note: escapeXml is technically not needed here if the regex is correct,
	// but kept for safety/clarity or if the regex misses edge cases.
	// return escapeXml(text);
	return text; // Return raw text if no special chars found
}

export function escapeXml(unsafe: string): string {
	if (!unsafe) return '';
	return unsafe.replace(/[<>&'"]/g, (c) => {
		switch (c) {
			case '<':
				return '&lt;';
			case '>':
				return '&gt;';
			case '&':
				return '&amp;';
			case "'":
				return '&apos;';
			case '"':
				return '&quot;';
			default:
				return c;
		}
	});
}
