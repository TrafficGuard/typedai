import { getFileSystem } from '#agent/agentContextLocalStorage';
import { func, funcClass } from '#functionSchema/functionDecorators';
import { LlmTools } from '#functions/util';

/**
 * Provides functions for LLMs to write to the file system
 */
@funcClass(__filename)
export class FileSystemWrite {
	/**
	 * Writes to a file. If the file exists it will overwrite the contents. This will create any parent directories required,
	 * @param filePath The file path (either full filesystem path or relative to current working directory)
	 * @param contents The contents to write to the file
	 * @param allowOverwrite if the filePath already exists, then it will overwrite or throw an error based on the allowOverwrite property
	 */
	@func()
	async writeFile(filePath: string, contents: string, allowOverwrite: boolean): Promise<void> {
		if ((await getFileSystem().fileExists(filePath)) && !allowOverwrite) throw new Error(`The file ${filePath} already exists`);
		await getFileSystem().writeFile(filePath, contents);
	}

	/**
	 * Reads a file, then transforms the contents using a LLM to perform the described changes, then writes back to the file.
	 * @param {string} filePath The file to update
	 * @param {string} descriptionOfChanges A natual language description of the changes to make to the file contents
	 */
	@func()
	async editFileContents(filePath: string, descriptionOfChanges: string): Promise<void> {
		const contents = await getFileSystem().readFile(filePath);
		const updatedContent = await new LlmTools().processText(contents, descriptionOfChanges);
		await this.writeFile(filePath, updatedContent, true);
	}

	/**
	 * Edits a file using a search and replace. Provide the minimal lines of text from the file contents as the unique search string
	 * @param filePath The file to edit
	 * @param search The lines of text in the file to replace. Note that all the whitespace must be identical.
	 * @param replace The new text to use as a replacement
	 */
	@func()
	async patchEditFile(filePath: string, search: string, replace: string): Promise<void> {
		// If there is a leading linebreak, or whitespace then a line break, then remove the first line
		search = search.replace(/^[ \t]*\r?\n/, '');
		const contents = await getFileSystem().readFile(filePath);
		if (contents.indexOf(search) < 0) throw new Error(`The file ${filePath} does not contain the search string`);
		if (contents.indexOf(search) !== contents.lastIndexOf(search))
			throw new Error(`The file ${filePath} contained more than one occurrence of the search string. Expand the search string to make it unique`);

		const updatedContents = contents.replace(search, replace);
		await getFileSystem().writeFile(filePath, updatedContents);
	}
}
