import { agentContext, llms } from '#agent/agentContextLocalStorage';
import { func, funcClass } from '#functionSchema/functionDecorators';
import { perplexityDeepResearchLLM } from '#llm/services/perplexity-llm';
import { logger } from '#o11y/logger';
import { cacheRetry } from '../../cache/cacheRetry';

const log = logger.child({ class: 'Perplexity' });

export interface PerplexityConfig {
	key: string;
}

@funcClass(__filename)
export class Perplexity {
	/**
	 * Calls Perplexity to perform online research.
	 * @param researchQuery the natural language query to research
	 * @param saveToMemory if the response should be saved to the agent memory.
	 * @returns {string} if saveToMemory is true then returns the memory key. If saveToMemory is false then returns the research contents.
	 */
	@cacheRetry()
	@func()
	async research(researchQuery: string, saveToMemory: boolean): Promise<string> {
		try {
			const report: string = await perplexityDeepResearchLLM().generateText(researchQuery);

			if (saveToMemory) {
				const summary = await llms().easy.generateText(
					`<query>${researchQuery}</query>\nGenerate a summarised version of the research key in one short sentence at most, with only alphanumeric with underscores for spaces. Answer concisely with only the summary.`,
					{ id: 'Summarise Perplexity search' },
				);
				const key = `Perplexity-${summary}`;
				agentContext().memory[key] = report;
				return key;
			}
			return report;
		} catch (e) {
			log.error(e, `Perplexity error. Query: ${researchQuery}`);
			throw e;
		}
	}
}
