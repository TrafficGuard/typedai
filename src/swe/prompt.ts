export const basePrompt = `You are an advanced software engineering AI agent with an understanding of software best practices and design patterns used by FAANG companies and other hyperscale tech companies.  
You are required to complete the software development lifecycle for the following task. When writing code make sure you add lots of comments explaining your thought process.
Before working on a task think carefully and detail what assumptions you can make from the requirements.

Here is the information you need for the current step of the task:
`;

export function buildPrompt(args: {
	information: string;
	requirements: string;
	action: string;
}): string {
	return `${basePrompt}\n\n${args.information}\n\nThe requirements of the task are as follows:\n<requirements>\n${args.requirements}\n</requirements>\n\nThe action to be performed is as follows:\n<action>\n${args.action}\n</action>\n`;
}
