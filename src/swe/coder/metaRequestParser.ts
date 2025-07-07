import { logger } from '#o11y/logger';
import type { RequestedFileEntry, RequestedPackageInstallEntry, RequestedQueryEntry } from '#swe/coder/coderTypes';

// Helper function to parse file requests from LLM response
export function parseAddFilesRequest(responseText: string): RequestedFileEntry[] | null {
	if (!responseText) return null;
	const match = responseText.match(/<add-files-json>([\s\S]*?)<\/add-files-json>/);
	if (!match || !match[1]) {
		return null;
	}

	const jsonString = match[1];
	try {
		const parsed = JSON.parse(jsonString);
		if (parsed && Array.isArray(parsed.files)) {
			const requestedFiles: RequestedFileEntry[] = [];
			for (const item of parsed.files) {
				if (typeof item.filePath === 'string' && typeof item.reason === 'string') {
					requestedFiles.push({ filePath: item.filePath, reason: item.reason });
				} else {
					logger.warn('Invalid item in files array for add-files-json', { item });
					return null; // Strict parsing: if one item is bad, reject all
				}
			}
			return requestedFiles.length > 0 ? requestedFiles : null;
		}
		logger.warn('Invalid structure for add-files-json content', { jsonString });
		return null;
	} catch (error) {
		logger.error({ err: error }, 'Failed to parse JSON from add-files-json block');
		return null;
	}
}

// New helper function to parse query requests
export function parseAskQueryRequest(responseText: string): RequestedQueryEntry[] | null {
	if (!responseText) return null;
	const matches = Array.from(responseText.matchAll(/<ask-query>([\s\S]*?)<\/ask-query>/g));
	if (!matches.length) return null;

	const requestedQueries: RequestedQueryEntry[] = [];
	for (const match of matches) {
		if (match[1]) {
			requestedQueries.push({ query: match[1].trim() });
		}
	}
	return requestedQueries.length > 0 ? requestedQueries : null;
}

// New helper function to parse package install requests
export function parseInstallPackageRequest(responseText: string): RequestedPackageInstallEntry[] | null {
	if (!responseText) return null;
	const match = responseText.match(/<install-packages-json>([\s\S]*?)<\/install-packages-json>/);
	if (!match || !match[1]) {
		return null;
	}

	const jsonString = match[1];
	try {
		const parsed = JSON.parse(jsonString);
		if (parsed && Array.isArray(parsed.packages)) {
			const requestedPackages: RequestedPackageInstallEntry[] = [];
			for (const item of parsed.packages) {
				if (typeof item.packageName === 'string' && typeof item.reason === 'string') {
					requestedPackages.push({ packageName: item.packageName, reason: item.reason });
				} else {
					logger.warn('Invalid item in packages array for install-packages-json', { item });
					return null; // Strict parsing
				}
			}
			return requestedPackages.length > 0 ? requestedPackages : null;
		}
		logger.warn('Invalid structure for install-packages-json content', { jsonString });
		return null;
	} catch (error) {
		logger.error({ err: error }, 'Failed to parse JSON from install-packages-json block');
		return null;
	}
}
