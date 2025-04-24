/** Firestore property size maximum in bytes */
export const MAX_PROPERTY_SIZE = 1048487;

/**
 * Firestore properties have a max length
 * @param str
 * @param maxBytes
 */
export function truncateToByteLength(str: string, maxBytes: number): string {
	if (Buffer.byteLength(str, 'utf8') <= maxBytes) return str;

	let left = 0;
	let right = str.length;

	while (left < right) {
		const mid = Math.floor((left + right + 1) / 2);
		const truncated = str.slice(0, mid);
		const bytes = Buffer.byteLength(truncated, 'utf8');

		if (bytes <= maxBytes) {
			left = mid;
		} else {
			right = mid - 1;
		}
	}

	// Additional safety check to ensure we don't cut in the middle of a multi-byte character
	let result = str.slice(0, left);

	// If we're still over the limit (rare edge case), back up one character at a time
	while (Buffer.byteLength(result, 'utf8') > maxBytes) {
		result = result.slice(0, -1);
	}

	return result;
}
