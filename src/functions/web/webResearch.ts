import { llms } from '#agent/agentContextUtils';
import { func, funcClass } from '#functionSchema/functionDecorators';
import { logger } from '#o11y/logger';
import { cacheRetry } from '../../cache/cacheRetry';
import { type OrganicSearchResult, PUBLIC_WEB } from './web';

// https://github.com/searxng/searxng

@funcClass(__filename)
export class WebResearcher {
	@cacheRetry()
	// @func
	async generateSearchQueryFromTaskRequirements(task: string) {
		const prompt = `<research_topic>\n${task}\n</research_topic>\n<task>Your task is to research the web to for information to assisst with completing the research topic.\nFirst rephrase the topic into a search query which is most suitable for getting the most relevant results when searching Google.\nOutput your response in the following format:\n<response><reasoning>Explaing reasoning of the rephrasing of the search query</reasoning><result>The search query</result></response></task>`;

		const query: string = await llms().medium.generateTextWithResult(prompt);
		logger.debug(`Search query: ${query}`);
		return query;
	}

	/**
	 * Performs a web search and summarises the top results
	 * @param query The search engine query
	 */
	@cacheRetry({ scope: 'global' })
	@func()
	async webSearch(query: string): Promise<string> {
		// const query = await this.generateSearchQueryFromTaskRequirements(issue);
		// const googleResults: string[] = await PUBLIC_WEB.googleSearch(query);

		let serpResults: OrganicSearchResult[] = await PUBLIC_WEB.serpApiSearch(query);
		const sortedResults: OrganicSearchResult[] = await this.sortSearchResults(serpResults, query);

		for (const result of sortedResults) {
			try {
				const pageContent = await PUBLIC_WEB.getWebPage(result.url);
				result.content = `<web_page url="${result.url}">\n${pageContent}\n</web_page>`;
			} catch (e) {
				logger.warn(`Couldn\'t get ${result.url}. ${e.message}`);
			}
		}

		// const kagiResults: Map<string, string> = await WEB_RESEARCH.kagiSearch(query)
		// const kagiQuestionResults: string = await WEB_RESEARCH.askKagi(query)

		const summariseLLM = llms().medium;

		let knowledgeBase = '';

		while (serpResults.length) {
			let content = '';

			// console.log('');
			// console.log('searchResults.length', searchResults.length);
			// console.log('content.length', content.length + searchResults[searchResults.length - 1].length);
			const maxContentSize = summariseLLM.getMaxInputTokens() - (knowledgeBase.length + query.length + 500);
			// console.log('maxContentSize', maxContentSize);

			serpResults = serpResults.filter((serp) => serp.content?.length && serp.content?.length < maxContentSize);
			if (!serpResults.length) break;

			// content =searchResults.pop()

			content += `\n${serpResults.pop()!.content}`;
			let pagesAdded = 1;
			let nextSearchResult: OrganicSearchResult | null = serpResults.length ? serpResults[serpResults.length - 1] : null;
			while (nextSearchResult && content.length + nextSearchResult.content!.length < maxContentSize && pagesAdded <= 2) {
				logger.debug('Adding search result', nextSearchResult.content!.length);
				content += `\n${serpResults.pop()!.content}`;
				pagesAdded++;
				nextSearchResult = serpResults.length ? serpResults[serpResults.length - 1] : null;
			}

			const summarisePrompt = `<new_content>\n${content}\n</new_content>\n<knowledgebase>\n${knowledgeBase}\n</knowledgebase>\n<query>\n${query}\n</query>\n<task>Your task is to develop a knowledgebase on the search query.\nYou have been provided new content to update the knowlegebase with.\nOnly update the knowledgebase with content that is directly relevant to the query.  Ignore irrelevant content.\nYou will responed with an updated knowledgebase synthesised from the existing one and the new content that is directly relevant to the query in the following format:\n<response><reasoning>Provide a brief summary of reasoning behind the knowledge base updates from the new content</reasoning><result>The updated knowledgebase contents, or the current knowledgebase contents if no changes are to be made. Limit to under 3000 characters.</result></response></task>`;

			knowledgeBase = await summariseLLM.generateTextWithResult(summarisePrompt);

			if (serpResults.length) {
				let continuePrompt = `<knowledgebase>\n${knowledgeBase}\n</knowledgebase>\n<search_query>${query}</search_query><remaining_pages>${JSON.stringify(
					serpResults.map((serp) => serp.url),
				)}</remaining_pages>`;
				continuePrompt +=
					'Your task to to determine the status of the search query research. You will need to determine whether to 1) Continue reading the remaining web pages to build the knowledge base to answer the search query, or 2) The knowledgebase is sufficient to answer the query (completed).\n';
				continuePrompt += 'Your response must either be <result>CONTINUE</result>, or <result>COMPLETED</result>';
				const result = await llms().medium.generateTextWithResult(continuePrompt);
				if (result === 'COMPLETED') {
					logger.debug('SEARCH COMPLETED EARLY =============================================');
					break;
				}
			}
		}
		return knowledgeBase;
	}

	@cacheRetry()
	async sortSearchResults(searchResults: OrganicSearchResult[], query: string): Promise<OrganicSearchResult[]> {
		// The web researcher will load and process pages until the knowledgebase is sufficient to answer the query
		// This additional sorting aims to reduce the number of web pages processed
		const sortedResults = await llms().medium.generateJson<OrganicSearchResult[]>(
			`<json>\n${JSON.stringify(
				searchResults,
			)}\n</json>\nSort this array of URL/titles in the order that would be most likely to have the answer for the query "${query}" with the most likely first. Output your answer in JSON only.`,
		);
		return sortedResults || [];
	}
}

function summarisePrompt(content: string, knowledgeBase: string, query: string): string {
	// biome-ignore format: readability
	return `<new_content>\n${content}\n</new_content>\n<knowledgebase>\n${knowledgeBase}\n</knowledgebase>\n<query>\n${query}\n</query>\n<task>Your task is to develop a knowledgebase on the search query.\nYou have been provided new content to update the knowlegebase with.\nOnly update the knowledgebase with content that is directly relevant to the query.  Ignore irrelevant content.\nYou will responed with an updated knowledgebase synthesised from the existing one and the new content that is directly relevant to the query in the following format:\n<response><reasoning>Provide a brief summary of reasoning behind the knowledge base updates from the new content</reasoning><result>The updated knowledgebase contents, or the current knowledgebase contents if no changes are to be made. Limit to under 3000 characters.</result></response></task>`;
}
