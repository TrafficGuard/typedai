import { createCerebras } from '@ai-sdk/cerebras';
import { OpenAIProvider } from '@ai-sdk/openai';
import { InputCostFunction, OutputCostFunction, perMilTokens } from '#llm/base-llm';
import { currentUser } from '#user/userService/userContext';
import { LLM } from '../llm';
import { AiLLM } from './ai-llm';

export const CEREBRAS_SERVICE = 'cerebras';

export function cerebrasLLMRegistry(): Record<string, () => LLM> {
	return {
		'cerebras:llama3.1-8b': () => cerebrasLlama3_8b(),
		'cerebras:llama-3.3-70b': () => cerebrasLlama3_3_70b(),
	};
}

export function cerebrasLlama3_8b(): LLM {
	return new CerebrasLLM('Llama 3.1 8b (Cerebras)', 'llama3.1-8b', 8_192, perMilTokens(0.1), perMilTokens(0.1));
}

export function cerebrasLlama3_3_70b(): LLM {
	return new CerebrasLLM('Llama 3.3 70b (Cerebras)', 'llama-3.3-70b', 8_192, perMilTokens(0.85), perMilTokens(1.2));
}

/**
 * https://inference-docs.cerebras.ai/introduction
 */
export class CerebrasLLM extends AiLLM<OpenAIProvider> {
	constructor(displayName: string, model: string, maxInputTokens: number, calculateInputCost: InputCostFunction, calculateOutputCost: OutputCostFunction) {
		super(displayName, CEREBRAS_SERVICE, model, maxInputTokens, calculateInputCost, calculateOutputCost);
	}

	protected provider(): any {
		return createCerebras({
			apiKey: this.apiKey(),
		});
	}

	protected apiKey(): string | undefined {
		return currentUser().llmConfig.cerebrasKey || process.env.CEREBRAS_API_KEY;
	}
}
