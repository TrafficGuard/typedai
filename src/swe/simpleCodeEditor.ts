import { getFileSystem, llms } from '#agent/agentContextLocalStorage';
import { func, funcClass } from '#functionSchema/functionDecorators';
import { CDATA_END, CDATA_START } from '#utils/xml-utils';
import { buildPrompt } from './codeEditingAgent';

@funcClass(__filename)
export class SimpleCodeEditor {
	/**
	 * Creates/edits files to implement the requirements
	 * @param requirements The requirements
	 * @param files {string} The list of files to input to the editor. JSON array of filenames
	 */
	@func()
	async makeChanges(requirements: string, files: string | string[]): Promise<void> {
		//if(files.trim().startsWith())
		// await new CodeEditor().editFilesToMeetRequirements(requirements, files);
		const fileContents = await getFileSystem().readFilesAsXml(files);
		const prompt = buildPrompt({
			information: fileContents,
			requirements,
			action: `Make changes where required to the files to fulfill the requirements.
			Add comments to your changes to explain your reasoning.
			Follow the same formatting styles in the original files.
			Re-use existing functionality in the files.
			Only output the files which have been changed.
			Output your results in the format:
			<reasoning>
			</reasoning>
			<file_contents path="dir/updated_file1.ext">${CDATA_START}
		    The updated contents
			${CDATA_END}</file_contents>
			<file_contents path="dir/updated_file2.ext">${CDATA_START}
		    The updated contents
			${CDATA_END}</file_contents>
			`,
		});
		const response = await llms().hard.generateText(prompt, { id: 'makeChanges' });
		// const response = readFileSync('response.txt', 'utf8');
		const changes = parseMakeChangesResponse(response);
		//   console.log(changes);

		await applyChanges(changes);
	}
}
function parseMakeChangesResponse(response: string): Array<{ path: string; content: string }> {
	const regex = /<file_contents path="(.*?)">(.*?)<\/file_contents>/gs;
	const results: Array<{ path: string; content: string }> = [];
	let match: RegExpExecArray | null;
	// biome-ignore lint:suspicious/noAssignInExpressions
	while ((match = regex.exec(response)) !== null) {
		if (match) {
			results.push({
				path: match[1],
				content: match[2].trim(),
			});
		}
	}
	return results;
}

async function applyChanges(changes: Array<{ path: string; content: string }>) {
	for (const change of changes) {
		await getFileSystem().writeFile(change.path, change.content);
	}
}
