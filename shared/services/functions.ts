export type ToolType =
	| 'filestore' // blob store, locally or S3, Cloud Storage etc
	| 'notification' // Sends a notification to the agent supervisor
	| 'scm' // Source Control Management, GitHub, GitLab
	| 'chat'; // For a chatbot that replies to a conversation
/**
 * @param object function class instance
 * @returns the tool type, if it exists
 */
export function toolType(object: any): ToolType | null {
	return object.getToolType ? object.getToolType() : null;
}

/**
 * Interface for when there can be multiple implementation of a type of tool.
 * Useful for Agent creation validation when there can only be one of a particular tool type selected
 */
export interface GetToolType {
	getToolType(): ToolType;
}

const GET_TOOL_TYPE_METHOD_NAME: keyof GetToolType = 'getToolType';

/**
 * Type guard function to check if an object instance implements the GetToolType interface.
 *
 * @param obj - The object instance to check.
 * @returns True if the object has a `getToolType` method, false otherwise.
 *          Narrows the type of `obj` to `GetToolType` if it returns true.
 */
export function hasGetToolType(obj: unknown): obj is GetToolType {
	if (typeof obj !== 'object' || obj === null) return false;

	return typeof (obj as any)[GET_TOOL_TYPE_METHOD_NAME] === 'function';
}
