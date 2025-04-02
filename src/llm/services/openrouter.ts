import { OpenAIProvider, createOpenAI } from '@ai-sdk/openai';
import { InputCostFunction, OutputCostFunction, perMilTokens } from '#llm/base-llm';
import { currentUser } from '#user/userService/userContext';
import { LLM } from '../llm';
import { AiLLM } from './ai-llm';

export const OPENROUTER_SERVICE = 'openrouter';

export function openrouterLLMRegistry(): Record<string, () => LLM> {
	return {
		'openrouter:google/gemini-2.5-pro-exp-03-25:free': () => openRouterGemini2_5_Pro(),
	};
}

// https://openrouter.ai/models

export function openRouterGemini2_5_Pro(): LLM {
	return new OpenRouterLLM('Gemini 2.5 Pro (OpenRouter)', 'google/gemini-2.5-pro-exp-03-25:free', 1_000_000, perMilTokens(0), perMilTokens(0));
}

/**
 * https://inference-docs.openrouter.ai/introduction
 * Next release of OpenRouter provider should work instead of using OpenAIProvider
 */
export class OpenRouterLLM extends AiLLM<OpenAIProvider> {
	constructor(displayName: string, model: string, maxInputTokens: number, calculateInputCost: InputCostFunction, calculateOutputCost: OutputCostFunction) {
		super(displayName, OPENROUTER_SERVICE, model, maxInputTokens, calculateInputCost, calculateOutputCost);
	}

	protected provider(): any {
		return createOpenAI({
			baseURL: 'https://openrouter.ai/api/v1',
			apiKey: this.apiKey(),
			headers: {
				'HTTP-Referer': 'https://typedai.dev', // Optional. Site URL for rankings on openrouter.ai.
				'X-Title': 'TypedAI', // Optional. Site title for rankings on
			},
		});
	}

	protected apiKey(): string | undefined {
		return currentUser().llmConfig.openrouterKey || process.env.OPENROUTER_API_KEY;
	}
}
