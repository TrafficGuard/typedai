/**
 * Utility helpers shared by the CodeGen agent for analysing / transforming
 * Python-generated function calls coming back through Pyodide.
 */

/**
 * Convert a camelCase or PascalCase string to snake_case.
 */
export function camelToSnake(camel: string): string {
	return camel
		.replace(/([A-Z]+)/g, '_$1')
		.replace(/^_/, '')
		.toLowerCase();
}

/**
 * Returns true if the supplied object looks like a keyword-argument map for the
 * provided parameter names.  A key is considered a match if it is exactly the
 * camelCase parameter name or its snake_case equivalent.
 */
export function isKeywordArgumentCall(argObj: unknown, expectedParamNames: string[]): boolean {
	if (typeof argObj !== 'object' || argObj === null || Array.isArray(argObj)) return false;

	const keys = Object.keys(argObj as Record<string, unknown>);
	if (keys.length === 0) return false;

	// Allow both camelCase and snake_case
	const allowedKeys = new Set<string>();
	for (const name of expectedParamNames) {
		allowedKeys.add(name);
		allowedKeys.add(camelToSnake(name));
	}

	return keys.every((k) => allowedKeys.has(k));
}
