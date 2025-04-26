import { llms } from '#agent/agentContextLocalStorage';
import { Perplexity } from '#functions/web/perplexity';
import { logger } from '#o11y/logger';

export async function onlineResearch(repositoryOverview: string, installedPackages: string, implementationPlan: string): Promise<string> {
	const searchPrompt = `${repositoryOverview}\n${installedPackages}\n<requirement>\n${implementationPlan}\n</requirement>
Given the requirements, if there are any specific changes which require using open source libraries, and only if it's not clear from existing code or you general knowledge what the API is, then provide search queries to look up the API usage online.

Limit the queries to the minimal amount where you are uncertain of the API. You will have the opportunity to search again if there are compile errors in the code changes.

First discuss what 3rd party API usages would be required in the changes, if any. Then taking into account propose queries for online research, which must contain all the required context (e.g. language, library). For example if the requirements were "Update the Bigtable table results to include the table size" and from the repository information we could determine that it is a node.js project, then a suitable query would be "With the Google Cloud Node.js sdk verion X.Y.Z how can I get the size of a Bigtable table?"
(If there is no 3rd party API usage that is not already done in the provided files then return an empty array for the searchQueries property)

Then respond in following format:
<json>
{
	"searchQueries": ["query 1", "query 2"]
}
</json> 
`;
	try {
		const queries = (await llms().medium.generateJson(searchPrompt, { id: 'online queries from requirements' })) as {
			searchQueries: string[];
		};

		if (!queries.searchQueries?.length) return '';

		logger.info(`Researching ${queries.searchQueries.join(', ')}`);
		const perplexity = new Perplexity();

		let webResearch = '<online-research>';
		for (const query of queries.searchQueries) {
			const result = await perplexity.research(query, false);
			webResearch += `<research>\n${query}\n\n${result}\n</research>`;
		}
		webResearch += '</online-research>\n';
		return webResearch;
	} catch (e) {
		logger.error(e, 'Error performing online queries from code requirements');
		return '';
	}
}
