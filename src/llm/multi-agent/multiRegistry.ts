import { FastEasyLLM } from '#llm/multi-agent/fastEasy';
import { FastMediumLLM } from '#llm/multi-agent/fastMedium';
import type { LLM } from '#shared/llm/llm.model';

export function multiAgentLLMRegistry(): Record<string, () => LLM> {
	const registry = {};
	registry['multi:fast-medium'] = () => new FastMediumLLM();
	registry['multi:fast-easy'] = () => new FastEasyLLM();
	return registry;
}
