import { getFileSystem, llms } from '#agent/agentContextLocalStorage';
import { func, funcClass } from '#functionSchema/functionDecorators';
import { type LlmMessage, assistant, messageText, system, user } from '#llm/llm';
import { ApplySearchReplace, type EditFormat } from '#swe/coder/applySearchReplace';

@funcClass(__filename)
export class SearchReplaceCoder {
	/**
	 * Makes the changes to the project files to meet the task requirements
	 * @param requirements the complete task requirements with all the supporting documentation and code samples
	 * @param filesToEdit the names of any existing relevant files to edit
	 */
	@func()
	async editFilesToMeetRequirements(requirements: string, filesToEdit: string[], readOnlyFiles: string[], commit = true): Promise<void> {
		const readOnlyFileContents: string = await getFileSystem().readFilesAsXml(readOnlyFiles);
		const editableFileContents: string = await getFileSystem().readFilesAsXml(filesToEdit);

		const editFormat: EditFormat = 'diff-fenced';

		const messages: LlmMessage[] = [system(''), user(''), assistant('')];

		const llmResponse: LlmMessage = await llms().hard.generateMessage(messages, { id: 'SearchReplace Coder', temperature: 0.1 });

		const searchReplace = new ApplySearchReplace(getFileSystem().getWorkingDirectory(), filesToEdit, { dirtyCommits: true, autoCommits: false, dryRun: false });

		const editedFiles: Set<string> = await searchReplace.applyLlmResponse(messageText(llmResponse));
	}

	buildEditPrompt(requirements: string, readOnlyFileContents: string, editableFileContents: string, editFormat: EditFormat): LlmMessage[] {
		return [];
	}

	buildArchitectPrompt(requirements: string, readOnlyFileContents: string, editableFileContents: string, editFormat: EditFormat): LlmMessage[] {
		return [];
	}
}
