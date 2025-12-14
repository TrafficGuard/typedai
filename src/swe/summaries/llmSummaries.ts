import type { LLM } from '#shared/llm/llm.model';

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

/** JSON Schema for Summary output (without meta/path fields which are added by the caller) */
const SUMMARY_JSON_SCHEMA = {
	type: 'object',
	properties: {
		short: {
			type: 'string',
			description: 'A concise summary (maximum 15 words) stating what the file/folder defines, implements, or exports',
		},
		long: {
			type: 'string',
			description: 'A detailed summary (2-4 sentences) listing specific exports, dependencies, and patterns',
		},
	},
	required: ['short', 'long'],
	additionalProperties: false,
} as const;

/**
 * Generate a summary for a single file
 */
export async function generateFileSummary(fileContents: string, parentSummaries: Summary[], llm: LLM): Promise<Summary> {
	let parentSummaryText = '';
	if (parentSummaries.length) {
		parentSummaryText = '<parent-summaries>\n';
		for (const summary of parentSummaries) {
			parentSummaryText += `<parent-summary path="${summary.path}">\n${summary.long}\n</parent-summary>\n`;
		}
		parentSummaryText += '</parent-summaries>\n\n';
	}

	const prompt = `
Analyze this source code file and generate a factual, concise summary:

${parentSummaryText}
<source-code>
${fileContents}
</source-code>

Generate two summaries in JSON format:

SHORT SUMMARY:
- Maximum 15 words
- State what the file defines/implements/exports
- Omit filler words like "This file", "The file's main", "It features"
- Start directly with the subject (e.g., "API routes for...", "Service handling...", "Utilities for...")

LONG SUMMARY:
- Maximum 3 concise sentences
- List specific exports: classes, functions, routes, components, types
- Name key dependencies or patterns used
- Avoid subjective commentary (no "demonstrates quality", "commitment to", "plays a crucial role")
- Avoid generic phrases (no "provides a structured approach", "ensures type safety")
- Be factual and specific - focus on WHAT, not WHY or evaluation

CRITICAL JSON FORMATTING:
- Do NOT use backticks (\`) anywhere in the JSON output
- Reference code elements without markdown formatting (e.g., "parseFunctionCallsXml" not "\`parseFunctionCallsXml\`")
- Use plain text for all function names, class names, and code references

Examples of good vs bad:
❌ "The file's organization demonstrates commitment to code quality"
✅ "Exports createUser, deleteUser, updateUser functions"

❌ "Provides a structured approach to API development"
✅ "Defines 9 API routes using defineApiRoute helper"

❌ "Exports \`parseXml\` and \`parseJson\` functions"
✅ "Exports parseXml and parseJson functions"

Respond only with JSON in this format:
<json>
{
  "short": "Direct subject-focused summary under 15 words",
  "long": "Factual list of exports, dependencies, and patterns in 2-3 sentences"
}
</json>`;

	// Note: The LLM only generates 'short' and 'long'. The caller adds 'path' and 'meta' fields.
	return (await llm.generateJson(prompt, {
		id: 'Generate file summary',
		jsonSchema: SUMMARY_JSON_SCHEMA,
		thinking: 'none',
	})) as any;
}

/**
 * Generates a summary for a folder.
 * @param combinedSummary summaries of all the files and folders within this folder
 */
export async function generateFolderSummary(llm: LLM, combinedSummary: string, parentSummaries: Summary[] = []): Promise<Summary> {
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

Generate a factual, concise folder summary:

SHORT SUMMARY:
- Maximum 15 words
- State the folder's primary purpose/domain
- Start directly with the subject (e.g., "Authentication services and middleware", "API route definitions", "Database models and schemas")
- Omit "This folder", "Contains", "Includes"

LONG SUMMARY:
- Maximum 4 concise sentences
- List the main file/subfolder categories and their purposes
- Identify common patterns or shared dependencies
- State the folder's domain or responsibility
- Avoid subjective commentary (no "plays a crucial role", "demonstrates organization")
- Avoid generic phrases (no "provides functionality for", "ensures consistency")
- Be factual and specific

CRITICAL JSON FORMATTING:
- Do NOT use backticks (\`) anywhere in the JSON output
- Reference code elements without markdown formatting (e.g., "AuthService" not "\`AuthService\`")
- Use plain text for all function names, class names, file names, and code references

# Examples of good vs bad summaries:

❌ "This folder plays a crucial role in the project's authentication architecture"
✅ "Authentication: JWT middleware, session management, OAuth providers"

❌ "The folder demonstrates well-organized code structure"
✅ "Contains 5 route definition files and 3 validation schemas"

❌ "Contains \`userService.ts\` and \`authService.ts\`"
✅ "Contains userService.ts and authService.ts"

Folder: frontend/src/@fuse/components/navigation/vertical/components/divider/ 
❌  The \`divider\` folder within \`frontend/src/@fuse/components/navigation/vertical/components\` houses the component responsible for rendering visual dividers within the vertical navigation structure.
✅ Components responsible for rendering visual dividers within the vertical navigation structure.

Respond only with JSON in this format:
<json>
{
  "short": "Direct domain/purpose under 15 words",
  "long": "Factual list of contents and patterns in 3-4 sentences"
}
</json>
`;

	// Note: The LLM only generates 'short' and 'long'. The caller adds 'path' and 'meta' fields.
	return (await llm.generateJson(prompt, {
		id: 'Generate folder summary',
		jsonSchema: SUMMARY_JSON_SCHEMA,
		thinking: 'none',
	})) as any;
}

/**
 * Generates a prompt for creating a detailed summary based on combined summaries.
 */
export function generateDetailedSummaryPrompt(combinedSummary: string): string {
	return `Based on the following folder summaries, create a factual, concise project overview:

${combinedSummary}

Generate a well-structured Markdown summary with these sections:

## Project Overview
- 2-3 sentences describing what the project is and its primary purpose
- Avoid subjective commentary (no "robust", "well-designed", "high-quality")
- Be specific about the domain and key capabilities

## Architecture and Structure
- List key directories and their specific responsibilities
- Include actual folder paths (e.g., "src/api/", "src/services/")
- Mention main architectural patterns if evident (REST API, microservices, etc.)

## Core Functionalities
- Bulleted list of main features/capabilities
- Include location references (e.g., "User authentication (src/auth/)")
- Be specific, not vague (e.g., "JWT-based auth" not "authentication system")

## Technologies and Patterns
- Primary programming language(s) and runtime
- Key frameworks and libraries actually used
- Notable patterns or tools (e.g., "Fastify web framework", "Drizzle ORM")

Guidelines:
- Be factual and specific
- Avoid subjective quality assessments
- Use actual folder/file paths as references
- Keep each section concise (3-5 bullet points max)
- No marketing language or fluff
`;
}
