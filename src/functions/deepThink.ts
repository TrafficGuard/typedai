import { agentContext } from '#agent/agentContextLocalStorage';
import { func, funcClass } from '#functionSchema/functionDecorators';
import { MAD_Balanced, MAD_Cost, MAD_Fast, MAD_SOTA, MAD_Vertex } from '#llm/multi-agent/reasoning-debate';
import type { AgentContext, LLM } from '#shared/agent/agent.model';
import type { IFileSystemService } from '#shared/files/fileSystemService';
import { includeAlternativeAiToolFiles } from '#swe/includeAlternativeAiToolFiles';

@funcClass(__filename)
export class DeepThink {
	/**
	 * Generates a response to a query using a multi-agent implementation of the most expensive, intelligent LLM models.
	 * Use sparingly, as instructed or when stuck on a task, as this is expensive to use. Be careful to minimize the tokens inputted.
	 * This query runs independent of any context and understanding you currently have. All required information to answer the query must be passed in as arguments.
	 * @param files Any filesystem files to include in the query
	 * @param memoryKeys Any memory keys to include in the query
	 * @param additionalInformation Any additional information to include in the query (logs, function outputs, etc)
	 * @param queryOrRequirements The query to answer or requirements to generate a response for
	 * @returns The response to the query
	 */
	@func()
	async deepThink(files: string[], memoryKeys: string[], additionalInformation: string, queryOrRequirements: string): Promise<string> {
		const agent: AgentContext = agentContext();
		const fss: IFileSystemService = agent.fileSystem;

		let prompt = '';
		if (memoryKeys) {
			const memory: Record<string, string> = agent.memory;
			const memoryContent = Object.entries(memory)
				.filter(([key, value]) => memoryKeys.includes(key))
				.map(([key, value]) => `# ${key}\n${value}\n`)
				.join('\n');
			prompt += `Memory:\n${memoryContent}\n\n`;
		}
		if (files.length) {
			const rulesFiles = await includeAlternativeAiToolFiles(files);
			const allFiles = new Set([...files, ...rulesFiles]);
			// Sort the rules files first
			const sortedFiles = Array.from(allFiles).sort((a, b) => {
				if (rulesFiles.has(a)) return -1;
				if (rulesFiles.has(b)) return 1;
				return 0;
			});
			const filesContent = await fss.readFilesAsXml(sortedFiles);
			prompt += `Files:\n${filesContent}\n\n`;
		}
		if (additionalInformation.length) {
			prompt += `Additional Information:\n${additionalInformation}\n\n`;
		}
		prompt += `Request:\n${queryOrRequirements}\n\n`;

		// Use 'low' thinking to limit the number of debate rounds
		const llms: LLM[] = [MAD_Balanced(), MAD_Vertex(), MAD_Fast(), MAD_Cost(), MAD_SOTA()];
		const mad = llms.find((llm) => llm.isConfigured());
		return await mad.generateText(prompt, { id: 'DeepThink', thinking: 'low' });
	}
}
