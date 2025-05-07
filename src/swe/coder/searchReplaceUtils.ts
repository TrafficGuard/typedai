// Utility functions for search and replace logic
import * as path from 'node:path';

/**
 * Corresponds to strip_filename from aider's editblock_coder.py
 * Cleans a line to extract a potential filename.
 * @param filenameLine The line suspected to contain a filename.
 * @param fenceOpen The opening fence string (e.g., "```").
 * @returns The cleaned filename, or undefined if no valid filename is found.
 */
export function _stripFilename(filenameLine: string, fenceOpen: string): string | undefined {
	let filename = filenameLine.trim();

	if (filename === '...') return undefined;

	// If the line itself is a fence marker, it's not a filename.
	// Heuristic for "```python myfile.py" etc.
	if (filename.startsWith(fenceOpen)) {
		const contentAfterFence = filename.substring(fenceOpen.length).trimStart();

		if (!contentAfterFence) {
			// Just "```" or "```   "
			return undefined;
		}

		const firstSpaceIndex = contentAfterFence.indexOf(' ');

		if (firstSpaceIndex !== -1) {
			// Handles "lang filename" or " filename" (if lang is empty after trimStart)
			const potentialFilename = contentAfterFence.substring(firstSpaceIndex + 1).trimStart();
			if (potentialFilename) {
				filename = potentialFilename;
			} else {
				// e.g., "``` lang " - no filename after lang
				return undefined;
			}
		} else {
			// No space in contentAfterFence. Could be "lang" or "filename".
			// If it's "myfile.py", it is a filename.
			// If it's "python", it's a language.
			// Test if contentAfterFence looks like a filename (e.g., contains '.', '/', '\')
			// or if it's a simple string that's likely a language.
			if (contentAfterFence.includes('.') || contentAfterFence.includes('/') || contentAfterFence.includes('\\')) {
				filename = contentAfterFence;
			} else {
				// Assume it's a language string like "python", "javascript".
				// A more robust check might involve a list of common languages.
				// For now, if it's a simple alphanumeric string, assume it's a language.
				const commonLangRegex = /^[a-zA-Z0-9+#-]*$/;
				if (commonLangRegex.test(contentAfterFence) && contentAfterFence.length < 15) {
					// Max lang length heuristic
					return undefined;
				}
				// Fallback: treat as filename if it doesn't fit common lang pattern
				filename = contentAfterFence;
			}
		}
	}

	filename = filename.replace(/:$/, '').replace(/^#/, '').trim();
	filename = filename.replace(/^`+|`+$/g, '').replace(/^\*+|\*+$/g, '');
	filename = filename.replace(/\\_/g, '_'); // Correctly unescape \_ to _

	if (!filename || filename.startsWith('<') || filename.startsWith('=')) return undefined;

	return filename || undefined;
}
