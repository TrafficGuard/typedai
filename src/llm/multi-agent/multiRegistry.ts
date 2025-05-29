import { FastMediumLLM } from '#llm/multi-agent/fastMedium';
import { cerebrasQwen3_32b } from '#llm/services/cerebras';
import type { LLM } from '#shared/llm/llm.model';

export function multiAgentLLMRegistry(): Record<string, () => LLM> {
	const registry = {};
	// registry[`multi:CePO-${cerebrasQwen3_32b().getId()}`] = () => new CcerebrasQwen3_32b();
	registry['multi:fast-medium'] = () => new FastMediumLLM();
	return registry;
}
