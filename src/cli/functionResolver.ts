import { llms } from '#agent/agentContextLocalStorage';
import { LiveFiles } from '#agent/liveFiles';
import { Jira } from '#functions/jira';
import { FileSystemRead } from '#functions/storage/FileSystemRead';
import { FileSystemWrite } from '#functions/storage/FileSystemWrite';
import { Perplexity } from '#functions/web/perplexity';
import { PublicWeb } from '#functions/web/web';
import { LLM } from '#llm/llm';
import { defaultLLMs } from '#llm/services/defaultLlms';
import { logger } from '#o11y/logger';
import { CodeEditingAgent } from '#swe/codeEditingAgent';
import { NpmPackages } from '#swe/lang/nodejs/npmPackages';
import { TypescriptTools } from '#swe/lang/nodejs/typescriptTools';
import { SoftwareDeveloperAgent } from '#swe/softwareDeveloperAgent';
import { functionRegistry } from '../functionRegistry';

// Mapping of aliases to class names for easier CLI usage
const functionAliases: Record<string, string> = {
	swe: SoftwareDeveloperAgent.name,
	code: CodeEditingAgent.name,
	fs: FileSystemRead.name,
	fsw: FileSystemWrite.name,
	web: PublicWeb.name,
	pp: Perplexity.name,
	npm: NpmPackages.name,
	ts: TypescriptTools.name,
	jira: Jira.name,
	live: LiveFiles.name,
};

interface FunctionMatch {
	requested: string;
	matched: string;
	constructor: any;
	matchType: 'exact' | 'alias' | 'fuzzy' | 'none';
}

/**
 * Resolves requested function names to their actual class constructors
 * Handles exact matches, aliases, and fuzzy matching via LLM
 */
export async function resolveFunctionClasses(requestedFunctions: string[]): Promise<Array<new () => any>> {
	const registry = functionRegistry();
	const registryMap = new Map(registry.map((fn) => [fn.name, fn]));
	const llm: LLM = defaultLLMs().easy;

	// Build complete mapping of all function matches
	const matches = await Promise.all(requestedFunctions.map((requested) => buildFunctionMatches(requested, registryMap, llm)));

	// Process results and handle errors
	return matches.map((match) => {
		if (match.matchType === 'none') {
			logger.error(`Requested function class not found: ${match.requested}`);
			throw new Error(
				`Function class not found: ${match.requested}. Available classes: ${Array.from(registryMap.keys()).join(', ')}\nAvailable aliases: ${Object.entries(
					functionAliases,
				)
					.map(([k, v]) => `${k} -> ${v}`)
					.join(', ')}`,
			);
		}

		return match.constructor;
	});
}

/**
 * Builds a complete mapping of requested function names to their resolved matches
 */
async function buildFunctionMatches(requested: string, registryMap: Map<string, any>, llm: LLM): Promise<FunctionMatch> {
	const requestedLower = requested.toLowerCase();

	// Try exact match first (case insensitive)
	const exactMatch = Array.from(registryMap.keys()).find((key) => key.toLowerCase() === requestedLower);
	if (exactMatch) {
		return {
			requested,
			matched: exactMatch,
			constructor: registryMap.get(exactMatch),
			matchType: 'exact',
		};
	}

	// Try alias match
	const aliasMatch = functionAliases[requestedLower];
	if (aliasMatch && registryMap.has(aliasMatch)) {
		return {
			requested,
			matched: aliasMatch,
			constructor: registryMap.get(aliasMatch),
			matchType: 'alias',
		};
	}

	// Try LLM fuzzy match as last resort
	try {
		const prompt = `Given the following list of available class names:
${Array.from(registryMap.keys()).join(', ')}

Which one of these class names most closely matches "${requested}"?
Consider similar words, abbreviations, and common variations.
Respond only with the exact matching class name from the list, or "NO_MATCH" if none are similar enough.`;

		const suggestedMatch = await llm.generateText(prompt);

		// Validate LLM response is actually one of our class names
		if (suggestedMatch && suggestedMatch !== 'NO_MATCH' && registryMap.has(suggestedMatch)) {
			logger.info(`Mapped ${requested} to ${suggestedMatch}`);
			return {
				requested,
				matched: suggestedMatch,
				constructor: registryMap.get(suggestedMatch),
				matchType: 'fuzzy',
			};
		}
	} catch (error) {
		logger.error('LLM matching failed:', error);
	}

	// No match found
	return {
		requested,
		matched: '',
		constructor: null,
		matchType: 'none',
	};
}
