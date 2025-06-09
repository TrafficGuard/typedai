import { logger } from '#o11y/logger';

export function errorToJsonString(error: Error): string {
	const plainObject = {
		...error, // properties on classes extending Error
		name: error.name,
		message: error.message,
		stack: error.stack,
	};
	return JSON.stringify(plainObject);
}

/**
 * Converts an Error object to a string
 * @param {Error} error
 * @param includeStack
 */
export function errorToString(error: Error, includeStack = true): string {
	try {
		// Create an array to hold the string representation parts
		const lines: string[] = [];

		// Add standard properties
		lines.push(`${error.name}: ${error.message}`);

		// Get all property names (including non-enumerable ones)
		Object.getOwnPropertyNames(error).forEach((key) => {
			if (key !== 'name' && key !== 'message' && key !== 'stack') lines.push(`${key}: ${(error as any)[key]}`);
		});

		// Add the stack at the end
		if (includeStack && error.stack) lines.push(error.stack);

		// Join the parts with newline characters and return
		return lines.join('\n');
	} catch (e) {
		logger.error(error, 'errorToString error');
		return error?.message ? error.message : 'unknown error';
	}
}
