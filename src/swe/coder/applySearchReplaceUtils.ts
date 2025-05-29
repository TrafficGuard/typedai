// Utility functions for search and replace logic
import { COMMON_LANGUAGES } from './constants';

/**
 * Corresponds to strip_filename from editblock_coder.py
 * Cleans a line to extract a potential filename.
 * @param filenameLine The line suspected to contain a filename.
 * @param fenceOpen The opening fence string (e.g., "```").
 * @returns The cleaned filename, or undefined if no valid filename is found.
 */
export function stripFilename(filenameLine: string, fenceOpen: string): string | undefined {
	const originalTrimmedLine = filenameLine.trim();
	if (originalTrimmedLine === '...') return undefined;

	let filename = originalTrimmedLine;
	let wasNameExtractedFromAfterFence = false;

	const fenceIndex = originalTrimmedLine.indexOf(fenceOpen);
	if (fenceIndex !== -1) {
		const partBeforeFence = originalTrimmedLine.substring(0, fenceIndex).trim();
		const partAfterFence = originalTrimmedLine.substring(fenceIndex + fenceOpen.length).trimStart();

		if (partAfterFence.includes('\n')) {
			return undefined; // Malformed: "```python\nfoo.py"
		}

		if (fenceIndex === 0) {
			// Line starts with fence, e.g., "```python foo.py" or "```foo.py"
			const firstSpaceInPartAfterFence = partAfterFence.indexOf(' ');
			if (firstSpaceInPartAfterFence !== -1) {
				const firstWord = partAfterFence.substring(0, firstSpaceInPartAfterFence);
				const restOfPart = partAfterFence.substring(firstSpaceInPartAfterFence + 1).trimStart();
				if (COMMON_LANGUAGES.includes(firstWord.toLowerCase()) && restOfPart) {
					filename = restOfPart;
					wasNameExtractedFromAfterFence = true;
				} else {
					// First word not a lang or no text after it, so whole part is filename
					filename = partAfterFence;
					wasNameExtractedFromAfterFence = true;
				}
			} else {
				// No space in partAfterFence, e.g., "```foo.py" or "```python"
				if (
					COMMON_LANGUAGES.includes(partAfterFence.toLowerCase()) &&
					!(partAfterFence.includes('.') || partAfterFence.includes('/') || partAfterFence.includes('\\'))
				) {
					return undefined; // Just a language
				}
				filename = partAfterFence;
				wasNameExtractedFromAfterFence = true;
			}
		} else {
			// Fence is not at the start, e.g., "foo.py ```python" or "foo.py ```"
			// Content after fence (partAfterFence) is likely just lang or empty
			if (!partAfterFence || COMMON_LANGUAGES.includes(partAfterFence.toLowerCase())) {
				filename = partBeforeFence;
				// wasNameExtractedFromAfterFence remains false
			} else {
				// This case is ambiguous, e.g. "file1.py ``` file2.py". Prioritize partAfterFence.
				filename = partAfterFence;
				wasNameExtractedFromAfterFence = true;
			}
		}
	}
	// If fenceIndex === -1, filename remains originalTrimmedLine

	// Stripping decorative characters
	filename = filename.replace(/:$/, ''); // Trailing colon

	if (filename.startsWith('#')) {
		if (wasNameExtractedFromAfterFence) {
			// Keep leading # if it was part of filename after fence, e.g. ```python #file.py
		} else {
			// Original line was like "# file.py" (and no fence involved in its extraction), so strip #
			filename = filename.substring(1).trimStart();
		}
	}

	filename = filename.replace(/^`+|`+$/g, ''); // Leading/trailing backticks
	filename = filename.replace(/^\*+|\*+$/g, ''); // Leading/trailing asterisks
	filename = filename.replace(/\\_/g, '_'); // Unescape \_ to _

	// Final checks
	if (!filename || filename.length === 0 || filename.startsWith('<') || filename.startsWith('=')) return undefined;

	// If, after all stripping, the filename is a common language keyword,
	// and it was extracted from after a fence OR the original line started with a fence,
	// and it doesn't look like a path, it's not a filename.
	const looksLikePath = filename.includes('.') || filename.includes('/') || filename.includes('\\');
	if (COMMON_LANGUAGES.includes(filename.toLowerCase()) && !looksLikePath) {
		if (wasNameExtractedFromAfterFence || (fenceIndex !== -1 && originalTrimmedLine.startsWith(fenceOpen))) {
			return undefined;
		}
	}

	// Reject if it contains spaces and doesn't look like a path (unless it was from after fence where spaces are more permissible)
	if (filename.includes(' ') && !looksLikePath && !wasNameExtractedFromAfterFence && fenceIndex === -1) {
		// Example: "other text" should be rejected if it wasn't from after a fence.
		// "file name.txt" would be caught by !looksLikePath if '.' wasn't checked first.
		// This is a basic heuristic. If "other text" was the full line, it's not a filename.
		return undefined;
	}

	const finalTrimmedFilename = filename.trim();
	return finalTrimmedFilename.length > 0 ? finalTrimmedFilename : undefined;
}
