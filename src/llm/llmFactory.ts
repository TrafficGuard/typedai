import { deepSeekFallbackRegistry } from '#llm/multi-agent/deepSeek_Fallbacks';
import { multiAgentLLMRegistry } from '#llm/multi-agent/multiRegistry';
import { MoA_reasoningLLMRegistry } from '#llm/multi-agent/reasoning-debate';
import { MultiLLM } from '#llm/multi-llm';
import { anthropicLLMRegistry } from '#llm/services/anthropic';
import { anthropicVertexLLMRegistry } from '#llm/services/anthropic-vertex';
import { cerebrasLLMRegistry } from '#llm/services/cerebras';
import { openrouterLLMRegistry } from '#llm/services/cerebras-openrouter';
import { deepinfraLLMRegistry } from '#llm/services/deepinfra';
import { deepseekLLMRegistry } from '#llm/services/deepseek';
import { fireworksLLMRegistry } from '#llm/services/fireworks';
import { geminiLLMRegistry } from '#llm/services/gemini';
import { groqLLMRegistry } from '#llm/services/groq';
import { mockLLMRegistry } from '#llm/services/mock-llm';
import { nebiusLLMRegistry } from '#llm/services/nebius';
import { ollamaLLMRegistry } from '#llm/services/ollama';
import { openAiLLMRegistry } from '#llm/services/openai';
import { perplexityLLMRegistry } from '#llm/services/perplexity-llm';
import { sambanovaLLMRegistry } from '#llm/services/sambanova';
import { togetherLLMRegistry } from '#llm/services/together';
import { vertexLLMRegistry } from '#llm/services/vertexai';
import { xaiLLMRegistry } from '#llm/services/xai';
import { logger } from '#o11y/logger';
import type { AgentLLMs } from '#shared/agent/agent.model';
import type { LLM } from '#shared/llm/llm.model';

/**
 * Builds a Record<string, () => LLM> from arrays of LLM factory functions.
 * The key for each factory is obtained by calling factory().getId() on a temporary instance.
 *
 * @param registries - Arrays of LLM factory functions from each service/multi-agent registry
 * @returns Record mapping LLM IDs to their factory functions
 */
function buildLlmFactory(...registries: Array<() => LLM>[]): Record<string, () => LLM> {
	const factory: Record<string, () => LLM> = {};

	for (const registry of registries) {
		for (const llmFactory of registry) {
			// Create a temporary instance to get the ID
			const tempInstance = llmFactory();
			const id = tempInstance.getId();
			factory[id] = llmFactory;
		}
	}

	return factory;
}

// Lazy initialization to avoid calling factory functions during module initialization
let _LLM_FACTORY: Record<string, () => LLM> | null = null;

function ensureLLMFactory(): Record<string, () => LLM> {
	if (!_LLM_FACTORY) {
		_LLM_FACTORY = buildLlmFactory(
			anthropicVertexLLMRegistry(),
			anthropicLLMRegistry(),
			fireworksLLMRegistry(),
			groqLLMRegistry(),
			openAiLLMRegistry(),
			togetherLLMRegistry(),
			vertexLLMRegistry(),
			geminiLLMRegistry(),
			deepseekLLMRegistry(),
			deepinfraLLMRegistry(),
			cerebrasLLMRegistry(),
			perplexityLLMRegistry(),
			// xaiLLMRegistry(),
			nebiusLLMRegistry(),
			sambanovaLLMRegistry(),
			ollamaLLMRegistry(),
			deepSeekFallbackRegistry(),
			MoA_reasoningLLMRegistry(),
			multiAgentLLMRegistry(),
			openrouterLLMRegistry(),
			mockLLMRegistry(),
		);
	}
	return _LLM_FACTORY;
}

const modelMigrations: Record<string, string> = {};

let _llmTypes: Array<{ id: string; name: string }> | null = null;

export function llmTypes(): Array<{ id: string; name: string }> {
	_llmTypes ??= Object.values(ensureLLMFactory())
		.map((factory) => factory())
		.map((llm) => {
			for (const model of llm.getOldModels()) {
				modelMigrations[model] = llm.getModel();
			}
			return { id: llm.getId(), name: llm.getDisplayName() };
		});
	return _llmTypes;
}

let _llmRegistryKeys: string[];

function llmRegistryKeys(): string[] {
	_llmRegistryKeys ??= Object.keys(ensureLLMFactory());
	return _llmRegistryKeys;
}

/**
 * @param llmId LLM identifier in the format service:model
 */
export function getLLM(llmId: string): LLM {
	const factory = ensureLLMFactory();
	// Check matching id first
	if (factory[llmId]) {
		return factory[llmId]();
	}
	// Check substring matching
	for (const key of Object.keys(factory)) {
		if (llmId.startsWith(key)) {
			return factory[key]!();
		}
	}
	if (llmId === 'multi:multi') {
		logger.warn('TODO MultiLLM deserialization not implemented');
		return new MultiLLM([], 0);
	}
	// Check for old model names
	llmTypes(); // ensure model migrations are initialized
	const [id, model] = llmId.split(':');
	if (!id || !model) throw new Error(`Invalid LLM id ${llmId}`);
	if (modelMigrations[model]) return getLLM(`${id}:${modelMigrations[model]}`);

	throw new Error(`No LLM registered with id ${llmId}`);
}

export function deserializeLLMs(obj: any): AgentLLMs {
	return {
		easy: getLLM(obj.easy),
		medium: getLLM(obj.medium),
		hard: getLLM(obj.hard),
		xhard: obj.xhard ? getLLM(obj.xhard) : null,
	};
}
