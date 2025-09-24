import { type GoogleGenerativeAIProvider, createGoogleGenerativeAI } from '@ai-sdk/google';
import { costPerMilTokens } from '#llm/base-llm';
import { AiLLM } from '#llm/services/ai-llm';
import { createEnvKeyRotator } from '#llm/services/key-rotation';
import type { LLM, LlmCostFunction } from '#shared/llm/llm.model';
import { currentUser } from '#user/userContext';

export const GEMINI_SERVICE = 'gemini';

export function geminiLLMRegistry(): Record<string, () => LLM> {
	return {
		[`${GEMINI_SERVICE}:gemini-2.5-flash-lite`]: Gemini_2_5_Flash_Lite,
		[`${GEMINI_SERVICE}:gemini-2.5-flash`]: Gemini_2_5_Flash,
		[`${GEMINI_SERVICE}:gemini-2.5-pro`]: Gemini_2_5_Pro,
	};
}

export function Gemini_2_5_Pro(): LLM {
	return new GeminiLLM('Gemini 2.5 Pro (Gemini)', 'gemini-2.5-pro', 1_000_000, costPerMilTokens(1.25, 10, 1.25 / 4, 2.5, 15, 200_000), [
		'gemini-2.5-pro-preview-05-06',
		'gemini-2.5-pro-preview-06-05',
	]);
}

export function Gemini_2_5_Flash(): LLM {
	return new GeminiLLM('Gemini 2.5 Flash (Gemini)', 'gemini-2.5-flash', 1_000_000, costPerMilTokens(0.3, 2.5));
}

export function Gemini_2_5_Flash_Lite(): LLM {
	return new GeminiLLM('Gemini 2.5 Flash Lite (Gemini)', 'gemini-2.5-flash-lite-preview-06-17', 1_000_000, costPerMilTokens(0.1, 0.4));
}

const geminiKeyRotator = createEnvKeyRotator('GEMINI_API_KEY');

/**
 * Gemini AI models
 */
class GeminiLLM extends AiLLM<GoogleGenerativeAIProvider> {
	constructor(displayName: string, model: string, maxInputToken: number, costFunction: LlmCostFunction, oldModelIds: string[] = []) {
		super({ displayName, service: GEMINI_SERVICE, modelId: model, maxInputTokens: maxInputToken, calculateCosts: costFunction, oldIds: oldModelIds });
	}

	protected apiKey(): string | undefined {
		return currentUser()?.llmConfig.geminiKey?.trim() || geminiKeyRotator.next();
	}

	provider(): GoogleGenerativeAIProvider {
		this.aiProvider ??= createGoogleGenerativeAI({
			apiKey: this.apiKey(),
			// project: currentUser().llmConfig.vertexProjectId ?? envVar('GCLOUD_PROJECT'),
			// location: currentUser().llmConfig.vertexRegion ?? envVar('GCLOUD_REGION'),
		});

		return this.aiProvider;
	}
}
