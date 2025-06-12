import { agentContext } from '#agent/agentContextLocalStorage';
import { func, funcClass } from '#functionSchema/functionDecorators';
import { MAD_Balanced, MAD_SOTA } from '#llm/multi-agent/reasoning-debate';
import type { AgentContext } from '#shared/agent/agent.model';
import type { IFileSystemService } from '#shared/files/fileSystemService';

@funcClass(__filename)
export class DeepThink {
	/**
	 * Generates a response to a query using a multi-agent implementation of the most expensive, intelligent LLM models.
	 * Use sparingly, as instructed or when stuck on a task, as this is expensive to use. Be careful to minimize the tokens inputted.
	 * This query runs independent of any context and understanding you currently have. All required information to answer the query must be passed in as arguments.
	 * @param files Any files to include in the query
	 * @param memoryKeys Any memory keys to include in the query
	 * @param additionalInformation Any additional information to include in the query
	 * @param query The query to answer
	 * @returns The response to the query
	 */
	@func()
	async deepThink(files: string[], memoryKeys: string[], additionalInformation: string, query: string): Promise<string> {
		const agent: AgentContext = agentContext();
		const fss: IFileSystemService = agent.fileSystem;

		// Construct the prompt
		const filesContent = await Promise.all(files.map((file) => fss.readFilesAsXml(file)));
		const memory: Record<string, string> = agent.memory;
		const memoryContent = Object.entries(memory)
			.filter(([key, value]) => memoryKeys.includes(key))
			.map(([key, value]) => `${key}: ${value}`)
			.join('\n');

		let prompt = '';
		if (filesContent.length > 0) {
			prompt += `Files:\n${filesContent.join('\n')}\n\n`;
		}
		if (memoryContent.length > 0) {
			prompt += `Memory:\n${memoryContent}\n\n`;
		}
		if (additionalInformation.length > 0) {
			prompt += `Additional Information:\n${additionalInformation}\n\n`;
		}
		prompt += `Query: ${query}`;

		return await MAD_Balanced().generateTextWithResult(prompt);
	}
}
