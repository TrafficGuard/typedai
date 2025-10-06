import { createCerebras } from '@ai-sdk/cerebras';
import type { OpenAIProvider } from '@ai-sdk/openai';
import { LanguageModelV2 } from '@ai-sdk/provider';
import { extractReasoningMiddleware, wrapLanguageModel } from 'ai';
import { costPerMilTokens } from '#llm/base-llm';
import { createEnvKeyRotator } from '#llm/services/key-rotation';
import type { LLM, LlmCostFunction } from '#shared/llm/llm.model';
import { currentUser } from '#user/userContext';
import { AiLLM } from './ai-llm';

export const CEREBRAS_SERVICE = 'cerebras';

export function cerebrasLLMRegistry(): Record<string, () => LLM> {
	return {
		'cerebras:qwen-3-32b': () => cerebrasQwen3_32b(),
		'cerebras:qwen-3-235b-a22b-instruct-2507': () => cerebrasQwen3_235b_Instruct(),
		'cerebras:qwen-3-235b-a22b-thinking-2507': () => cerebrasQwen3_235b_Thinking(),
		'cerebras:qwen-3-coder-480b': () => cerebrasQwen3_Coder(),
		'cerebras:gpt-oss-120b': () => cerebrasGptOss_120b(),
	};
}

// https://cloud.cerebras.ai/platform/org_<org-id>/models  PAYG rate limits
// https://inference-docs.cerebras.ai/support/rate-limits. rate limit headers
// https://cerebras-inference.help.usepylon.com/articles/9996007307-cerebras-code-faq  Cerebras Code rate limits
/*
Cerebras Code 

 Tier    RPM    TPM        TPD
 Pro     15     165,000    24M
 Max     20     275,000    120M
*/

// https://inference-docs.cerebras.ai/models/qwen-3-32b
export function cerebrasQwen3_32b(): LLM {
	return new CerebrasLLM('Qwen3 32b (Cerebras)', 'qwen-3-32b', 16_382, costPerMilTokens(0.4, 0.8));
}

// https://inference-docs.cerebras.ai/models/qwen-3-235b-2507
export function cerebrasQwen3_235b_Instruct(): LLM {
	return new CerebrasLLM('Qwen3 235b Instruct (Cerebras)', 'qwen-3-235b-a22b-instruct-2507', 131_000, costPerMilTokens(0.6, 1.2));
}

// https://inference-docs.cerebras.ai/models/qwen-3-235b-thinking
export function cerebrasQwen3_235b_Thinking(): LLM {
	return new CerebrasLLM('Qwen3 235b Thinking (Cerebras)', 'qwen-3-235b-a22b-thinking-2507', 131_000, costPerMilTokens(0.6, 1.2), ['qwen-3-235b-a22b']);
}

// https://inference-docs.cerebras.ai/models/qwen-3-480b
export function cerebrasQwen3_Coder(): LLM {
	return new CerebrasLLM('Qwen3 Coder (Cerebras)', 'qwen-3-coder-480b', 131_000, costPerMilTokens(2, 2), ['qwen-3-235b-a22b']);
}

// https://inference-docs.cerebras.ai/models/gpt-oss-120b
export function cerebrasGptOss_120b(): LLM {
	return new CerebrasLLM('GPT OSS 120B (Cerebras)', 'gpt-oss-120b', 131_000, costPerMilTokens(0.35, 0.75), [
		'llama-4-maverick-17b-128e-instruct',
		'llama3.1-8b',
	]);
}

const cerebrasKeyRotator = createEnvKeyRotator('CEREBRAS_API_KEY');

/**
 * https://inference-docs.cerebras.ai/introduction
 */
export class CerebrasLLM extends AiLLM<OpenAIProvider> {
	constructor(displayName: string, model: string, maxInputTokens: number, calculateCosts: LlmCostFunction, oldModelIds?: string[]) {
		super({ displayName, service: CEREBRAS_SERVICE, modelId: model, maxInputTokens, calculateCosts, oldIds: oldModelIds });
	}

	override aiModel(): LanguageModelV2 {
		const aiModel = super.aiModel();
		if (this.getModel().includes('qwen-3')) {
			return wrapLanguageModel({
				model: aiModel,
				middleware: extractReasoningMiddleware({ tagName: 'think', startWithReasoning: true }),
			});
		}
		return aiModel;
	}

	protected override provider(): any {
		return createCerebras({
			apiKey: this.apiKey(),
		});
	}

	protected override apiKey(): string | undefined {
		return currentUser()?.llmConfig.cerebrasKey?.trim() || cerebrasKeyRotator.next();
	}
}
