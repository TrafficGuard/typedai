import type { EditBlock, EditFormat, RequestedFileEntry, RequestedPackageInstallEntry, RequestedQueryEntry } from '#swe/coder/coderTypes';
import { parseEditResponse } from '#swe/coder/editBlockParser';
import { parseAddFilesRequest, parseAskQueryRequest, parseInstallPackageRequest } from '../metaRequestParser';

/**
 * Defines the structure for "meta" requests an LLM can make, such as asking for files,
 * asking a question, or requesting a package installation.
 * This is designed to be compatible with the MetaRequests type used in ReflectionGenerator.
 */
export interface MetaRequests {
	requestedFiles: RequestedFileEntry[] | null;
	requestedQueries: RequestedQueryEntry[] | null;
	requestedPackageInstalls: RequestedPackageInstallEntry[] | null;
}

/**
 * Represents the fully parsed response from an LLM, separating code edits from meta requests.
 */
export interface ProcessedResponse {
	editBlocks: EditBlock[];
	metaRequests: MetaRequests;
}

/**
 * Parses the response text to extract various meta requests.
 * @param text The response text to parse.
 * @returns A MetaRequests object containing all parsed requests.
 */
function parseMetaRequests(text: string): MetaRequests {
	return {
		requestedFiles: parseAddFilesRequest(text),
		requestedQueries: parseAskQueryRequest(text),
		requestedPackageInstalls: parseInstallPackageRequest(text),
	};
}

/**
 * Processes the full response text from the LLM.
 * @param responseText The raw string content from the LLM response.
 * @param editFormat The expected format of the edit blocks.
 * @param fence The fence strings used for code blocks.
 * @returns A ProcessedResponse object containing parsed edit blocks and meta requests.
 */
export function processResponse(responseText: string, editFormat: EditFormat, fence: [string, string]): ProcessedResponse {
	return {
		editBlocks: parseEditResponse(responseText, editFormat, fence),
		metaRequests: parseMetaRequests(responseText),
	};
}
