import { logger } from '#o11y/logger';
import { stripFilename } from '#swe/coder/applySearchReplaceUtils';
import type { EditBlock, EditFormat } from '#swe/coder/coderTypes';
// Remove direct import of specific markers as they are replaced by regex logic for parsing
// import { DIVIDER_MARKER, REPLACE_MARKER, SEARCH_MARKER } from './constants';

// Define regex patterns for markers that allow for variable lengths (5 to 9)
const SEARCH_MARKER_PATTERN = '<{5,9} SEARCH';
const DIVIDER_MARKER_PATTERN = '={5,9}';
const REPLACE_MARKER_PATTERN = '>{5,9} REPLACE';

const SEARCH_MARKER_REGEX = new RegExp(`^${SEARCH_MARKER_PATTERN}`);
const DIVIDER_MARKER_REGEX = new RegExp(`^${DIVIDER_MARKER_PATTERN}`);
const REPLACE_MARKER_REGEX = new RegExp(`^${REPLACE_MARKER_PATTERN}`);
const ANY_SR_MARKER_REGEX = new RegExp(`^(?:${SEARCH_MARKER_PATTERN}|${DIVIDER_MARKER_PATTERN}|${REPLACE_MARKER_PATTERN})`);

// Regex that matches any SEARCH / DIVIDER / REPLACE marker **anywhere** in a string
const SR_MARKER_PRESENCE_REGEX = new RegExp(`${SEARCH_MARKER_PATTERN}|${DIVIDER_MARKER_PATTERN}|${REPLACE_MARKER_PATTERN}`);

// Regex to match any of the S/R markers for splitting and line normalization
const ANY_MARKER_LINE_PATTERN = `(?:${SEARCH_MARKER_PATTERN}|${DIVIDER_MARKER_PATTERN}|${REPLACE_MARKER_PATTERN})`;

export function parseEditResponse(
	llmResponseContent: string,
	format: EditFormat,
	fenceForFilenameScan: [string, string], // This is the [fenceOpen, fenceClose] pair
): EditBlock[] {
	const fenceOpen = fenceForFilenameScan[0];
	const fencePair = fenceForFilenameScan;

	const parserFunctions = {
		pathPreceding: () => parsePathPrecedingSearchReplaceBlocks(llmResponseContent, fenceOpen),
		diffFenced: () => parseDiffFenced(llmResponseContent, fencePair),
	};

	const orderedAttempts: Array<{ name: string; func: () => EditBlock[] }> = [];

	switch (format) {
		case 'diff':
			orderedAttempts.push({ name: `parsePathPrecedingSearchReplaceBlocks (primary for format '${format}')`, func: parserFunctions.pathPreceding });
			orderedAttempts.push({ name: 'parseDiffFenced (fallback)', func: parserFunctions.diffFenced });
			break;
		case 'diff-fenced':
			orderedAttempts.push({ name: `parseDiffFenced (primary for format '${format}')`, func: parserFunctions.diffFenced });
			orderedAttempts.push({ name: 'parsePathPrecedingSearchReplaceBlocks (fallback)', func: parserFunctions.pathPreceding });
			break;
		default: // 'whole', 'architect', or any other future format
			logger.warn(`Unsupported or unimplemented edit format: ${format}. Defaulting to 'diff' style parsing first.`);
			orderedAttempts.push({ name: `parsePathPrecedingSearchReplaceBlocks (default primary for format '${format}')`, func: parserFunctions.pathPreceding });
			orderedAttempts.push({ name: 'parseDiffFenced (default fallback)', func: parserFunctions.diffFenced });
			break;
	}

	let edits: EditBlock[] = [];
	for (let i = 0; i < orderedAttempts.length; i++) {
		const attempt = orderedAttempts[i];
		logger.debug(`Attempting to parse with: ${attempt.name}`);
		edits = attempt.func();

		if (edits.length > 0) {
			logger.info(`Successfully parsed ${edits.length} blocks using ${attempt.name}.`);
			return edits; // Found blocks, return immediately
		}

		// If this was the primary attempt (i === 0) and it failed,
		// check for S/R markers before trying fallbacks.
		if (i === 0) {
			const hasAnySRMarkers = SR_MARKER_PRESENCE_REGEX.test(llmResponseContent);

			if (!hasAnySRMarkers) {
				logger.debug(`No S/R markers detected in response after ${attempt.name} found no blocks. Skipping fallback parsers.`);
				return []; // No blocks from primary, and no markers to suggest trying fallbacks.
			}
			logger.info(`${attempt.name} found no blocks, but S/R markers were detected. Proceeding to next parser if available.`);
		}
	}

	// If loop completes, all attempts failed or were skipped.
	// Log a final warning if markers were present but no blocks were parsed.
	if (edits.length === 0) {
		const hasAnySRMarkers = SR_MARKER_PRESENCE_REGEX.test(llmResponseContent);
		if (hasAnySRMarkers) {
			logger.warn('All parsing attempts failed to find blocks, though S/R markers were detected in the response.');
		} else {
			logger.debug('All parsing attempts failed, and no S/R markers were detected.');
		}
	}

	/* Final safety-net: if we still have no edits yet S/R markers are
	   present, run the ‘diff’/path-preceding parser one last time.     */
	if (edits.length === 0 && SR_MARKER_PRESENCE_REGEX.test(llmResponseContent)) {
		const fallbackEdits = parsePathPrecedingSearchReplaceBlocks(llmResponseContent, fenceOpen);
		if (fallbackEdits.length > 0) return fallbackEdits;
	}

	return edits; // Will be empty if every attempt (including the safety-net) failed
}

/**
 * Parses LLM response content to extract edit blocks where the filename is expected
 * on a line *preceding* the SEARCH/REPLACE block, which may or may not be fenced.
 * @param llmResponseContent The raw response from the LLM.
 * @param fenceOpen The opening fence string (e.g., "```") used by stripFilename.
 */
function parsePathPrecedingSearchReplaceBlocks(llmResponseContent: string, fenceOpen: string): EditBlock[] {
	const edits: EditBlock[] = [];
	if (!llmResponseContent) return edits;

	/* Insert a '\n' if an S/R marker is stuck to previous text,
	   but NOT when the preceding character is part of the marker itself
	   ('<', '=', '>'), so we don’t split lines such as "=======" or
	   ">>>>>>> REPLACE". */
	const contentWithSeparatedMarkers = llmResponseContent.replace(new RegExp(`([^\\n<=>])(${ANY_MARKER_LINE_PATTERN})`, 'g'), '$1\n$2');

	const lines = contentWithSeparatedMarkers.split(/\r?\n/);
	let currentFilePath: string | undefined = undefined;
	let i = 0;

	while (i < lines.length) {
		const line = lines[i];

		// Attempt to extract filename from the current line
		const filePathFromLine = stripFilename(line, fenceOpen);
		if (filePathFromLine) {
			currentFilePath = filePathFromLine;
		}

		// Check if the current line is a SEARCH marker
		if (SEARCH_MARKER_REGEX.test(line)) {
			let blockFilePath = currentFilePath;

			// If currentFilePath is undefined, look back up to 3 lines
			if (!blockFilePath) {
				const numLinesToConsider = Math.min(i, 3);
				for (let k = 1; k <= numLinesToConsider; k++) {
					const precedingLine = lines[i - k];
					const filePathFromPreceding = stripFilename(precedingLine, fenceOpen);
					if (filePathFromPreceding) {
						blockFilePath = filePathFromPreceding;
						// Do not update currentFilePath here, only use for this block
						break;
					}
					// If the preceding line is not a filename and is not just whitespace or a fence line,
					// it's likely unrelated text, so stop looking further back for this block.
					const trimmedLine = precedingLine.trim();
					if (!trimmedLine.startsWith(fenceOpen) && trimmedLine !== '') {
						break;
					}
				}
			}

			if (!blockFilePath) {
				logger.warn('Search block found without a valid preceding or sticky filename. Skipping block.', {
					searchMarkerLine: line.trim(),
					lineIndex: i,
				});
				i++; // Move past this SEARCH marker
				continue;
			}

			// Search for DIVIDER and REPLACE markers after the current line (i)
			let dividerIdx = -1;
			let replaceIdx = -1;

			for (let j = i + 1; j < lines.length; j++) {
				if (dividerIdx === -1 && DIVIDER_MARKER_REGEX.test(lines[j])) {
					dividerIdx = j;
					continue;
				}
				if (dividerIdx !== -1 && REPLACE_MARKER_REGEX.test(lines[j])) {
					replaceIdx = j;
					break; // Found both, stop searching
				}
				// If we hit another SEARCH marker before finding DIVIDER/REPLACE, this block is malformed
				if (SEARCH_MARKER_REGEX.test(lines[j])) {
					logger.warn(`Malformed block for ${blockFilePath}: Found another SEARCH marker before DIVIDER/REPLACE. Skipping block.`, {
						searchMarkerLine: line.trim(),
						lineIndex: i,
						nextSearchLine: lines[j].trim(),
						nextSearchIndex: j,
					});
					// Set i to j-1 so the outer loop picks up the next SEARCH marker
					i = j - 1;
					dividerIdx = -2; // Indicate malformed state
					break;
				}
			}

			if (dividerIdx === -1 || replaceIdx === -1) {
				if (dividerIdx !== -2) {
					// Only log if not already logged as malformed by hitting another SEARCH
					logger.warn(`Malformed block for ${blockFilePath}: Incomplete structure after SEARCH_MARKER. Missing DIVIDER or REPLACE. Skipping block.`, {
						searchMarkerLine: line.trim(),
						lineIndex: i,
						foundDivider: dividerIdx !== -1,
						foundReplace: replaceIdx !== -1,
					});
				}
				i++; // Move past the current SEARCH marker (or the point where we stopped)
				continue;
			}

			// Extract original and updated text
			// Slice is exclusive of the end index, so slice(start, end) gets lines from start to end-1
			const originalTextLines = lines.slice(i + 1, dividerIdx);
			const originalText = originalTextLines.join('\n') + (originalTextLines.length > 0 || i + 1 < dividerIdx ? '\n' : '');

			const updatedTextLines = lines.slice(dividerIdx + 1, replaceIdx);
			const updatedText = updatedTextLines.join('\n') + (updatedTextLines.length > 0 || dividerIdx + 1 < replaceIdx ? '\n' : '');

			edits.push({ filePath: blockFilePath, originalText, updatedText });

			// Advance index past the processed block
			i = replaceIdx + 1;
		} else {
			// Not a SEARCH marker, just move to the next line
			i++;
		}
	}

	return edits;
}

/**
 * Finds a filename from the last few lines of the preceding text content.
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
		if (idx >= lines.length || !SEARCH_MARKER_REGEX.test(lines[idx])) {
			logger.warn(`diff-fenced block for ${filePath} missing SEARCH marker after filename – skipped`);
			continue;
		}
		const searchIdx = idx;

		/*  Locate DIVIDER and REPLACE markers */
		let dividerIdx = -1;
		let replaceIdx = -1;
		for (let j = searchIdx + 1; j < lines.length; j++) {
			if (dividerIdx === -1 && DIVIDER_MARKER_REGEX.test(lines[j])) {
				dividerIdx = j;
				continue;
			}
			if (dividerIdx !== -1 && REPLACE_MARKER_REGEX.test(lines[j])) {
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
