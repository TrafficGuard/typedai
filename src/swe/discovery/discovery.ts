import { getFileSystem, llms } from '#agent/agentContextUtils';
import { logger } from '#o11y/logger';
import type { SelectedFile } from '#shared/files/files.model';
import { selectFilesToEdit } from '#swe/discovery/selectFilesToEdit';
import { getProjectInfo } from '#swe/projectDetection';

interface DiscoveryResult {
	readyForExecution: boolean;
	gatheredInformation: string;
	nextSteps?: string[];
}

async function discoveryAgent(task: string): Promise<DiscoveryResult> {
	const informationNeeds = await initialAssessment(task);
	let gatheredInfo = '';

	while (informationNeeds.length > 0) {
		const currentNeed = informationNeeds.shift();
		if (!currentNeed) break;

		const source = await determineSource(currentNeed);

		if (source === 'codebase') {
			const files = await selectFilesToEdit(currentNeed, await getProjectInfo());
			gatheredInfo += await analyzeFiles([...files.primaryFiles, ...files.secondaryFiles]);
		} else {
			gatheredInfo += await performOnlineSearch(currentNeed);
		}

		const newNeeds = await reassessNeeds(gatheredInfo, task);
		informationNeeds.push(...newNeeds);
	}

	const synthesizedInfo = await synthesizeInformation(gatheredInfo);
	const decision = await makeDecision(synthesizedInfo, task);

	return {
		readyForExecution: decision.readyForExecution,
		gatheredInformation: synthesizedInfo,
		nextSteps: decision.nextSteps,
	};
}

async function initialAssessment(task: string): Promise<string[]> {
	const prompt = `
    Analyze the following task and identify the key pieces of information needed to complete it:

    <task>${task}</task>

    Respond with a list of information needs. Each need should be specific and actionable.
    Format your response as a JSON array of strings.
  `;

	try {
		const informationNeeds = await llms().medium.generateJson<string[]>(prompt, {
			id: 'initialAssessment',
			temperature: 0.7,
		});
		return informationNeeds.filter((need) => need.trim().length > 0);
	} catch (error) {
		logger.error('Error in initialAssessment:', error);
		return ['Understand the basic requirements of the task'];
	}
}

async function determineSource(need: string): Promise<'codebase' | 'online'> {
	const prompt = `
    Analyze the following information need and determine whether it can be best addressed by searching the codebase or by searching online resources:

    <need>${need}</need>

    Respond with a JSON object in the following format:
    { "source": "codebase" | "online", "reasoning": "Brief explanation of your choice" }
  `;

	try {
		const result = await llms().easy.generateJson<{ source: 'codebase' | 'online'; reasoning: string }>(prompt, {
			id: 'determineSource',
			temperature: 0.3,
		});
		logger.info(`Source for "${need}": ${result.source}. Reason: ${result.reasoning}`);
		return result.source;
	} catch (error) {
		logger.error('Error in determineSource:', error);
		return 'online'; // Default to online if there's an error
	}
}

async function analyzeFiles(files: SelectedFile[]): Promise<string> {
	let analysisResult = '';

	for (const file of files) {
		try {
			const fileContents = await getFileSystem().readFile(file.filePath);
			const prompt = `
        Analyze the contents of the following file and summarize the key information that is relevant to the current task:

        <file_path>${file.filePath}</file_path>
        <file_contents>${fileContents}</file_contents>

        Provide a concise summary of the relevant information in the file.
      `;

			const summary = await llms().medium.generateText(prompt, {
				id: 'analyzeFiles',
				temperature: 0.5,
			});
			analysisResult += `\nFile: ${file.filePath}\nSummary: ${summary}\n`;
		} catch (error) {
			logger.error(`Error analyzing file ${file.filePath}:`, error);
			analysisResult += `\nFile: ${file.filePath}\nError: Unable to analyze file\n`;
		}
	}

	return analysisResult;
}

async function performOnlineSearch(need: string): Promise<string> {
	try {
		const searchQuery = `"${need}"`;
		const searchResults = await searchOnline(searchQuery);

		const prompt = `
      Analyze the following search results and provide a concise summary of the information that is relevant to the current task:

      <search_results>${searchResults}</search_results>

      Provide a summary of the key information from the search results.
    `;

		const summary = await llms().medium.generateText(prompt, {
			id: 'performOnlineSearch',
			temperature: 0.6,
		});
		return summary;
	} catch (error) {
		logger.error('Error in performOnlineSearch:', error);
		return `Unable to perform online search for: ${need}`;
	}
}

async function searchOnline(query: string): Promise<string> {
	// Implementation depends on the search API or library you're using
	// This is a placeholder implementation
	return `Placeholder search results for: ${query}`;
}

async function reassessNeeds(gatheredInfo: string, task: string): Promise<string[]> {
	const prompt = `
    Given the information gathered so far and the original task, identify any new information needs that have emerged and should be addressed.

    <gathered_information>${gatheredInfo}</gathered_information>
    <task>${task}</task>

    Respond with a list of new information needs. Each need should be specific and actionable.
    Format your response as a JSON array of strings.
  `;

	try {
		const newNeeds = await llms().medium.generateJson<string[]>(prompt, {
			id: 'reassessNeeds',
			temperature: 0.7,
		});
		return newNeeds.filter((need) => need.trim().length > 0);
	} catch (error) {
		logger.error('Error in reassessNeeds:', error);
		return [];
	}
}

async function synthesizeInformation(gatheredInfo: string): Promise<string> {
	const prompt = `
    Synthesize the following information into a concise summary that can be used to determine if enough information has been gathered to proceed with the task:

    <gathered_information>${gatheredInfo}</gathered_information>

    Provide a summary of the key insights and findings from the gathered information.
    Include any potential gaps or areas that might need further investigation.
  `;

	try {
		const summary = await llms().medium.generateText(prompt, {
			id: 'synthesizeInformation',
			temperature: 0.5,
		});
		return summary;
	} catch (error) {
		logger.error('Error in synthesizeInformation:', error);
		return 'Unable to synthesize gathered information';
	}
}

async function makeDecision(synthesizedInfo: string, task: string): Promise<{ readyForExecution: boolean; nextSteps?: string[] }> {
	const prompt = `
    Based on the following synthesized information, determine whether enough information has been gathered to proceed with the task, or if additional information is needed.

    <synthesized_information>${synthesizedInfo}</synthesized_information>
    <task>${task}</task>

    Respond with a JSON object in the following format:
    {
      "readyForExecution": boolean,
      "reasoning": "Explanation for the decision",
      "nextSteps": ["need to understand X API", "need to find Y in the codebase", "need to research Z technology"]
    }
  `;

	try {
		const decision = await llms().medium.generateJson<{
			readyForExecution: boolean;
			reasoning: string;
			nextSteps: string[];
		}>(prompt, {
			id: 'makeDecision',
			temperature: 0.3,
		});

		logger.info(`Decision: ${decision.readyForExecution ? 'Ready' : 'Not ready'}. Reasoning: ${decision.reasoning}`);

		return {
			readyForExecution: decision.readyForExecution,
			nextSteps: decision.readyForExecution ? undefined : decision.nextSteps,
		};
	} catch (error) {
		logger.error('Error in makeDecision:', error);
		return { readyForExecution: false, nextSteps: ['Reassess the task and gathered information'] };
	}
}
