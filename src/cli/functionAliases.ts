import { logger } from '#o11y/logger';
import type { LLM } from '#shared/llm/llm.model';

// Lazy load defaultLLMs to avoid circular dependencies
function getDefaultLLM(): LLM | undefined {
	try {
		const { defaultLLMs } = require('#llm/services/defaultLlms');
		return defaultLLMs().easy;
	} catch (error) {
		logger.warn('Failed to load defaultLLMs for fuzzy matching:', error);
		return undefined;
	}
}

// Mapping of aliases to class names for easier CLI usage
// Class names are hardcoded to avoid eager module loading
const functionAliases: Record<string, string> = {
	f: 'AgentFeedback',
	swe: 'SoftwareDeveloperAgent',
	bash: 'CommandLineInterface',
	shell: 'CommandLineInterface',
	cli: 'CommandLineInterface',
	code: 'CodeEditingAgent',
	query: 'CodeFunctions',
	fsr: 'FileSystemRead',
	fsw: 'FileSystemWrite',
	fst: 'FileSystemTree',
	lfs: 'LocalFileStore',
	web: 'PublicWeb',
	llm: 'LlmTools',
	pp: 'Perplexity',
	npm: 'NpmPackages',
	gcp: 'GoogleCloud',
	ts: 'TypescriptTools',
	jira: 'Jira',
	rollbar: 'Rollbar',
	conf: 'Confluence',
	live: 'LiveFiles',
	gcloud: 'GoogleCloud',
	custom: 'CustomFunctions',
	kb: 'SupportKnowledgebase',
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
	// dynamic import is required to avoid module loading dependency issues
	const functionRegistry = (await import('../functionRegistryModule.cjs')).functionRegistry as () => Array<new () => any>;
	const registry = functionRegistry();
	const registryMap = new Map(registry.map((fn) => [fn.name, fn]));
	const llm: LLM | undefined = getDefaultLLM();

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
					.join(', ')}\nCheck the alias is correct and the function class is registered in the function registry.`,
			);
		}

		return match.constructor;
	});
}

/**
 * Builds a complete mapping of requested function names to their resolved matches
 */
async function buildFunctionMatches(requested: string, registryMap: Map<string, any>, llm: LLM | undefined): Promise<FunctionMatch> {
	const requestedLower = requested.toLowerCase();

	// Try exact match first (case-insensitive)
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

	// Try LLM fuzzy match as last resort (if LLM is available)
	if (llm) {
		try {
			const prompt = `Given the following list of available class names:
${Array.from(registryMap.keys()).join(', ')}

Which one of these class names most closely matches "${requested}"?
Consider similar words, abbreviations, and common variations.
Respond only with the exact matching class name from the list, or "NO_MATCH" if none are similar enough.`;

			const suggestedMatch = await llm.generateText(prompt, { id: 'Function aliases' });

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
	}

	// No match found
	return {
		requested,
		matched: '',
		constructor: null,
		matchType: 'none',
	};
}
