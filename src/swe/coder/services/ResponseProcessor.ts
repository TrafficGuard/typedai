import type { EditBlock, EditFormat, RequestedFileEntry, RequestedPackageInstallEntry, RequestedQueryEntry } from '../coderTypes';
import { parseEditResponse } from '../editBlockParser';
import { parseAddFilesRequest, parseAskQueryRequest, parseInstallPackageRequest } from '../searchReplaceCoder';

export class ResponseProcessor {
	constructor(
		private fence: [string, string],
		private editFormat: EditFormat,
	) {}

	process(responseText: string): ProcessedResponse {
		return {
			editBlocks: this.parseEditBlocks(responseText),
			metaRequests: this.parseMetaRequests(responseText),
		};
	}

	private parseEditBlocks(text: string): EditBlock[] {
		return parseEditResponse(text, this.editFormat, this.fence);
	}

	private parseMetaRequests(text: string): MetaRequests {
		return {
			files: parseAddFilesRequest(text),
			queries: parseAskQueryRequest(text),
			packages: parseInstallPackageRequest(text),
		};
	}
}

export interface ProcessedResponse {
	editBlocks: EditBlock[];
	metaRequests: MetaRequests;
}

export interface MetaRequests {
	files: RequestedFileEntry[] | null;
	queries: RequestedQueryEntry[] | null;
	packages: RequestedPackageInstallEntry[] | null;
}
