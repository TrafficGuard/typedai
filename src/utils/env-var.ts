/**
 * Gets an environment variable for a key.
 * If a default value is provided, it will be returned if the environment variable is nullish or empty.
 * If no default value is provided and the environment variable is nullish or empty, an error will be thrown.
 * @param key The environment variable key.
 * @param defaultValue Optional default value.
 */
export function envVar(key: string, defaultValue?: string): string {
	const value = process.env[key];
	if (value === undefined || value === null || value.trim() === '') {
		if (defaultValue !== undefined) {
			return defaultValue;
		}
		throw new Error(`The environment variable ${key} is required and was not found.`);
	}
	return value;
}
