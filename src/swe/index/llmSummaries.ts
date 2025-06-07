// TODO: Consider importing a proper LLM type if available and appropriate, e.g.:
// import type { LLM } from '#shared/llm/llm.model';

/** Summary documentation for a file/folder */
export interface Summary {
	/** Path to the file/folder */
	path: string;
	/** A short of the file/folder */
	short: string;
	/** A longer summary of the file/folder */
	long: string;

	meta: {
		hash: string;
	};
}

/**
 * Generate a summary for a single file
 */
export async function generateFileSummary(fileContents: string, parentSummaries: Summary[], llm: any): Promise<Summary> {
	let parentSummaryText = '';
	if (parentSummaries.length) {
		parentSummaryText = '<parent-summaries>\n';
		for (const summary of parentSummaries) {
			parentSummaryText += `<parent-summary path="${summary.path}">\n${summary.long}\n</parent-summary>\n`;
		}
		parentSummaryText += '</parent-summaries>\n\n';
	}

	const prompt = `
Analyze this source code file and generate a summary that captures its purpose and functionality:

${parentSummaryText}
<source-code>
${fileContents}
</source-code>

Generate two summaries in JSON format:
1. A one-sentence overview of the file's purpose
2. A detailed paragraph describing:
   - The file's main functionality and features
   - Key classes/functions/components
   - Its role in the larger codebase
   - Important dependencies or relationships
   - Notable patterns or implementation details

Focus on unique aspects not covered in parent summaries.

Respond only with JSON in this format:
<json>
{
  "short": "One-sentence file summary",
  "long": "Detailed paragraph describing the file"
}
</json>`;

	return await llm.generateJson(prompt, { id: 'Generate file summary' });
}

/**
 * Generates a summary for a folder.
 */
export async function generateFolderSummary(llm: any, combinedSummary: string, parentSummaries: Summary[] = []): Promise<Summary> {
	let parentSummaryText = '';
	if (parentSummaries.length) {
		parentSummaryText = '<parent-summaries>\n';
		for (const summary of parentSummaries) {
			parentSummaryText += `<parent-summary path="${summary.path}">\n${summary.long}\n</parent-summary>\n`;
		}
		parentSummaryText += '</parent-summaries>\n\n';
	}

	const prompt = `
Analyze the following summaries of files and subfolders within this directory:

${parentSummaryText}
<summaries>
${combinedSummary}
</summaries>

Task: Generate a cohesive summary for this folder that captures its role in the larger project.

1. Key Topics:
   List 3-5 main topics or functionalities this folder addresses.

2. Folder Summary:
   Provide two summaries in JSON format:
   a) A one-sentence overview of the folder's purpose and contents.
   b) A paragraph-length description highlighting:
      - The folder's role in the project architecture
      - Main components or modules contained
      - Key functionalities implemented in this folder
      - Relationships with other parts of the codebase
      - Any patterns or principles evident in the folder's organization

Note: Focus on the folder's unique contributions. Avoid repeating information from parent summaries.

Respond only with JSON in this format:
<json>
{
  "short": "Concise one-sentence folder summary",
  "long": "Detailed paragraph summarizing the folder's contents and significance"
}
</json>
`;

	return await llm.generateJson(prompt, { id: 'Generate folder summary' });
}

/**
 * Generates a prompt for creating a detailed summary based on combined summaries.
 */
export function generateDetailedSummaryPrompt(combinedSummary: string): string {
	return `Based on the following folder summaries, create a comprehensive overview of the entire project:

${combinedSummary}

Generate a detailed Markdown summary that includes:

1. Project Overview:
   - The project's primary purpose and goals

2. Architecture and Structure:
   - High-level architecture of the project
   - Key directories and their roles
   - Main modules or components and their interactions

3. Core Functionalities:
   - List and briefly describe the main features with their location in the project

4. Technologies and Patterns:
   - Primary programming languages used
   - Key frameworks, libraries, or tools
   - Notable design patterns or architectural decisions

Ensure the summary is well-structured, using appropriate Markdown formatting for readability.
Include folder path names and file paths where applicable to help readers navigate through the project.
`;
}
