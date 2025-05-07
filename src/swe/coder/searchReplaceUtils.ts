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
	let originalTrimmedLine = filenameLine.trim();
	let filename = originalTrimmedLine;

	if (filename === '...') return undefined;

	// Handle cases like "path/to/file.ts ```typescript"
	// If a fence is present, we prioritize what's *after* the fence if it looks like a filename,
	// or what's *before* if the part after the fence is just a language.
	const fenceIndex = filename.indexOf(fenceOpen);
	if (fenceIndex !== -1) {
		const partBeforeFence = filename.substring(0, fenceIndex).trim();
		const partAfterFenceAndLang = filename.substring(fenceIndex + fenceOpen.length).trimStart(); // "python myfile.py" or "myfile.py" or "python"

		if (partAfterFenceAndLang.includes('\n')) {
			// Malformed fence with newline immediately after lang, e.g. "```python\nfoo.py"
			return undefined;
		}

		const firstSpaceAfterLang = partAfterFenceAndLang.indexOf(' ');
		let potentialFilenameAfterFence: string | undefined;
		let potentialLang: string | undefined;

		if (firstSpaceAfterLang !== -1) {
			potentialLang = partAfterFenceAndLang.substring(0, firstSpaceAfterLang);
			potentialFilenameAfterFence = partAfterFenceAndLang.substring(firstSpaceAfterLang + 1).trimStart();
		} else {
			// No space, so partAfterFenceAndLang is either a lang or a filename
			// If it contains typical filename chars or is longer, assume filename. Otherwise, lang.
			if (partAfterFenceAndLang.includes('.') || partAfterFenceAndLang.includes('/') || partAfterFenceAndLang.includes('\\') || partAfterFenceAndLang.length > 15) {
				potentialFilenameAfterFence = partAfterFenceAndLang;
			} else {
				potentialLang = partAfterFenceAndLang;
			}
		}

		if (potentialFilenameAfterFence && potentialFilenameAfterFence.length > 0) {
			filename = potentialFilenameAfterFence;
		} else if (partBeforeFence && !potentialFilenameAfterFence && fenceIndex === 0) {
			// This means the line starts with a fence, and what follows is only a language.
			// e.g. "```python". In this case, there's no filename.
			return undefined;
		} else if (partBeforeFence && fenceIndex > 0) {
			// Filename might be before the fence, e.g. "myfile.ts ```"
			// Only use partBeforeFence if potentialFilenameAfterFence is empty or clearly just a language.
			if (!potentialFilenameAfterFence || (potentialLang && !potentialFilenameAfterFence)) {
				filename = partBeforeFence;
			}
			// else filename is already potentialFilenameAfterFence
		} else if (!potentialFilenameAfterFence && !partBeforeFence) {
			// Only fence or fence + lang
			return undefined;
		}
		// If potentialFilenameAfterFence is set, filename is already updated.
	}

	// Stripping decorative characters (must happen after fence logic)
	// The order of these replaces matters.
	filename = filename.replace(/:$/, ''); // Trailing colon
	// Allow '#' if it's not at the very beginning of the *original trimmed line*
	// OR if it's part of a filename extracted from after a fence, e.g. ```python #file.py
	// The current `filename` might be `#file.py` from ````python #file.py`.
	// If `originalTrimmedLine` was ````python #file.py`, then `filename` is `#file.py`.
	// If `originalTrimmedLine` was `# file.py`, then `filename` is `file.py`.
	if (filename.startsWith('#') && !originalTrimmedLine.startsWith(fenceOpen)) {
		// This condition is tricky. If original line was "# file.py", filename becomes "file.py".
		// If original line was "```python #file.py", filename becomes "#file.py".
		// We want to strip leading '#' only if it was a comment for a non-fenced filename.
	} else if (originalTrimmedLine.startsWith('#') && !originalTrimmedLine.startsWith(fenceOpen)) {
		filename = filename.replace(/^#/, '').trimStart();
	}

	filename = filename.replace(/^`+|`+$/g, ''); // Leading/trailing backticks
	filename = filename.replace(/^\*+|\*+$/g, ''); // Leading/trailing asterisks
	filename = filename.replace(/\\_/g, '_'); // Unescape \_ to _

	// Final checks
	if (!filename || filename.startsWith('<') || filename.startsWith('=')) return undefined;

	// If, after all stripping, the filename is a common language keyword and the original line started with a fence, it's not a filename.
	if (originalTrimmedLine.startsWith(fenceOpen)) {
		const commonLangs = ['python', 'javascript', 'typescript', 'java', 'c', 'cpp', 'csharp', 'go', 'ruby', 'php', 'swift', 'kotlin', 'rust', 'scala', 'perl', 'lua', 'r', 'shell', 'bash', 'sql', 'html', 'css', 'xml', 'json', 'yaml', 'markdown', 'text', 'py', 'js', 'ts', 'md'];
		if (commonLangs.includes(filename.toLowerCase()) && filename.indexOf('/') === -1 && filename.indexOf('\\') === -1 && filename.indexOf('.') === -1) {
			return undefined;
		}
	}
	// If the line was *just* a language specifier after a fence, it should have been caught.
	// e.g. "```python" -> filename="python". This check makes it undefined.

	return filename.trim() || undefined;
}
