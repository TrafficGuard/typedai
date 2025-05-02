import { SCRIPT_RETURN_VALUE_MAX_TOKENS } from '#agent/agentUtils';
import { countTokens } from '#llm/tokens';
import { logger } from '#o11y/logger';

// --- Helper Type Guard ---

interface JsonBufferRepresentation {
	type: 'Buffer';
	data: number[];
}

function isJsonBufferRepresentation(value: any): value is JsonBufferRepresentation {
	return (
		typeof value === 'object' &&
		value !== null &&
		value.type === 'Buffer' &&
		Array.isArray(value.data) &&
		// Optional: Check if all elements are numbers (can be slow for huge arrays)
		// value.data.every((item: any) => typeof item === 'number')
		true // Keep it simple for performance unless strict validation needed
	);
}

// --- Recursive Truncation Logic (Simplified) ---

/**
 * @param target The object/value to potentially modify (part of the clone)
 * @param visited Handle circular references
 */
function truncateBuffersRecursively(target: any, visited: Set<any> = new Set()): any {
	// Handle null/undefined/primitives - return as is
	if (target === null || typeof target !== 'object') return target;

	// Handle circular references
	if (visited.has(target)) return '[Circular Reference]';

	visited.add(target);
	// console.log('checking is buffer');
	// --- Specific Handling for JSON Buffer Representation ---
	if (isJsonBufferRepresentation(target)) {
		// console.log('trim trim');
		(target as any).data = '[<data>]';
		// Don't recurse further into the buffer object's properties ('type', 'data')
		visited.delete(target); // Remove from visited set after processing this node
		return target;
	}

	// --- General Recursive Handling (Arrays and Objects) ---

	// Recurse into arrays (process elements, but don't truncate the array itself)
	if (Array.isArray(target)) {
		for (let i = 0; i < target.length; i++) {
			// Pass a *copy* of visited for different branches
			target[i] = truncateBuffersRecursively(target[i], new Set(visited));
		}
		visited.delete(target); // Remove after processing elements
		return target;
	}

	// Recurse into plain objects
	// Assumes plain objects after JSON.parse(JSON.stringify())
	for (const key in target) {
		if (Object.prototype.hasOwnProperty.call(target, key)) {
			// Pass a *copy* of visited for different branches
			// console.log(`Checking ${key}`);
			target[key] = truncateBuffersRecursively(target[key], new Set(visited));
		}
	}

	visited.delete(target); // Remove after processing properties
	return target;
}

/**
 * Clones an object and recursively truncates only the 'data' array
 * within objects matching the { type: 'Buffer', data: [...] } structure.
 * Uses JSON.parse(JSON.stringify()) for cloning.
 * @param obj The original object to clone and truncate.
 * @returns A new object with specified buffer data arrays truncated.
 */
export function cloneAndTruncateBuffers(obj: any): any {
	let clone: any;
	try {
		clone = JSON.parse(JSON.stringify(obj));
	} catch (error) {
		clone = structuredClone(clone);
	}
	return truncateBuffersRecursively(clone);
}

async function trim(pythonScriptResult: any) {
	let result: any;
	if (typeof pythonScriptResult === 'object' && pythonScriptResult !== null) {
		// Truncate large values within the object *before* final stringification
		for (const [k, vo] of Object.entries(pythonScriptResult)) {
			const v = vo as any;
			// Skip image objects we already processed and stored
			if (typeof v === 'object' && v !== null && v.type === 'image' && v.source) continue;

			const valueString = JSON.stringify(v); // Stringify individual value for token counting
			const tokens = await countTokens(valueString);
			if (tokens > SCRIPT_RETURN_VALUE_MAX_TOKENS) {
				logger.warn(`Truncated return value for ${k}`);
				// Estimate new length based on tokens (approx 3.5 chars/token)
				const newLength = Math.floor(SCRIPT_RETURN_VALUE_MAX_TOKENS * 3.5);
				// Truncate the original string representation
				pythonScriptResult[k] = `${valueString.substring(0, newLength)}... (truncated due to size)`;
			}
		}
		// Now stringify the potentially modified object
		result = JSON.stringify(pythonScriptResult);
	} else {
		// Handle non-object results (strings, numbers, etc.)
		result = JSON.stringify(pythonScriptResult); // Stringify directly
		// Check truncation for the whole stringified result
		const tokens = await countTokens(result);
		if (tokens > SCRIPT_RETURN_VALUE_MAX_TOKENS) {
			logger.warn('Truncated non-object return value');
			const newLength = Math.floor(SCRIPT_RETURN_VALUE_MAX_TOKENS * 3.5);
			result = `${result.substring(0, newLength)}... (truncated due to size)`;
		}
	}
	return result;
}
