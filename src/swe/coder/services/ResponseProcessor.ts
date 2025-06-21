import type { EditBlock, EditFormat, RequestedFileEntry, RequestedPackageInstallEntry, RequestedQueryEntry } from '#swe/coder/coderTypes';
import { parseEditResponse } from '#swe/coder/editBlockParser';
import { parseAddFilesRequest, parseAskQueryRequest, parseInstallPackageRequest } from '#swe/coder/searchReplaceCoder';

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
 * A service class responsible for parsing the raw text response from an LLM
 * into structured data (edit blocks and meta requests). This class provides a
 * unified interface for processing LLM output by delegating to specialized
 * parsing functions.
 */
export class ResponseProcessor {
	constructor(
		private readonly fence: [string, string],
		private readonly editFormat: EditFormat,
	) {}

	/**
	 * Processes the full response text from the LLM.
	 * @param responseText The raw string content from the LLM response.
	 * @returns A ProcessedResponse object containing parsed edit blocks and meta requests.
	 */
	process(responseText: string): ProcessedResponse {
		return {
			editBlocks: this.parseEditBlocks(responseText),
			metaRequests: this.parseMetaRequests(responseText),
		};
	}

	/**
	 * Parses the response text to extract structured edit blocks.
	 * @param text The response text to parse.
	 * @returns An array of EditBlock objects.
	 */
	private parseEditBlocks(text: string): EditBlock[] {
		return parseEditResponse(text, this.editFormat, this.fence);
	}

	/**
	 * Parses the response text to extract various meta requests.
	 * @param text The response text to parse.
	 * @returns A MetaRequests object containing all parsed requests.
	 */
	private parseMetaRequests(text: string): MetaRequests {
		return {
			requestedFiles: parseAddFilesRequest(text),
			requestedQueries: parseAskQueryRequest(text),
			requestedPackageInstalls: parseInstallPackageRequest(text),
		};
	}
}
