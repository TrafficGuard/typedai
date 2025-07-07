import * as path from 'node:path';
import { logger } from '#o11y/logger';

/**
 * Strips quoting and language specifier from content of a SEARCH or REPLACE block.
 * @param text The text content of the block.
 * @param filename Optional filename, used to detect if the first line is a filename header.
 * @param fencePair Optional fence pair (e.g., ['```', '```']). Defaults to ['```', '```'].
 * @returns The cleaned text, with a trailing newline if content is present.
 */
export function stripQuotedWrapping(text: string, filename?: string, fencePair?: [string, string]): string {
	if (!text) return text;
	const currentFence = fencePair || ['```', '```'];

	const lines = text.split('\n');

	if (filename && lines.length > 0) {
		const firstLineTrimmed = lines[0].trim();
		if (firstLineTrimmed.endsWith(path.basename(filename)) || firstLineTrimmed === filename) {
			lines.shift();
		}
	}

	if (lines.length >= 2 && lines[0].startsWith(currentFence[0]) && lines[lines.length - 1].startsWith(currentFence[1])) {
		lines.shift();
		lines.pop();
	}

	let result = lines.join('\n');
	if (result && !result.endsWith('\n')) {
		result += '\n';
	}
	return result;
}

/**
 * Prepares content for diffing by ensuring it ends with a newline and splitting it into lines.
 * Each line in the returned array will end with a newline character.
 * @param content The string content to prepare.
 * @returns An object containing the processed text (ending with a newline) and an array of lines (each ending with a newline).
 */
export function prep(content: string): { text: string; lines: string[] } {
	let processedContent = content;
	if (processedContent && !processedContent.endsWith('\n')) {
		processedContent += '\n';
	}
	const lines = processedContent.split('\n');
	if (lines.length > 0 && lines[lines.length - 1] === '') {
		lines.pop(); // Remove last empty string if content ended with \n
	}
	return { text: processedContent, lines: lines.map((l) => `${l}\n`) };
}

/**
 * Normalizes and outdents lines from SEARCH (part) and REPLACE blocks.
 * It finds the minimum common leading whitespace from all non-blank lines
 * in both blocks and removes it.
 * @param partLinesWithNL Lines from the SEARCH block, each ending with \n.
 * @param replaceLinesWithNL Lines from the REPLACE block, each ending with \n.
 * @returns An object with `normPartLines` and `normReplaceLines`, both arrays of strings ending with \n.
 */
export function normalizeAndOutdent(
	partLinesWithNL: string[],
	replaceLinesWithNL: string[],
): {
	normPartLines: string[];
	normReplaceLines: string[];
} {
	let minIndent = Number.POSITIVE_INFINITY;
	const linesToConsider = [...partLinesWithNL, ...replaceLinesWithNL];

	for (const lineWithNL of linesToConsider) {
		const line = lineWithNL.slice(0, -1); // Remove \n for trim check
		if (line.trim()) {
			const leadingSpaceCount = line.match(/^(\s*)/)?.[0].length ?? 0;
			minIndent = Math.min(minIndent, leadingSpaceCount);
		}
	}

	const removedPrefixLen = minIndent === Number.POSITIVE_INFINITY || minIndent === 0 ? 0 : minIndent;

	const normP = removedPrefixLen > 0 ? partLinesWithNL.map((lwnl) => (lwnl.slice(0, -1).trim() ? lwnl.substring(removedPrefixLen) : lwnl)) : partLinesWithNL;
	const normR =
		removedPrefixLen > 0 ? replaceLinesWithNL.map((lwnl) => (lwnl.slice(0, -1).trim() ? lwnl.substring(removedPrefixLen) : lwnl)) : replaceLinesWithNL;

	return { normPartLines: normP, normReplaceLines: normR };
}

/**
 * Attempts a perfect, exact match and replace of `partLines` within `wholeLines`.
 * @param wholeLines The lines of the original file content, each ending with \n.
 * @param partLines The lines from the SEARCH block to match, each ending with \n.
 * @param replaceLines The lines from the REPLACE block to substitute, each ending with \n.
 * @returns The new file content as a string if a perfect match is found, otherwise undefined.
 */
export function perfectReplace(wholeLines: string[], partLines: string[], replaceLines: string[]): string | undefined {
	if (partLines.length === 0) {
		return undefined; // Cannot replace an empty part with content unless it's an append/prepend scenario (handled elsewhere)
	}

	for (let i = 0; i <= wholeLines.length - partLines.length; i++) {
		let match = true;
		for (let j = 0; j < partLines.length; j++) {
			if (wholeLines[i + j] !== partLines[j]) {
				match = false;
				break;
			}
		}
		if (match) {
			const result = [...wholeLines.slice(0, i), ...replaceLines, ...wholeLines.slice(i + partLines.length)];
			return result.join('');
		}
	}
	return undefined;
}

/**
 * Checks if a chunk of `wholeChunkLines` matches `partLines`, ignoring differences in leading whitespace
 * but ensuring the trimmed content and relative indentation (offset) are consistent.
 * @param wholeChunkLines A segment of the original file's lines, each ending with \n.
 * @param partLines The SEARCH block lines (normalized), each ending with \n.
 * @param lenientLeadingWhitespace If true, allows more flexible matching of leading whitespace.
 * @returns The common leading whitespace prefix from `wholeChunkLines` if a match is found, otherwise undefined.
 *          Returns an empty string if the match involves no leading whitespace (e.g., all lines start non-blank).
 */
export function matchButForLeadingWhitespace(wholeChunkLines: string[], partLines: string[], lenientLeadingWhitespace: boolean): string | undefined {
	if (wholeChunkLines.length !== partLines.length) return undefined;
	const num = wholeChunkLines.length;
	if (num === 0) return '';

	let commonPrefixFromWholeStrict: string | undefined = undefined;
	let firstNonBlankStrict = true;
	let strictCheckFailed = false;

	for (let i = 0; i < num; i++) {
		const wholeLineContentNoNL = wholeChunkLines[i].slice(0, -1);
		const partLineContentNoNL = partLines[i].slice(0, -1);

		if (wholeLineContentNoNL.trimStart() !== partLineContentNoNL.trimStart()) {
			strictCheckFailed = true;
			break;
		}

		if (wholeLineContentNoNL.trim()) {
			const currentWholePrefix = wholeLineContentNoNL.substring(0, wholeLineContentNoNL.indexOf(wholeLineContentNoNL.trimStart()));
			if (firstNonBlankStrict) {
				commonPrefixFromWholeStrict = currentWholePrefix;
				firstNonBlankStrict = false;
			} else if (commonPrefixFromWholeStrict !== currentWholePrefix) {
				strictCheckFailed = true;
				break;
			}
		}
	}

	if (!strictCheckFailed) {
		return commonPrefixFromWholeStrict === undefined ? '' : commonPrefixFromWholeStrict;
	}

	if (lenientLeadingWhitespace) {
		let firstNonBlankLenient = true;
		let expectedOffset: number | undefined = undefined;
		let prefixToReturnForLenientMatch: string | undefined = undefined;

		for (let i = 0; i < num; i++) {
			const wholeLineContentNoNL = wholeChunkLines[i].slice(0, -1);
			const partLineContentNoNL = partLines[i].slice(0, -1);

			const wholeTrimmed = wholeLineContentNoNL.trimStart();
			const partTrimmed = partLineContentNoNL.trimStart();

			if (wholeTrimmed !== partTrimmed) return undefined;
			if (!wholeTrimmed) {
				if (!partTrimmed) continue;
				return undefined;
			}

			const wholePrefixLength = wholeLineContentNoNL.length - wholeTrimmed.length;
			const partPrefixLength = partLineContentNoNL.length - partTrimmed.length;
			const currentOffset = wholePrefixLength - partPrefixLength;

			if (firstNonBlankLenient) {
				expectedOffset = currentOffset;
				prefixToReturnForLenientMatch = wholeLineContentNoNL.substring(0, wholePrefixLength);
				firstNonBlankLenient = false;
			} else if (currentOffset !== expectedOffset) {
				return undefined;
			}
		}

		if (!firstNonBlankLenient) return prefixToReturnForLenientMatch;
		if (num > 0) return '';
	}
	return undefined;
}

/**
 * Attempts to replace a part of `wholeLines` that matches `partLines` (after normalization and
 * considering leading whitespace) with `replaceLines` (also normalized and re-indented).
 * @param wholeLines The lines of the original file content, each ending with \n.
 * @param partLines The lines from the SEARCH block, each ending with \n.
 * @param replaceLines The lines from the REPLACE block, each ending with \n.
 * @param lenientLeadingWhitespace If true, allows more flexible matching of leading whitespace.
 * @returns The new file content as a string if a match and replacement occur, otherwise undefined.
 */
export function replacePartWithMissingLeadingWhitespace(
	wholeLines: string[],
	partLines: string[],
	replaceLines: string[],
	lenientLeadingWhitespace: boolean,
): string | undefined {
	const { normPartLines, normReplaceLines } = normalizeAndOutdent(partLines, replaceLines);

	if (normPartLines.length === 0) return undefined;

	for (let i = 0; i <= wholeLines.length - normPartLines.length; i++) {
		const wholeChunk = wholeLines.slice(i, i + normPartLines.length);
		const leadingWsToAdd = matchButForLeadingWhitespace(wholeChunk, normPartLines, lenientLeadingWhitespace);

		if (leadingWsToAdd !== undefined) {
			const adjustedReplaceLines = normReplaceLines.map((rLineWithNL) => (rLineWithNL.slice(0, -1).trim() ? leadingWsToAdd + rLineWithNL : rLineWithNL));
			const result = [...wholeLines.slice(0, i), ...adjustedReplaceLines, ...wholeLines.slice(i + normPartLines.length)];
			return result.join('');
		}
	}
	return undefined;
}

/**
 * Escapes special regular expression characters in a string.
 * @param str The input string.
 * @returns The string with regex special characters escaped.
 */
export function escapeRegExp(str: string): string {
	return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Attempts to perform replacements using "..." (dotdotdot) elision patterns.
 * This allows matching parts of a file while leaving other parts (marked by "...") untouched.
 * @param wholeContentStr The entire original file content as a string.
 * @param partContentStr The SEARCH block content, potentially with "..." patterns.
 * @param replaceContentStr The REPLACE block content, with corresponding "..." patterns.
 * @returns The new file content as a string if the "..." pattern replacement is successful, otherwise undefined.
 */
export function tryDotDotDots(wholeContentStr: string, partContentStr: string, replaceContentStr: string): string | undefined {
	const dotsRegex = /(^\s*\.\.\.\s*\n)/m;

	const ensureNewline = (s: string) => (s.endsWith('\n') ? s : `${s}\n`);
	partContentStr = ensureNewline(partContentStr);
	replaceContentStr = ensureNewline(replaceContentStr);
	wholeContentStr = ensureNewline(wholeContentStr);

	const rawPartPieces = partContentStr.split(dotsRegex);
	const rawReplacePieces = replaceContentStr.split(dotsRegex);

	const partSplit = rawPartPieces.filter((p) => p !== undefined);
	const replaceSplit = rawReplacePieces.filter((p) => p !== undefined);

	if (partSplit.length === 1 && !dotsRegex.test(partContentStr)) return undefined;

	if (partSplit.length !== replaceSplit.length) {
		logger.warn("Unpaired '...' in SEARCH/REPLACE block (lengths differ).");
		return undefined;
	}

	for (let i = 1; i < partSplit.length; i += 2) {
		if (partSplit[i] !== replaceSplit[i]) {
			logger.warn("Mismatched '...' elision patterns in SEARCH/REPLACE block.");
			return undefined;
		}
	}

	const contentPartPieces = partSplit.filter((_, idx) => idx % 2 === 0);
	const contentReplacePieces = replaceSplit.filter((_, idx) => idx % 2 === 0);

	let currentWholeContent = wholeContentStr;
	for (let i = 0; i < contentPartPieces.length; i++) {
		const pPiece = contentPartPieces[i];
		const rPiece = contentReplacePieces[i];

		if (!pPiece && !rPiece) continue;

		if (!pPiece && rPiece) {
			// If currentWholeContent doesn't end with \n, and rPiece starts with \n, this check is problematic.
			// The ensureNewline above should handle this, but as a safeguard:
			if (!currentWholeContent.endsWith('\n') && !rPiece.startsWith('\n')) {
				currentWholeContent += '\n';
			} else if (currentWholeContent.endsWith('\n') && rPiece.startsWith('\n')) {
				currentWholeContent += rPiece.substring(1); // Avoid double newline if both have it
				continue;
			}
			currentWholeContent += rPiece;
			continue;
		}

		const escapedPPiece = escapeRegExp(pPiece);
		const occurrences = (currentWholeContent.match(new RegExp(escapedPPiece, 'g')) || []).length;

		if (occurrences === 0) {
			logger.warn(`Segment for '...' replacement not found: "${pPiece.substring(0, 50)}..."`);
			return undefined;
		}
		if (occurrences > 1) {
			logger.warn(`Segment for '...' replacement is ambiguous (found ${occurrences} times): "${pPiece.substring(0, 50)}..."`);
			return undefined;
		}
		currentWholeContent = currentWholeContent.replace(new RegExp(escapedPPiece), rPiece);
	}
	return currentWholeContent;
}

/**
 * Tries various strategies to replace a chunk of text (`part`) within a larger text (`whole`)
 * with a `replace` text. Strategies include perfect match, whitespace-lenient match,
 * and "..." elision pattern matching.
 * @param whole The original entire file content.
 * @param part The content of the SEARCH block.
 * @param replace The content of the REPLACE block.
 * @param lenientLeadingWhitespace If true, allows more flexible matching of leading whitespace.
 * @returns The new file content as a string if a replacement strategy succeeds, otherwise undefined.
 */
export function replaceMostSimilarChunk(whole: string, part: string, replace: string, lenientLeadingWhitespace: boolean): string | undefined {
	const { lines: wholeLines, text: wholeText } = prep(whole);
	const { lines: partLines, text: partText } = prep(part);
	const { lines: replaceLines, text: replaceText } = prep(replace);

	let result = perfectReplace(wholeLines, partLines, replaceLines);
	if (result !== undefined) return result;

	result = replacePartWithMissingLeadingWhitespace(wholeLines, partLines, replaceLines, lenientLeadingWhitespace);
	if (result !== undefined) return result;

	if (partLines.length > 0 && partLines[0].trim() === '') {
		const skippedBlankPartLines = partLines.slice(1);
		if (skippedBlankPartLines.length > 0) {
			result = perfectReplace(wholeLines, skippedBlankPartLines, replaceLines);
			if (result !== undefined) return result;
			result = replacePartWithMissingLeadingWhitespace(wholeLines, skippedBlankPartLines, replaceLines, lenientLeadingWhitespace);
			if (result !== undefined) return result;
		}
	}

	result = tryDotDotDots(wholeText, partText, replaceText);
	if (result !== undefined) return result;

	return undefined;
}

/**
 * Performs the core search and replace operation for a single edit block.
 * It handles creating new files (if SEARCH block is empty) or modifying existing ones.
 * @param relativePath The relative path of the file to edit.
 * @param currentContent The current content of the file, or null if it doesn't exist.
 * @param originalBlock The raw text from the SEARCH block.
 * @param updatedBlock The raw text from the REPLACE block.
 * @param fenceToStrip The fence pair (e.g., ['```', '```']) to strip from block content.
 * @param lenientLeadingWhitespace If true, allows more flexible matching of leading whitespace.
 * @returns The new content for the file as a string if the replacement is successful, otherwise undefined.
 */
export function doReplace(
	relativePath: string,
	currentContent: string | null,
	originalBlock: string,
	updatedBlock: string,
	fenceToStrip: [string, string],
	lenientLeadingWhitespace: boolean,
): string | undefined {
	const beforeText = stripQuotedWrapping(originalBlock, relativePath, fenceToStrip);
	const afterText = stripQuotedWrapping(updatedBlock, relativePath, fenceToStrip);

	if (currentContent === null && !beforeText.trim()) {
		// Creating a new file
		return afterText;
	}
	if (currentContent === null && beforeText.trim()) {
		// Trying to edit a non-existent file with a non-empty search block
		logger.warn(`File ${relativePath} not found, and SEARCH block is not empty. Cannot apply edit.`);
		return undefined;
	}

	// currentContent is not null here
	const currentContentEnsured = currentContent as string;

	if (!beforeText.trim()) {
		// Appending to existing file (SEARCH block is empty or whitespace)
		if (currentContentEnsured && !currentContentEnsured.endsWith('\n') && afterText.length > 0) {
			if (afterText === '\n') {
				// If afterText is just a newline, ensure only one is added.
				return `${currentContentEnsured}\n`;
			}
			return `${currentContentEnsured}\n${afterText}`;
		}
		return currentContentEnsured + afterText;
	}

	// Modifying existing file content
	return replaceMostSimilarChunk(currentContentEnsured, beforeText, afterText, lenientLeadingWhitespace);
}
