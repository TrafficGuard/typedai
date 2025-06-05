import { logger } from '#o11y/logger';
import { stripFilename } from '#swe/coder/applySearchReplaceUtils';
import { DIVIDER_MARKER, REPLACE_MARKER, SEARCH_MARKER } from './constants';
import { findOriginalUpdateBlocks as parseDiffFencedAndPathFenceBlocks } from './editBlockParser';
import { EditBlock, EditFormat } from "#swe/coder/coderTypes";


export function parseEditResponse(
	llmResponseContent: string,
	format: EditFormat,
	fenceForFilenameScan: [string, string] // May only be relevant for some formats
): EditBlock[] {
	switch (format) {
		case 'diff':
		// case 'path-fence-blocks': // Your current findOriginalUpdateBlocks handles this
			// If 'diff' strictly means no fences around S/R, then this might need adjustment
			// or a dedicated parser. The Python 'diff' example has fences.
			return parseDiffFencedAndPathFenceBlocks(llmResponseContent, fenceForFilenameScan);
		case 'diff-fenced':
			// This would require a parser where the filename is *inside* the outer model-level fence
			// Example:
			// ```python        <-- Model fence
			// path/to/file.py <-- Filename
			// <<<<<<< SEARCH
			// ...
			// ```              <-- Model fence
			// Your current parser `findOriginalUpdateBlocks` is actually closer to handling the
			// Python "editblock_prompts.py" (non-fenced filenames) example.
			// The Python "editblock_fenced_prompts.py" expects filename INSIDE the fence.
			// Your current `findOriginalUpdateBlocks` should be renamed to reflect
			// what it actually parses (e.g. `parsePathThenOptionalFencedSearchReplaceBlocks`)
			// and you'd need a new `parseFullyFencedSearchReplaceBlocks` for the true 'diff-fenced'
			return parseDiffFencedAndPathFenceBlocks(llmResponseContent, fenceForFilenameScan); // Placeholder - needs dedicated parser if truly different
		// case 'editor-diff':
		//    return parseEditorDiffFormat(llmResponseContent);
		default:
			logger.warn(`Unsupported edit format: ${format}`);
			return [];
	}
	// Can we try different parsers to see which one parses them all so it doesn't matter what the edit format is set to?
}

/**
 * Parses the LLM response content to extract edit blocks.
 * Corresponds to find_original_update_blocks from aider's editblock_coder.py.
 * @param llmResponseContent The raw response from the LLM.
 * @param fenceForFilenameScan The fence characters (e.g., ['```', '```']) used to identify filenames.
 */
export function findOriginalUpdateBlocks(llmResponseContent: string, fenceForFilenameScan: [string, string]): EditBlock[] {
	const edits: EditBlock[] = [];
	if (!llmResponseContent) return edits;
	let content = llmResponseContent;

	content = content.replace(/([^\r\n])(<<<<<<< SEARCH|=======|>>>>>>> REPLACE)/g, '$1\n$2');

	if (!content.endsWith('\n')) {
		content += '\n';
	}

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
			const filePathFromPreceding = findFilenameFromPrecedingLines(potentialPrecedingText, fenceForFilenameScan[0]);
			if (filePathFromPreceding) {
				currentFilePath = filePathFromPreceding;
			}

			if (!currentFilePath) {
				logger.warn('Search block found without a valid preceding or sticky filename. Skipping block.', {
					textBeforeSearch: potentialPrecedingText.substring(0, 100),
				});
				i += 2;
				continue;
			}

			if (i + 5 >= parts.length) {
				logger.warn(`Malformed block for ${currentFilePath}: Incomplete structure after SEARCH_MARKER. Found ${parts.length - (i + 1)} parts instead of 4.`);
				break;
			}

			const originalText = parts[i + 2];
			const dividerMarker = parts[i + 3];
			const updatedText = parts[i + 4];
			const replaceMarker = parts[i + 5];

			if (!dividerMarker.startsWith(DIVIDER_MARKER)) {
				logger.warn(
					`Malformed block for ${currentFilePath}: Expected DIVIDER_MARKER, found ${dividerMarker.trim()}. Content: ${originalText.substring(0, 100)}`,
				);
				i += 2;
				continue;
			}
			if (!replaceMarker.startsWith(REPLACE_MARKER)) {
				logger.warn(
					`Malformed block for ${currentFilePath}: Expected REPLACE_MARKER, found ${replaceMarker.trim()}. Content: ${updatedText.substring(0, 100)}`,
				);
				i += 4;
				continue;
			}

			edits.push({ filePath: currentFilePath, originalText, updatedText });
			i += 6;
		} else {
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
	const numLinesToConsider = Math.min(lines.length, 3);
	for (let k = 0; k < numLinesToConsider; k++) {
		const lineIndex = lines.length - 1 - k;
		const line = lines[lineIndex];

		const filename = stripFilename(line, fenceOpen); // stripFilename is from applySearchReplaceUtils
		if (filename) {
			return filename;
		}
		const trimmedLine = line.trim();
		if (!trimmedLine.startsWith(fenceOpen) && trimmedLine !== '') {
			return undefined;
		}
	}
	return undefined;
}
