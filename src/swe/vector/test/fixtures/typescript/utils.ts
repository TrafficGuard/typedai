/**
 * Common utility functions
 * Provides helper functions for string manipulation, date formatting, and data transformation
 */

/**
 * Capitalizes the first letter of a string
 */
export function capitalize(str: string): string {
	if (!str) return '';
	return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
}

/**
 * Converts a string to title case
 * Example: "hello world" => "Hello World"
 */
export function toTitleCase(str: string): string {
	return str
		.toLowerCase()
		.split(' ')
		.map((word) => capitalize(word))
		.join(' ');
}

/**
 * Truncates a string to a maximum length and adds ellipsis
 */
export function truncate(str: string, maxLength: number, ellipsis = '...'): string {
	if (!str || str.length <= maxLength) return str;
	return str.substring(0, maxLength - ellipsis.length) + ellipsis;
}

/**
 * Formats a date for display
 * Returns format: "Jan 15, 2024"
 */
export function formatDate(date: Date | string): string {
	const d = typeof date === 'string' ? new Date(date) : date;

	const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

	const month = months[d.getMonth()];
	const day = d.getDate();
	const year = d.getFullYear();

	return `${month} ${day}, ${year}`;
}

/**
 * Formats a date with time
 * Returns format: "Jan 15, 2024 at 2:30 PM"
 */
export function formatDateTime(date: Date | string): string {
	const d = typeof date === 'string' ? new Date(date) : date;

	const dateStr = formatDate(d);
	let hours = d.getHours();
	const minutes = d.getMinutes();
	const ampm = hours >= 12 ? 'PM' : 'AM';

	hours = hours % 12;
	hours = hours ? hours : 12; // 0 should be 12

	const minutesStr = minutes < 10 ? `0${minutes}` : `${minutes}`;

	return `${dateStr} at ${hours}:${minutesStr} ${ampm}`;
}

/**
 * Calculates the time difference between two dates
 * Returns a human-readable string like "2 hours ago" or "in 3 days"
 */
export function timeAgo(date: Date | string): string {
	const d = typeof date === 'string' ? new Date(date) : date;
	const now = new Date();
	const diffMs = now.getTime() - d.getTime();
	const isFuture = diffMs < 0;
	const absDiff = Math.abs(diffMs);

	const seconds = Math.floor(absDiff / 1000);
	const minutes = Math.floor(seconds / 60);
	const hours = Math.floor(minutes / 60);
	const days = Math.floor(hours / 24);
	const weeks = Math.floor(days / 7);
	const months = Math.floor(days / 30);
	const years = Math.floor(days / 365);

	let result: string;

	if (years > 0) {
		result = `${years} year${years > 1 ? 's' : ''}`;
	} else if (months > 0) {
		result = `${months} month${months > 1 ? 's' : ''}`;
	} else if (weeks > 0) {
		result = `${weeks} week${weeks > 1 ? 's' : ''}`;
	} else if (days > 0) {
		result = `${days} day${days > 1 ? 's' : ''}`;
	} else if (hours > 0) {
		result = `${hours} hour${hours > 1 ? 's' : ''}`;
	} else if (minutes > 0) {
		result = `${minutes} minute${minutes > 1 ? 's' : ''}`;
	} else {
		result = `${seconds} second${seconds !== 1 ? 's' : ''}`;
	}

	return isFuture ? `in ${result}` : `${result} ago`;
}

/**
 * Debounces a function call
 * Delays execution until after specified wait time has passed since last call
 */
export function debounce<T extends (...args: any[]) => any>(func: T, wait: number): (...args: Parameters<T>) => void {
	let timeout: NodeJS.Timeout | null = null;

	return function (this: any, ...args: Parameters<T>) {
		if (timeout) {
			clearTimeout(timeout);
		}

		timeout = setTimeout(() => {
			func.apply(this, args);
		}, wait);
	};
}

/**
 * Deep clones an object
 * Creates a new object with no references to the original
 */
export function deepClone<T>(obj: T): T {
	if (obj === null || typeof obj !== 'object') {
		return obj;
	}

	if (obj instanceof Date) {
		return new Date(obj.getTime()) as any;
	}

	if (Array.isArray(obj)) {
		return obj.map((item) => deepClone(item)) as any;
	}

	if (obj instanceof Object) {
		const cloned = {} as T;
		for (const key in obj) {
			if (Object.hasOwn(obj, key)) {
				cloned[key] = deepClone(obj[key]);
			}
		}
		return cloned;
	}

	return obj;
}

/**
 * Groups an array of objects by a key
 */
export function groupBy<T>(array: T[], key: keyof T): Record<string, T[]> {
	return array.reduce(
		(result, item) => {
			const groupKey = String(item[key]);
			if (!result[groupKey]) {
				result[groupKey] = [];
			}
			result[groupKey].push(item);
			return result;
		},
		{} as Record<string, T[]>,
	);
}

/**
 * Removes duplicate values from an array
 */
export function unique<T>(array: T[]): T[] {
	return Array.from(new Set(array));
}

/**
 * Chunks an array into smaller arrays of specified size
 */
export function chunk<T>(array: T[], size: number): T[][] {
	const chunks: T[][] = [];
	for (let i = 0; i < array.length; i += size) {
		chunks.push(array.slice(i, i + size));
	}
	return chunks;
}

/**
 * Flattens a nested array to a single level
 */
export function flatten<T>(array: any[]): T[] {
	return array.reduce((flat, item) => {
		return flat.concat(Array.isArray(item) ? flatten(item) : item);
	}, []);
}

/**
 * Generates a random string of specified length
 */
export function randomString(length: number): string {
	const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
	let result = '';
	for (let i = 0; i < length; i++) {
		result += characters.charAt(Math.floor(Math.random() * characters.length));
	}
	return result;
}

/**
 * Sleep for a specified number of milliseconds
 */
export async function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Retries a function multiple times with exponential backoff
 */
export async function retry<T>(
	fn: () => Promise<T>,
	options: {
		maxAttempts?: number;
		initialDelay?: number;
		maxDelay?: number;
		factor?: number;
	} = {},
): Promise<T> {
	const { maxAttempts = 3, initialDelay = 1000, maxDelay = 30000, factor = 2 } = options;

	let lastError: Error | undefined;
	let delay = initialDelay;

	for (let attempt = 1; attempt <= maxAttempts; attempt++) {
		try {
			return await fn();
		} catch (error) {
			lastError = error as Error;

			if (attempt < maxAttempts) {
				await sleep(Math.min(delay, maxDelay));
				delay *= factor;
			}
		}
	}

	throw lastError;
}
