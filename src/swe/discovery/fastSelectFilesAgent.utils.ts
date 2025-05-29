import * as path from 'node:path';
import { getFileSystem } from '#agent/agentContextLocalStorage';
import { logger } from '#o11y/logger';
import type { IFileSystemService } from '#shared/services/fileSystemService';

// Constants for search result size management
export const MAX_SEARCH_TOKENS = 8000; // Maximum tokens for search results
export const APPROX_CHARS_PER_TOKEN = 4; // Approximate characters per token

// Target context size for the “fast” model family
export const FAST_MAX_TOKENS = 16_382;
export const FAST_TARGET_TOKENS = Math.floor(FAST_MAX_TOKENS * 0.5);
export const FAST_TARGET_CHARS = FAST_TARGET_TOKENS * APPROX_CHARS_PER_TOKEN;

export const MAX_SEARCH_CHARS = MAX_SEARCH_TOKENS * APPROX_CHARS_PER_TOKEN; // Maximum characters for search results

export function normalizePath(p: string): string {
	return path.posix.normalize(p.trim().replace(/^\.\/+/, ''));
}

export function splitFileSystemTreeByFolder(fileTree: string, maxChars = FAST_TARGET_CHARS): string[] {
	const chunks: string[] = [];
	let current = '';

	for (const line of fileTree.split('\n')) {
		// if adding the next line would exceed our character budget, start a new chunk
		if (current.length + line.length > maxChars) {
			chunks.push(current);
			current = '';
		}
		current += `${line}\n`;
	}
	if (current.trim().length) chunks.push(current);
	return chunks;
}

export async function readFileContents(filePaths: string[], fs: IFileSystemService = getFileSystem()): Promise<{ contents: string; invalidPaths: string[] }> {
	let contents = '<files>\n';
	const invalidPaths = [];

	for (const filePath of filePaths) {
		if (!filePath) continue;
		// Ensure paths are resolved correctly if they might be relative
		// Assuming filePath is relative to fs.getWorkingDirectory()
		const fullPath = fs.isAbsolutePath(filePath) ? filePath : path.join(fs.getWorkingDirectory(), filePath);
		try {
			const fileContent = await fs.readFile(fullPath);
			contents += `<file_contents path="${filePath}">
${fileContent}
</file_contents>\n`;
		} catch (e) {
			logger.info(`Couldn't read ${filePath}`);
			contents += `Invalid path ${filePath}\n`;
			invalidPaths.push(filePath);
		}
	}
	return { contents: `${contents}</files>`, invalidPaths };
}

export async function searchFileSystem(
	searchRegex: string,
	fs: IFileSystemService = getFileSystem(),
	maxSearchChars = MAX_SEARCH_CHARS,
	approxCharsPerToken = APPROX_CHARS_PER_TOKEN,
): Promise<string> {
	let searchResultsText = '';
	let searchPerformedSuccessfully = false;

	try {
		logger.debug(`Attempting search with regex "${searchRegex}" and context 1`);
		const extractsC1 = await fs.searchExtractsMatchingContents(searchRegex, 1);
		if (extractsC1.length <= maxSearchChars) {
			searchResultsText = `<search_results regex="${searchRegex}" context_lines="1">\n${extractsC1}\n</search_results>\n`;
			searchPerformedSuccessfully = true;
			logger.debug(`Search with context 1 succeeded, length: ${extractsC1.length}`);
		} else {
			logger.debug(`Search with context 1 too long: ${extractsC1.length} chars`);
		}
	} catch (e) {
		logger.warn(e, `Error during searchExtractsMatchingContents (context 1) for regex: ${searchRegex}`);
		searchResultsText = `<search_error regex="${searchRegex}" context_lines="1">\nError: ${e.message}\n</search_error>\n`;
	}

	if (!searchPerformedSuccessfully && !searchResultsText.includes('<search_error')) {
		try {
			logger.debug(`Attempting search with regex "${searchRegex}" and context 0`);
			const extractsC0 = await fs.searchExtractsMatchingContents(searchRegex, 0);
			if (extractsC0.length <= maxSearchChars) {
				searchResultsText = `<search_results regex="${searchRegex}" context_lines="0">\n${extractsC0}\n</search_results>\n`;
				searchPerformedSuccessfully = true;
				logger.debug(`Search with context 0 succeeded, length: ${extractsC0.length}`);
			} else {
				logger.debug(`Search with context 0 too long: ${extractsC0.length} chars`);
			}
		} catch (e) {
			logger.warn(e, `Error during searchExtractsMatchingContents (context 0) for regex: ${searchRegex}`);
			searchResultsText = `<search_error regex="${searchRegex}" context_lines="0">\nError: ${e.message}\n</search_error>\n`;
		}
	}

	if (!searchPerformedSuccessfully && !searchResultsText.includes('<search_error')) {
		try {
			logger.debug(`Attempting search with regex "${searchRegex}" (file counts)`);
			let fileMatches = await fs.searchFilesMatchingContents(searchRegex);
			if (fileMatches.length <= maxSearchChars) {
				searchResultsText = `<search_results regex="${searchRegex}" type="file_counts">\n${fileMatches}\n</search_results>\n`;
				searchPerformedSuccessfully = true;
				logger.debug(`Search with file_counts succeeded, length: ${fileMatches.length}`);
			} else {
				const originalLength = fileMatches.length;
				fileMatches = fileMatches.substring(0, maxSearchChars);
				searchResultsText = `<search_results regex="${searchRegex}" type="file_counts" truncated="true" original_chars="${originalLength}" truncated_chars="${maxSearchChars}">\n${fileMatches}\n</search_results>\nNote: Search results were too large (${originalLength} characters, estimated ${Math.ceil(originalLength / approxCharsPerToken)} tokens) and have been truncated to ${maxSearchChars} characters (estimated ${Math.ceil(maxSearchChars / approxCharsPerToken)} tokens). Please use a more specific search term if needed.\n`;
				searchPerformedSuccessfully = true;
				logger.debug(`Search with file_counts truncated, original_length: ${originalLength}, new_length: ${fileMatches.length}`);
			}
		} catch (e) {
			logger.warn(e, `Error during searchFilesMatchingContents for regex: ${searchRegex}`);
			searchResultsText = `<search_error regex="${searchRegex}" type="file_counts">\nError: ${e.message}\n</search_error>\n`;
		}
	}

	if (!searchPerformedSuccessfully && !searchResultsText.includes('<search_error')) {
		if (!searchResultsText) {
			// If no search was successful and no error was caught
			searchResultsText = `<search_results regex="${searchRegex}">\nNo results found or all attempts exceeded character limits.\n</search_results>\n`;
			logger.debug(`No search results for regex "${searchRegex}" or all attempts exceeded character limits.`);
		}
	}
	return searchResultsText;
}
