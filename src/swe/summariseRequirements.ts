import { llms } from '#agent/agentContextLocalStorage';
import { buildPrompt } from '#swe/prompt';

export async function summariseRequirements(requirements: string): Promise<string> {
	const prompt = buildPrompt({
		information: '',
		requirements: `The following is the provided requirements of the task:\n<requirements>\n${requirements}\n</requirements>\n`,
		action: `Summarise the requirements into the actions that need to be taken from the perspective of a software developer who needs is doing the implementation. 
		This may include items such as:
		- Changes to business logic
		- Changes to configurations
		- Key details such as project Ids, file names, class names, resource names, configuration values etc.
		- Assumptions
		
		Do not provide implementation details, only a summary`,
	});
	return llms().hard.generateText(prompt, { id: 'summariseRequirements' });
}
