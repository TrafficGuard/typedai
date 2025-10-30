import { FastEasyLLM } from '#llm/multi-agent/fastEasy';
import { FastMediumLLM } from '#llm/multi-agent/fastMedium';
import type { LLM } from '#shared/llm/llm.model';

export function multiAgentLLMRegistry(): Array<() => LLM> {
	return [() => new FastMediumLLM(), () => new FastEasyLLM()];
}
