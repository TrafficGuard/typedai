import { createCerebras } from '@ai-sdk/cerebras';
import type { OpenAIProvider } from '@ai-sdk/openai';
import { LanguageModelV1, extractReasoningMiddleware, wrapLanguageModel } from 'ai';
import { fixedCostPerMilTokens } from '#llm/base-llm';
import type { LLM, LlmCostFunction } from '#shared/llm/llm.model';
import { currentUser } from '#user/userContext';
import { AiLLM } from './ai-llm';

export const CEREBRAS_SERVICE = 'cerebras';

export function cerebrasLLMRegistry(): Record<string, () => LLM> {
	return {
		'cerebras:qwen-3-32b': () => cerebrasQwen3_32b(),
		'cerebras:qwen-3-235b-instruct-2507': () => cerebrasQwen3_235b_Instruct(),
		'cerebras:qwen-3-235b-thinking-2507': () => cerebrasQwen3_235b_Thinking(),
		'cerebras:qwen-3-coder-480b': () => cerebrasQwen3_Coder(),
		'cerebras:llama-4-maverick-17b-128e-instruct': () => cerebrasLlamaMaverick(),
	};
}

// https://inference-docs.cerebras.ai/models/qwen-3-32b
export function cerebrasQwen3_32b(): LLM {
	return new CerebrasLLM('Qwen3 32b (Cerebras)', 'qwen-3-32b', 16_382, fixedCostPerMilTokens(0.4, 0.8));
}

// https://inference-docs.cerebras.ai/models/qwen-3-235b-2507
export function cerebrasQwen3_235b_Instruct(): LLM {
	return new CerebrasLLM('Qwen3 235b Instruct (Cerebras)', 'qwen-3-235b-a22b-instruct-2507', 131_000, fixedCostPerMilTokens(0.6, 1.2));
}

// https://inference-docs.cerebras.ai/models/qwen-3-235b-thinking
export function cerebrasQwen3_235b_Thinking(): LLM {
	return new CerebrasLLM('Qwen3 235b Thinking (Cerebras)', 'qwen-3-235b-a22b-thinking-2507', 131_000, fixedCostPerMilTokens(0.6, 1.2), ['qwen-3-235b-a22b']);
}

// https://inference-docs.cerebras.ai/models/qwen-3-480b
export function cerebrasQwen3_Coder(): LLM {
	return new CerebrasLLM('Qwen3 Coder (Cerebras)', 'qwen-3-coder-480b', 131_000, fixedCostPerMilTokens(2, 2), ['qwen-3-235b-a22b']);
}

// https://inference-docs.cerebras.ai/models/llama-4-maverick
export function cerebrasLlamaMaverick(): LLM {
	return new CerebrasLLM('Llama Maverick (Cerebras)', 'llama-4-maverick-17b-128e-instruct', 32_000, fixedCostPerMilTokens(0.2, 0.6), ['llama3.1-8b']);
}

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
	constructor(displayName: string, model: string, maxInputTokens: number, calculateCosts: LlmCostFunction, oldModelIds?: string[]) {
		super(displayName, CEREBRAS_SERVICE, model, maxInputTokens, calculateCosts, oldModelIds);
	}

	aiModel(): LanguageModelV1 {
		const aiModel = super.aiModel();
		if (this.getModel().includes('qwen-3')) {
			return wrapLanguageModel({
				model: aiModel,
				middleware: extractReasoningMiddleware({ tagName: 'think' }),
			});
		}
		return aiModel;
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
		return currentUser()?.llmConfig.cerebrasKey || envKey || process.env.CEREBRAS_API_KEY;
	}
}
