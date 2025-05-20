import { agentContext, getFileSystem } from '#agent/agentContextLocalStorage';
import { func, funcClass } from '#functionSchema/functionDecorators';

/**
 * Functions for the agent to show/hide the FileSystem tree and expand/collapse folders
 */
@funcClass(__filename)
export class FileSystemTree {
	/**
	 * Collapses a folder in the FileSystemTree view to reduce LLM token usage
	 * @param {string} folderPath the folder to collapse in the File System tree view
	 * @returns if the node was collapsed, i.e. the folderPath exists and is a folder
	 */
	@func()
	async collapseFolder(folderPath: string): Promise<boolean> {
		const agent = agentContext();
		if (!(await getFileSystem().directoryExists(folderPath))) return false;
		agent.toolState ??= {};
		agent.toolState.FileSystemTree ??= [];

		agent.toolState.FileSystemTree = Array.from(new Set([...agent.toolState.FileSystemTree, folderPath]));
		return true;
	}

	/**
	 * Expands a folder in the FileSystemTree view when needing to view a relevant part of the file system
	 * @param {string} folderPath the folder to expand in the File System tree view
	 * @returns if the node was expanded, i.e. the folderPath exists and is a folder and was previously collapsed
	 */
	@func()
	async expandFolder(folderPath: string): Promise<boolean> {
		const agent = agentContext();
		if (!(await getFileSystem().directoryExists(folderPath))) return false;
		agent.toolState ??= {};
		agent.toolState.FileSystemTree ??= [];
		if (!Array.isArray(agent.toolState.FileSystemTree)) throw new Error('toolState.fileSystemTree must be an array');

		const origLength = agent.toolState.FileSystemTree.length;
		agent.toolState.FileSystemTree = agent.toolState.FileSystemTree.filter((path) => path !== folderPath);
		return agent.toolState.FileSystemTree.length !== origLength;
	}
}
