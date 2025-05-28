import * as path from 'node:path';
import { logger } from '#o11y/logger';

export function _stripQuotedWrapping(text: string, filename?: string, fencePair?: [string, string]): string {
	// Corresponds to strip_quoted_wrapping from editblock_coder.py
	if (!text) return text;
	// Use a default fence if none provided, similar to ApplySearchReplace's constructor
	const currentFence = fencePair || ['```', '```'];

	const lines = text.split('\n');

	if (filename && lines.length > 0) {
		const firstLineTrimmed = lines[0].trim();
		// Check if first line is the filename (basename or full relative path)
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

export function _prep(content: string): { text: string; lines: string[] } {
	// Corresponds to prep from editblock_coder.py
	// Ensures content ends with a newline and splits into lines (kept with newlines)
	let processedContent = content;
	if (processedContent && !processedContent.endsWith('\n')) {
		processedContent += '\n';
	}
	const lines = processedContent.split('\n');
	if (lines.length > 0 && lines[lines.length - 1] === '') {
		lines.pop(); // Remove last empty string if content ended with \n
	}
	return { text: processedContent, lines: lines.map((l) => `${l}\n`) }; // Add \n back to each line
}

export function _normalizeAndOutdent(
	partLinesWithNL: string[],
	replaceLinesWithNL: string[],
): {
	normPartLines: string[]; // with \n
	normReplaceLines: string[]; // with \n
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

export function _perfectReplace(wholeLines: string[], partLines: string[], replaceLines: string[]): string | undefined {
	if (partLines.length === 0) {
		return undefined;
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

export function _matchButForLeadingWhitespace(wholeChunkLines: string[], partLines: string[], lenientLeadingWhitespace: boolean): string | undefined {
	// All inputs are arrays of strings, each ending with \n
	if (wholeChunkLines.length !== partLines.length) return undefined;
	const num = wholeChunkLines.length;
	if (num === 0) return ''; // Empty chunks match with empty prefix

	// --- Original Strict Check (from Python version) ---
	let commonPrefixFromWholeStrict: string | undefined = undefined;
	let firstNonBlankStrict = true;
	let strictCheckFailed = false;

	for (let i = 0; i < num; i++) {
		const wholeLineContentNoNL = wholeChunkLines[i].slice(0, -1);
		const partLineContentNoNL = partLines[i].slice(0, -1);

		if (wholeLineContentNoNL.trimStart() !== partLineContentNoNL.trimStart()) {
			strictCheckFailed = true;
			break; // Core content mismatch
		}

		if (wholeLineContentNoNL.trim()) {
			const currentWholePrefix = wholeLineContentNoNL.substring(0, wholeLineContentNoNL.indexOf(wholeLineContentNoNL.trimStart()));
			if (firstNonBlankStrict) {
				commonPrefixFromWholeStrict = currentWholePrefix;
				firstNonBlankStrict = false;
			} else if (commonPrefixFromWholeStrict !== currentWholePrefix) {
				strictCheckFailed = true;
				break; // Prefixes from whole_lines are not consistent for this chunk
			}
		}
	}

	if (!strictCheckFailed) {
		return commonPrefixFromWholeStrict === undefined ? '' : commonPrefixFromWholeStrict;
	}

	// --- Lenient Check (if strict failed and lenientLeadingWhitespace flag is true) ---
	if (lenientLeadingWhitespace) {
		let firstNonBlankLenient = true;
		let expectedOffset: number | undefined = undefined;
		let prefixToReturnForLenientMatch: string | undefined = undefined;

		for (let i = 0; i < num; i++) {
			const wholeLineContentNoNL = wholeChunkLines[i].slice(0, -1);
			const partLineContentNoNL = partLines[i].slice(0, -1); // partLines are already normalized by _normalizeAndOutdent

			const wholeTrimmed = wholeLineContentNoNL.trimStart();
			const partTrimmed = partLineContentNoNL.trimStart();

			if (wholeTrimmed !== partTrimmed) {
				return undefined;
			}

			if (!wholeTrimmed) {
				if (!partTrimmed) {
					continue;
				}
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

		if (!firstNonBlankLenient) {
			return prefixToReturnForLenientMatch;
		}
		if (num > 0) {
			return '';
		}
	}
	return undefined;
}

export function _replacePartWithMissingLeadingWhitespace(
	wholeLines: string[],
	partLines: string[],
	replaceLines: string[],
	lenientLeadingWhitespace: boolean,
): string | undefined {
	const { normPartLines, normReplaceLines } = _normalizeAndOutdent(partLines, replaceLines);

	if (normPartLines.length === 0) return undefined;

	for (let i = 0; i <= wholeLines.length - normPartLines.length; i++) {
		const wholeChunk = wholeLines.slice(i, i + normPartLines.length);
		const leadingWsToAdd = _matchButForLeadingWhitespace(wholeChunk, normPartLines, lenientLeadingWhitespace);

		if (leadingWsToAdd !== undefined) {
			const adjustedReplaceLines = normReplaceLines.map((rLineWithNL) => (rLineWithNL.slice(0, -1).trim() ? leadingWsToAdd + rLineWithNL : rLineWithNL));
			const result = [...wholeLines.slice(0, i), ...adjustedReplaceLines, ...wholeLines.slice(i + normPartLines.length)];
			return result.join('');
		}
	}
	return undefined;
}

export function _escapeRegExp(str: string): string {
	return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function _tryDotDotDots(wholeContentStr: string, partContentStr: string, replaceContentStr: string): string | undefined {
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
			if (!currentWholeContent.endsWith('\n') && rPiece.startsWith('\n')) {
				// Avoid double newline
			} else if (!currentWholeContent.endsWith('\n')) {
				currentWholeContent += '\n';
			}
			currentWholeContent += rPiece;
			continue;
		}

		const escapedPPiece = _escapeRegExp(pPiece);
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

export function _replaceMostSimilarChunk(whole: string, part: string, replace: string, lenientLeadingWhitespace: boolean): string | undefined {
	const { lines: wholeLines, text: wholeText } = _prep(whole);
	const { lines: partLines, text: partText } = _prep(part);
	const { lines: replaceLines, text: replaceText } = _prep(replace);

	let result = _perfectReplace(wholeLines, partLines, replaceLines);
	if (result !== undefined) return result;

	result = _replacePartWithMissingLeadingWhitespace(wholeLines, partLines, replaceLines, lenientLeadingWhitespace);
	if (result !== undefined) return result;

	if (partLines.length > 0 && partLines[0].trim() === '') {
		const skippedBlankPartLines = partLines.slice(1);
		if (skippedBlankPartLines.length > 0) {
			result = _perfectReplace(wholeLines, skippedBlankPartLines, replaceLines);
			if (result !== undefined) return result;
			result = _replacePartWithMissingLeadingWhitespace(wholeLines, skippedBlankPartLines, replaceLines, lenientLeadingWhitespace);
			if (result !== undefined) return result;
		}
	}

	result = _tryDotDotDots(wholeText, partText, replaceText);
	if (result !== undefined) return result;

	return undefined;
}

export function _doReplace(
	relativePath: string,
	currentContent: string | null,
	originalBlock: string,
	updatedBlock: string,
	fenceToStrip: [string, string],
	lenientLeadingWhitespace: boolean,
): string | undefined {
	const beforeText = _stripQuotedWrapping(originalBlock, relativePath, fenceToStrip);
	const afterText = _stripQuotedWrapping(updatedBlock, relativePath, fenceToStrip);

	if (currentContent === null && !beforeText.trim()) {
		return afterText;
	}
	if (currentContent === null && beforeText.trim()) {
		logger.warn(`File ${relativePath} not found, and SEARCH block is not empty. Cannot apply edit.`);
		return undefined;
	}

	if (!beforeText.trim()) {
		const base = currentContent as string; // Cast is acceptable here as null case is handled
		if (base && !base.endsWith('\n') && afterText.length > 0) {
			if (afterText === '\n') {
				return `${base}\n`;
			}
			return `${base}\n${afterText}`;
		}
		return base + afterText;
	}
	return _replaceMostSimilarChunk(currentContent as string, beforeText, afterText, lenientLeadingWhitespace); // Cast is acceptable here
}
