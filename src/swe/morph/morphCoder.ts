import { getFileSystem, llms } from '#agent/agentContextLocalStorage';
import { cacheRetry } from '#cache/cacheRetry';
import { func, funcClass } from '#functionSchema/functionDecorators';
import { logger } from '#o11y/logger';
import type { IFileSystemService } from '#shared/files/fileSystemService';
import { GenerateTextWithJsonResponse } from '#shared/llm/llm.model';
import { ExecResult, execCommand } from '#utils/exec';
import { type ProjectInfo, getProjectInfo } from '../projectDetection';
import { CompilationError } from '../sweErrors';
import { MorphAPI } from './morphApi';

@funcClass(__filename)
export class MorphCodeAgent {
	/**
	 * Edits the files to implement the plan and commits changes to version control
	 * It also compiles, formats, and runs static analysis/linting where applicable.
	 *
	 * @param fileEdits Array of file edits to make. Each `codeEdits` string should:
	 *
	 * **Follow Morph's Edit File Format Requirements**
	 * - Contain only the *precise changes* being made
	 * - Use `// ... existing code ...` markers to indicate omitted sections
	 * - Include sufficient context (unchanged lines) around changes for accurate placement
	 * - Follow the structure defined in the [Edit File Tool](#section-edit-file-tool)
	 *
	 * **codeEdits Example:**
	 * ```javascript
	 * // ... existing code ...
	 * function calculateTotal(items) {
	 *   // ... existing code ...
	 *   for item in items:
	 *     total += item.price;
	 *   return total * 1.1;  // Add 10% tax
	 * }
	 * // ... existing code ...
	 * ```
	 *
	 * **Important Rules:**
	 * - Only have one array entry per file with all of the changes to the file in the codeEdits property
	 * - For deletions: Show context before/after and omit lines between markers
	 * - Bias toward fewer unchanged lines while maintaining context clarity
	 *
	 * @param newFiles Array of new files to create
	 * @param deleteFiles Array of file paths to delete
	 * @param dirtyCommit Whether to commit any files with uncommitted changes before editing
	 * @param autoCommit Whether to commit the changes after editing
	 */
	@func()
	async editFiles(
		fileEdits: Array<{ filePath: string; codeEdits: string }>,
		newFiles: Array<{ filePath: string; fileContent: string }> = [],
		deleteFiles: Array<string> = [],
		dirtyCommit = true,
		autoCommit = true,
		altOptions?: { projectInfo?: ProjectInfo; workingDirectory?: string }, // altOptions are for programmatic use and not exposed to the autonomous agents.
	): Promise<void> {
		let projectInfo: ProjectInfo | undefined | null = altOptions?.projectInfo;
		projectInfo ??= await getProjectInfo();
		if (!projectInfo) throw new Error('No project info found');

		const fss: IFileSystemService = getFileSystem();
		const vcs = fss.getVcs();
		if (!vcs && (dirtyCommit || autoCommit)) throw new Error('Not in a version controlled folder, cannot commit changes');
		if (altOptions?.workingDirectory) fss.setWorkingDirectory(altOptions.workingDirectory);
		fss.setWorkingDirectory(projectInfo.baseDir);

		const editFilePaths = fileEdits.map((fileEdit) => fileEdit.filePath);
		const newFilePaths = newFiles.map((newFile) => newFile.filePath);

		// print to console the fileEdits
		console.log('File Edits:');
		for (const fileEdit of fileEdits) console.log(`${fileEdit.filePath}\n${fileEdit.codeEdits}`);

		// If any editFilePaths do not exist then thats an error
		for (const editFilePath of editFilePaths) if (!(await fss.fileExists(editFilePath))) throw new Error(`File ${editFilePath} does not exist to edit`);

		// If any deleteFiles filePaths do not exist then thats an error
		for (const deleteFile of deleteFiles) if (!(await fss.fileExists(deleteFile))) throw new Error(`File ${deleteFile} does not exist to delete`);

		if (dirtyCommit) await this.handleDirtyCommits(editFilePaths);

		// Keep a copy in memory of the files we're going to edit
		const originalFiles: Map<string, string> = await fss.readFiles(editFilePaths);

		// Apply edits with Morph
		const morph = new MorphAPI();
		const editPromises = fileEdits.map((fileEdit) => morph.edit(fileEdit.filePath, fileEdit.codeEdits));
		const updatedCodes = await Promise.all(editPromises);
		await Promise.all(fileEdits.map((fileEdit, i) => fss.writeFile(fileEdit.filePath, updatedCodes[i])));

		// Create new files
		await Promise.all(newFiles.map((newFile) => fss.writeFile(newFile.filePath, newFile.fileContent)));

		// Delete files
		await Promise.all(deleteFiles.map((deleteFile) => fss.deleteFile(deleteFile)));

		try {
			await this.compile(projectInfo);
		} catch (e) {
			if (e instanceof CompilationError) {
				// Write the original files contents back to the file system
				const writePromises = Array.from(originalFiles.entries()).map(([filePath, fileContent]) => fss.writeFile(filePath, fileContent));
				await Promise.all(writePromises);

				// Retry edits with Morph
				const editPromises = fileEdits.map((fileEdit) => morph.edit(fileEdit.filePath, fileEdit.codeEdits));
				const updatedCodes = await Promise.all(editPromises);
				await Promise.all(fileEdits.map((fileEdit, i) => fss.writeFile(fileEdit.filePath, updatedCodes[i])));

				// Retry compile
				await this.compile(projectInfo);
			}
		}
		// Commit changes
		if (autoCommit) await this.commitChanges(newFilePaths, deleteFiles, editFilePaths, fss);

		if (projectInfo.format) {
			await Promise.all(projectInfo.format.map((formatCommand) => execCommand(formatCommand)));
			if (autoCommit) await vcs?.mergeChangesIntoLatestCommit([...editFilePaths, ...newFilePaths]);
		}

		// lint fix the code
		if (projectInfo.staticAnalysis) {
			// Run it twice so the first time it can apply any auto-fixes, then the second time it has only the non-auto fixable issues
			try {
				await this.runStaticAnalysis(projectInfo);
				try {
					// Merge auto-fixed changes into the last commit if possible
					if (autoCommit) await vcs?.mergeChangesIntoLatestCommit([...editFilePaths, ...newFilePaths]);
				} catch (e) {}
			} catch (e) {
				await this.runStaticAnalysis(projectInfo);
			}
		}

		if (projectInfo.test) await Promise.all(projectInfo.test.map((testCommand) => execCommand(testCommand)));
	}

	async commitChanges(newFilePaths: Array<string>, deleteFilePaths: Array<string>, editFilePaths: string[], fss: IFileSystemService) {
		let diffs = '';
		if (newFilePaths.length > 0) {
			const newFilesContents = await fss.readFilesAsXml(newFilePaths);
			diffs += `New Files: ${newFilesContents}\n\n`;
		}
		if (deleteFilePaths.length > 0) {
			const diff = await execCommand(`git diff ${deleteFilePaths.join(' ')}`);
			diffs += `${diff.stdout}\n\n`;
		}
		if (editFilePaths.length > 0) {
			const diff = await execCommand(`git diff ${editFilePaths.join(' ')}`);
			diffs += diff.stdout;
		}

		const commitMsg = await llms().medium.generateText(
			`<diff>${diffs}</diff>\n\nGenerate a commit message for the changes in this diff. Output only the commit message.`,
			{ id: 'Commit Message' },
		);

		await fss.getVcs().addAndCommitFiles([...editFilePaths, ...newFilePaths, ...deleteFilePaths], commitMsg);
	}

	/**
	 * Commit and files with uncommitted changes.
	 * @param filesToEdit The files targeted for edit.
	 */
	private async handleDirtyCommits(filesToEdit: string[]) {
		const vcs = getFileSystem().getVcs()!;
		const pathsToCommit = new Set<string>();

		for (const filePath of filesToEdit) {
			if (await vcs.isDirty(filePath)) {
				pathsToCommit.add(filePath);
			}
		}
		if (!pathsToCommit.size) return;

		const dirtyFilesArray = Array.from(pathsToCommit);
		logger.info(`Found uncommitted changes in files targeted for edit: ${dirtyFilesArray.join(', ')}. Attempting dirty commit.`);

		const result: ExecResult = await execCommand(`git diff ${dirtyFilesArray.join(' ')}`);
		const diff = result.stdout;
		const dirtyCommitMsg = await llms().medium.generateText(
			`<diff>${diff}</diff>\n\nGenerate a commit message for the changes in this diff. Output only the commit message.`,
			{ id: 'dirtyCommitMessage' },
		);
		await vcs.addAndCommitFiles(dirtyFilesArray, dirtyCommitMsg);
		logger.info(`Successfully committed uncommitted changes for: ${dirtyFilesArray.join(', ')}.`);
	}

	async compile(projectInfo: ProjectInfo): Promise<void> {
		if (!projectInfo.compile || projectInfo.compile.length === 0) {
			logger.info('No compile commands defined.');
			return;
		}
		for (const cmd of projectInfo.compile) {
			const { exitCode, stdout, stderr } = await execCommand(cmd);
			const result = `<compile_output>
    <command>${cmd}</command>
    <exit-code>${exitCode}</exit-code>
    <stdout>
    ${stdout}
    </stdout>
    <stderr>
    ${stderr}
    </stderr>
</compile_output>`;
			if (exitCode > 0) {
				logger.info(stdout);
				logger.error(stderr);
				throw new CompilationError(result, cmd, stdout, stderr, exitCode);
			}
		}
	}

	async runStaticAnalysis(projectInfo: ProjectInfo): Promise<void> {
		if (!projectInfo.staticAnalysis || projectInfo.staticAnalysis.length === 0) {
			logger.info('No static analysis commands defined.');
			return;
		}
		for (const cmd of projectInfo.staticAnalysis) {
			const { exitCode, stdout, stderr } = await execCommand(cmd);
			const result = `<static_analysis_output><command>${cmd}</command><stdout>${stdout}</stdout><stderr>${stderr}</stderr></static_analysis_output>`;
			if (exitCode > 0) throw new Error(result);
		}
	}

	@cacheRetry()
	async extractFilenames(compileErrorOutput: string): Promise<string[]> {
		const filenames = await getFileSystem().getFileSystemTree();
		const prompt = `<compile_error_output>${compileErrorOutput}</compile_error_output>
Extract the filenames which have compile errors. Return in JSON format. 
Example:
<json>{\n files: ["path/to/file1", "path/to/file2", "path/to/file3"]\n}\n</json>`;

		const response: GenerateTextWithJsonResponse<{ files: string[] }> = await llms().medium.generateTextWithJson(prompt, {
			id: 'Extract compile error filenames',
		});
		if (!Array.isArray(response.object.files)) {
			logger.info(response.message, 'Extract Filenames response is not an array');
			return [];
		}
		return response.object.files;
	}
}
