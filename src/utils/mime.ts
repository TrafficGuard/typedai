import mime from 'mime-types';

/**
 * Gets the MIME type for a given filename or path.
 * Defaults to 'application/octet-stream' if lookup fails.
 * @param filename The filename or path.
 * @returns The determined MIME type.
 */
export function getMimeType(filename: string): string {
	// Basic check for data URI
	if (filename?.startsWith('data:')) {
		const match = filename.match(/^data:([a-zA-Z0-9]+\/[a-zA-Z0-9-.+]+);/);
		if (match?.[1]) {
			return match[1];
		}
	}
	// Use mime-types library for file extensions
	return mime.lookup(filename) || 'application/octet-stream';
}
