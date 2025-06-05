import { logger } from '#o11y/logger';
import { stripFilename } from '#swe/coder/applySearchReplaceUtils';
/*  remove the self-import – we’ll call functions directly in this module */
import type { EditBlock, EditFormat } from '#swe/coder/coderTypes';
import { DIVIDER_MARKER, REPLACE_MARKER, SEARCH_MARKER } from './constants';

export function parseEditResponse(
	llmResponseContent: string,
	format: EditFormat,
	fenceForFilenameScan: [string, string], // May only be relevant for some formats
): EditBlock[] {
	switch (format) {
		case 'diff':
			// The existing parser handles filename preceding the block, regardless of whether
			// the S/R block itself is fenced. This matches the 'diff' examples.
			return parsePathPrecedingSearchReplaceBlocks(llmResponseContent, fenceForFilenameScan[0]);

		case 'diff-fenced':
			// This format expects the filename *inside* the outer model-level fence.
			return parseDiffFenced(llmResponseContent, fenceForFilenameScan);

		default:
			// Fallback for unimplemented formats. The existing parser might still find blocks
			// if they happen to match its expected structure.
			logger.warn(`Unsupported or unimplemented edit format: ${format}. Falling back to 'diff' parser.`);
			return parsePathPrecedingSearchReplaceBlocks(llmResponseContent, fenceForFilenameScan[0]);
	}
	// Can we try different parsers to see which one parses them all so it doesn't matter what the edit format is set to?
}

/**
 * Parses LLM response content to extract edit blocks where the filename is expected
 * on a line *preceding* the SEARCH/REPLACE block, which may or may not be fenced.
 * Corresponds to find_original_update_blocks from aider's editblock_coder.py.
 * @param llmResponseContent The raw response from the LLM.
 * @param fenceForFilenameScan The opening fence string (e.g., "```") used by stripFilename.
 */
function parsePathPrecedingSearchReplaceBlocks(llmResponseContent: string, fenceOpen: string): EditBlock[] {
	const edits: EditBlock[] = [];
	if (!llmResponseContent) return edits;
	let content = llmResponseContent;

	// Ensure markers are on their own lines
	content = content.replace(/([^\r\n])(<<<<<<< SEARCH|=======|>>>>>>> REPLACE)/g, '$1\n$2');

	if (!content.endsWith('\n')) {
		content += '\n';
	}

	// Split content by the markers
	const splitRegex = new RegExp(`^(${SEARCH_MARKER}|${DIVIDER_MARKER}|${REPLACE_MARKER})[ ]*\\n`, 'gm');
	const rawParts = content.split(splitRegex);
	const parts = rawParts.filter((p) => p !== undefined);

	let currentFilePath: string | undefined = undefined;
	let i = 0;

	while (i < parts.length) {
		const potentialPrecedingText = parts[i];

		if (i + 1 >= parts.length) break;

		const marker = parts[i + 1];

		if (marker.startsWith(SEARCH_MARKER)) {
			// Try to find a filename in the text immediately preceding the SEARCH marker
			const filePathFromPreceding = findFilenameFromPrecedingLines(potentialPrecedingText, fenceOpen);
			if (filePathFromPreceding) {
				currentFilePath = filePathFromPreceding;
			}

			if (!currentFilePath) {
				logger.warn('Search block found without a valid preceding or sticky filename. Skipping block.', {
					textBeforeSearch: potentialPrecedingText.substring(0, 100),
				});
				i += 2; // Skip the preceding text and the SEARCH marker
				continue;
			}

			// Expecting 4 more parts: originalText, DIVIDER, updatedText, REPLACE
			if (i + 5 >= parts.length) {
				logger.warn(`Malformed block for ${currentFilePath}: Incomplete structure after SEARCH_MARKER. Found ${parts.length - (i + 1)} parts instead of 4.`);
				break; // Stop parsing if block is incomplete
			}

			const originalText = parts[i + 2];
			const dividerMarker = parts[i + 3];
			const updatedText = parts[i + 4];
			const replaceMarker = parts[i + 5];

			if (!dividerMarker.startsWith(DIVIDER_MARKER)) {
				logger.warn(
					`Malformed block for ${currentFilePath}: Expected DIVIDER_MARKER, found ${dividerMarker.trim()}. Content: ${originalText.substring(0, 100)}`,
				);
				i += 2; // Skip preceding text and SEARCH marker, continue looking for next block
				continue;
			}
			if (!replaceMarker.startsWith(REPLACE_MARKER)) {
				logger.warn(
					`Malformed block for ${currentFilePath}: Expected REPLACE_MARKER, found ${replaceMarker.trim()}. Content: ${updatedText.substring(0, 100)}`,
				);
				i += 4; // Skip originalText, DIVIDER, updatedText, continue looking for next block
				continue;
			}

			edits.push({ filePath: currentFilePath, originalText, updatedText });
			i += 6; // Skip all 6 parts of the block
		} else {
			// Not a SEARCH marker, just skip the text and the next part (which would be the marker if it were one)
			i += 2;
		}
	}
	return edits;
}

/**
 * Finds a filename from the last few lines of the preceding text content.
 * Corresponds to find_filename from aider's editblock_coder.py.
 * Uses the stripFilename utility.
 */
function findFilenameFromPrecedingLines(precedingContent: string, fenceOpen: string): string | undefined {
	const lines = precedingContent.split('\n');
	// Look at the last 3 lines for a filename
	const numLinesToConsider = Math.min(lines.length, 3);
	for (let k = 0; k < numLinesToConsider; k++) {
		const lineIndex = lines.length - 1 - k;
		const line = lines[lineIndex];

		const filename = stripFilename(line, fenceOpen); // stripFilename is from applySearchReplaceUtils
		if (filename) {
			return filename;
		}
		// If the line is not a filename and is not just whitespace or a fence line,
		// it's likely unrelated text, so stop looking further back.
		const trimmedLine = line.trim();
		if (!trimmedLine.startsWith(fenceOpen) && trimmedLine !== '') {
			return undefined;
		}
	}
	return undefined;
}

/* ------------------------------------------------------------------------------------------
 * Parser for “diff-fenced” format  (filename sits INSIDE the model-level fence)
 * ----------------------------------------------------------------------------------------*/
function parseDiffFenced(content: string, fencePair: [string, string]): EditBlock[] {
	const edits: EditBlock[] = [];
	if (!content) return edits;

	const [fenceOpen, fenceClose] = fencePair;

	/*  RegExp matches a whole fenced block, including the opening line
	    (e.g. ```typescript) and the matching closing fence.  */
	const fenceRegex = new RegExp(
		/* opening fence (with optional lang spec) */
		`${escapeRegExp(fenceOpen)}[^\\n]*\\n([\\s\\S]*?)\\n${escapeRegExp(fenceClose)}`,
		'g',
	);

	let match: RegExpExecArray | null;
	// biome-ignore lint:noAssignInExpressions
	while ((match = fenceRegex.exec(content)) !== null) {
		const inner = match[1]; // content between the fences (no opening/closing lines)
		const lines = inner.split('\n');

		/*  Skip leading blank lines to reach the filename line. */
		let idx = 0;
		while (idx < lines.length && lines[idx].trim() === '') idx++;

		if (idx >= lines.length) {
			logger.warn('Empty fenced block found – skipped.');
			continue; // empty fence – nothing to parse
		}

		const filenameLine = lines[idx];
		// Use the same stripFilename logic, but it's applied to a line *inside* the fence
		const filePath = stripFilename(filenameLine, fenceOpen);
		if (!filePath) {
			logger.warn(`Could not extract filename from line "${filenameLine.trim()}" inside fenced block – skipped.`);
			continue; // cannot extract a filename – skip this fence
		}

		/*  Expect the SEARCH marker after the filename. */
		idx++;
		while (idx < lines.length && lines[idx].trim() === '') idx++; // Skip blank lines after filename
		if (idx >= lines.length || !lines[idx].startsWith(SEARCH_MARKER)) {
			logger.warn(`diff-fenced block for ${filePath} missing SEARCH marker after filename – skipped`);
			continue;
		}
		const searchIdx = idx;

		/*  Locate DIVIDER and REPLACE markers */
		let dividerIdx = -1;
		let replaceIdx = -1;
		for (let j = searchIdx + 1; j < lines.length; j++) {
			if (dividerIdx === -1 && lines[j].startsWith(DIVIDER_MARKER)) {
				dividerIdx = j;
				continue;
			}
			if (dividerIdx !== -1 && lines[j].startsWith(REPLACE_MARKER)) {
				replaceIdx = j;
				break;
			}
		}

		if (dividerIdx === -1 || replaceIdx === -1) {
			logger.warn(`Malformed SEARCH/REPLACE sequence in fenced block for ${filePath} – skipped`);
			continue;
		}

		// Extract original and updated text, preserving newlines.
		// Add back the newline that split() removed.
		const originalTextLines = lines.slice(searchIdx + 1, dividerIdx);
		const originalText = originalTextLines.join('\n') + (originalTextLines.length > 0 || searchIdx + 1 < dividerIdx ? '\n' : '');

		const updatedTextLines = lines.slice(dividerIdx + 1, replaceIdx);
		const updatedText = updatedTextLines.join('\n') + (updatedTextLines.length > 0 || dividerIdx + 1 < replaceIdx ? '\n' : '');

		edits.push({ filePath, originalText, updatedText });
	}

	return edits;
}

/**
 * Escapes special regular expression characters in a string.
 * @param str The input string.
 * @returns The string with regex special characters escaped.
 */
function escapeRegExp(str: string): string {
	return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
