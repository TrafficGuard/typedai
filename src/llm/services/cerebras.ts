import { createCerebras } from '@ai-sdk/cerebras';
import type { OpenAIProvider } from '@ai-sdk/openai';
import { type LlmCostFunction, fixedCostPerMilTokens } from '#llm/base-llm';
import type { LLM } from '#shared/llm/llm.model';
import { currentUser } from '#user/userContext';
import { AiLLM } from './ai-llm';

export const CEREBRAS_SERVICE = 'cerebras';

const CEREBRAS_KEYS: string[] = [];
if (process.env.CEREBRAS_API_KEY) CEREBRAS_KEYS.push(process.env.CEREBRAS_API_KEY);
for (let i = 2; i <= 9; i++) {
	const key = process.env[`CEREBRAS_API_KEY_${i}`];
	if (key) CEREBRAS_KEYS.push(key);
	else break;
}
let cerebrasKeyIndex = 0;

/**
 * https://inference-docs.cerebras.ai/introduction
 */
export class CerebrasLLM extends AiLLM<OpenAIProvider> {
	constructor(displayName: string, model: string, maxInputTokens: number, calculateCosts: LlmCostFunction) {
		super(displayName, CEREBRAS_SERVICE, model, maxInputTokens, calculateCosts);
	}

	protected provider(): any {
		return createCerebras({
			apiKey: this.apiKey(),
		});
	}

	protected apiKey(): string | undefined {
		let envKey: string;
		if (CEREBRAS_KEYS.length) {
			envKey = CEREBRAS_KEYS[cerebrasKeyIndex];
			if (++cerebrasKeyIndex > CEREBRAS_KEYS.length) cerebrasKeyIndex = 0;
		}
		return currentUser().llmConfig.cerebrasKey || envKey || process.env.CEREBRAS_API_KEY;
	}
}

export function cerebrasLLMRegistry(): Record<string, () => LLM> {
	return {
		'cerebras:qwen-3-32b': () => cerebrasQwen3_32b(),
		'cerebras:llama3.1-8b': () => cerebrasLlama3_8b(),
		'cerebras:llama-3.3-70b': () => cerebrasLlama3_3_70b(),
	};
}

export function cerebrasQwen3_32b(): LLM {
	return new CerebrasLLM('Qwen3 32b (Cerebras)', 'qwen-3-32b', 16_382, fixedCostPerMilTokens(0.4, 0.8));
}

export function cerebrasLlama3_8b(): LLM {
	return new CerebrasLLM('Llama 3.1 8b (Cerebras)', 'llama3.1-8b', 8_192, fixedCostPerMilTokens(0.1, 0.1));
}

export function cerebrasLlama3_3_70b(): LLM {
	return new CerebrasLLM('Llama 3.3 70b (Cerebras)', 'llama-3.3-70b', 8_192, fixedCostPerMilTokens(0.85, 1.2));
}
