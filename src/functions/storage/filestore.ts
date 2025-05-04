import type { GetToolType } from '#functions/toolType';

export interface FileMetadata {
	filename: string;
	description: string;
	/** Size in bytes */
	size: number;
	lastUpdated: string;
}

export const FILE_STORE_NAME = 'FileStore';

export interface FileStore extends GetToolType {
	/**
	 * Saves the contents to a file with the given filename and updates metadata.
	 * @param {string} filename - The name of the file to save.
	 * @param {string | Buffer} contents - The contents to save to the file.
	 * @param {string} description - A description of the file.
	 * @returns {Promise<string>} - The path of the file
	 */
	saveFile(filename: string, contents: string | Buffer, description: string): Promise<string>;

	/**
	 * Retrieves the contents of a file.
	 * @param {string} filename - The name of the file to read.
	 * @returns {Promise<string>}
	 */
	getFile(filename: string): Promise<string>;

	/**
	 * Lists all files in the current directory with their metadata.
	 * @returns {Promise<FileMetadata[]>}
	 */
	listFiles(): Promise<FileMetadata[]>;
}
