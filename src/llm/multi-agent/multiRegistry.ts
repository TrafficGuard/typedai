import { CePO_Cerebras_Llama70b } from '#llm/multi-agent/cepo';
import { FastMediumLLM } from '#llm/multi-agent/fastMedium';
import { cerebrasLlama3_3_70b } from '#llm/services/cerebras';
import type { LLM } from '#shared/model/llm.model';

export function multiAgentLLMRegistry(): Record<string, () => LLM> {
	const registry = {};
	registry[`multi:CePO-${cerebrasLlama3_3_70b().getId()}`] = () => CePO_Cerebras_Llama70b();
	registry['multi:fast-medium'] = () => new FastMediumLLM();
	return registry;
}
