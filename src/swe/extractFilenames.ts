import { getFileSystem, llms } from '#agent/agentContextLocalStorage';
import { logger } from '#o11y/logger';
import { buildPrompt } from './prompt';

export async function extractFilenames(summary: string): Promise<string[]> {
	const filenames = await getFileSystem().getFileSystemTree();
	const prompt = buildPrompt({
		information: `<project_files>\n${filenames}\n</project_files>`,
		requirements: summary,
		action:
			'From the requirements consider which the files may be required to complete the task. Output your answer as JSON in the format of this example:\n' +
			'<example>\n<json>\n{\n files: ["file1", "file2", "file3"]\n}\n</json>\n</example>',
	});
	const llm = llms().medium;
	const response = await llm.generateTextWithJson(prompt, { id: 'Extract Filenames' });
	if (!Array.isArray((response.object as any).files)) {
		logger.error({ prompt, response: response.message, llm: llm.getId() }, 'Extract Filenames response is not an array');
		return [];
	}
	return (response.object as any).files;
}
