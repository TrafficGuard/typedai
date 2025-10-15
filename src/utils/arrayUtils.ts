/**
 * Utility functions for JSON manipulation and optimization
 */

export interface CommonPropertiesResult {
	commonProps: any;
	strippedItems: any[];
}

/**
 * Extracts properties that are identical across all items in an array
 * Useful for reducing redundancy in JSON responses
 *
 * @param items - Array of objects to analyze
 * @returns Object containing common properties and items with those properties removed
 */
export function extractCommonProperties(items: any[]): CommonPropertiesResult {
	if (!Array.isArray(items) || items.length === 0) {
		return { commonProps: {}, strippedItems: items };
	}

	// No commonality to extract from a single item
	if (items.length === 1) {
		return { commonProps: {}, strippedItems: items };
	}

	// Build a map of path -> value from first item
	const pathMap = new Map<string, any>();
	collectPaths(items[0], '', pathMap);

	// Filter out paths that aren't common to ALL items
	for (let i = 1; i < items.length; i++) {
		const itemPaths = new Map<string, any>();
		collectPaths(items[i], '', itemPaths);

		// Remove paths that don't match
		for (const [path, value] of pathMap) {
			if (!itemPaths.has(path) || !deepEqual(itemPaths.get(path), value)) {
				pathMap.delete(path);
			}
		}

		// Early exit if no common paths remain
		if (pathMap.size === 0) {
			return { commonProps: {}, strippedItems: items };
		}
	}

	// Build common props object from paths
	const commonProps = buildFromPaths(pathMap);

	// Strip common properties from items
	const strippedItems = items.map((item) => stripPaths(item, pathMap));

	return { commonProps, strippedItems };
}

/**
 * Deep equality comparison for any values
 * Handles primitives, arrays, objects, null, and undefined
 *
 * @param a - First value
 * @param b - Second value
 * @returns True if values are deeply equal
 */
export function deepEqual(a: any, b: any): boolean {
	// Fast path for primitives and same reference
	if (a === b) return true;

	// Fast path for null/undefined
	if (a == null || b == null) return false;

	// Type check
	if (typeof a !== typeof b) return false;

	// Fast path for primitives
	if (typeof a !== 'object') return false;

	// Array comparison
	if (Array.isArray(a)) {
		if (!Array.isArray(b) || a.length !== b.length) return false;
		return a.every((val, i) => deepEqual(val, b[i]));
	}

	// Object comparison
	const keysA = Object.keys(a);
	const keysB = Object.keys(b);
	if (keysA.length !== keysB.length) return false;

	return keysA.every((key) => {
		if (!Object.prototype.hasOwnProperty.call(b, key)) return false;
		return deepEqual(a[key], b[key]);
	});
}

/**
 * Collect all paths in an object using dot notation
 * Arrays are treated as leaf values
 *
 * @param obj - Object to traverse
 * @param prefix - Current path prefix
 * @param pathMap - Map to store paths and values
 */
function collectPaths(obj: any, prefix: string, pathMap: Map<string, any>): void {
	if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) {
		if (prefix) {
			pathMap.set(prefix, obj);
		}
		return;
	}

	for (const key in obj) {
		if (!Object.prototype.hasOwnProperty.call(obj, key)) continue;

		const path = prefix ? `${prefix}.${key}` : key;
		const value = obj[key];

		if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
			collectPaths(value, path, pathMap);
		} else {
			pathMap.set(path, value);
		}
	}
}

/**
 * Build object from path map using dot notation
 *
 * @param pathMap - Map of dot-notation paths to values
 * @returns Reconstructed object
 */
function buildFromPaths(pathMap: Map<string, any>): any {
	const result: any = {};

	for (const [path, value] of pathMap) {
		const parts = path.split('.');
		let current = result;

		for (let i = 0; i < parts.length - 1; i++) {
			if (!current[parts[i]]) {
				current[parts[i]] = {};
			}
			current = current[parts[i]];
		}

		current[parts[parts.length - 1]] = value;
	}

	return result;
}

/**
 * Strip common paths from object
 * Creates a deep clone and removes specified paths
 *
 * @param obj - Object to strip paths from
 * @param pathMap - Map of paths to remove
 * @returns New object with paths removed
 */
function stripPaths(obj: any, pathMap: Map<string, any>): any {
	const result = JSON.parse(JSON.stringify(obj)); // Simple deep clone

	for (const path of pathMap.keys()) {
		const parts = path.split('.');
		let current = result;

		// Navigate to parent
		for (let i = 0; i < parts.length - 1; i++) {
			if (!current[parts[i]]) break;
			current = current[parts[i]];
		}

		// Delete the property
		if (current && parts[parts.length - 1] in current) {
			delete current[parts[parts.length - 1]];

			// Clean up empty parents
			cleanupEmpty(result, parts.slice(0, -1));
		}
	}

	return result;
}

/**
 * Remove empty objects after stripping properties
 * Recursively cleans up parent objects that become empty
 *
 * @param obj - Root object
 * @param pathParts - Path parts to the object to check
 */
function cleanupEmpty(obj: any, pathParts: string[]): void {
	if (pathParts.length === 0) return;

	let current = obj;
	for (let i = 0; i < pathParts.length - 1; i++) {
		if (!current[pathParts[i]]) return;
		current = current[pathParts[i]];
	}

	const lastKey = pathParts[pathParts.length - 1];
	if (current[lastKey] && typeof current[lastKey] === 'object' && !Array.isArray(current[lastKey]) && Object.keys(current[lastKey]).length === 0) {
		delete current[lastKey];
		cleanupEmpty(obj, pathParts.slice(0, -1));
	}
}
