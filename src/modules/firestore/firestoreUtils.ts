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

/**
 * Recursively checks if an object contains nested arrays, which are not allowed by Firestore.
 * @param obj The object to check.
 * @param path The current path being checked (used for error messages).
 * @throws Error if a nested array is found.
 */
export function validateFirestoreObject(obj: any, path: string = ''): void {
	if (obj === null || typeof obj !== 'object') {
		return; // Primitive types are fine
	}

	if (Array.isArray(obj)) {
		for (let i = 0; i < obj.length; i++) {
			const element = obj[i];
			const currentPath = `${path}[${i}]`;
			if (Array.isArray(element)) {
				throw new Error(`Firestore does not support nested arrays. Found at path: ${currentPath}`);
			}
			validateFirestoreObject(element, currentPath); // Recursively check elements within the array
		}
	} else {
		// It's an object
		for (const key in obj) {
			if (Object.prototype.hasOwnProperty.call(obj, key)) {
				const value = obj[key];
				const currentPath = path ? `${path}.${key}` : key;
				if (Array.isArray(value)) {
					// Check elements within this array for nested arrays
					validateFirestoreObject(value, currentPath);
				} else if (typeof value === 'object' && value !== null) {
					// Recursively check nested objects
					validateFirestoreObject(value, currentPath);
				}
			}
		}
	}
}
