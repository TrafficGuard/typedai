import { type GoogleGenerativeAIProvider, createGoogleGenerativeAI } from '@ai-sdk/google';
import { type LlmCostFunction, fixedCostPerMilTokens } from '#llm/base-llm';
import { AiLLM } from '#llm/services/ai-llm';
import { gemini2_5_Flash_CostFunction, gemini2_5_Pro_CostFunction } from '#llm/services/vertexai';
import type { LLM } from '#shared/llm/llm.model';
import { currentUser } from '#user/userContext';
import { envVar } from '#utils/env-var';

export const GEMINI_SERVICE = 'gemini';

export function geminiLLMRegistry(): Record<string, () => LLM> {
	return {
		[`${GEMINI_SERVICE}:gemini-2.0-flash-lite`]: Gemini_2_0_Flash_Lite,
		[`${GEMINI_SERVICE}:gemini-2.5-flash`]: Gemini_2_5_Flash,
		[`${GEMINI_SERVICE}:gemini-2.5-pro`]: Gemini_2_5_Pro,
	};
}

export function Gemini_2_5_Pro() {
	return new GeminiLLM('Gemini 2.5 Pro', 'gemini-2.5-pro-exp-03-25', 1_000_000, gemini2_5_Pro_CostFunction(1.25, 10, 2.5, 15));
}

export function Gemini_2_5_Flash() {
	return new GeminiLLM('Gemini 2.5 Flash', 'gemini-2.5-flash-preview-04-17', 1_000_000, gemini2_5_Flash_CostFunction(0.15, 0.6, 3.5));
}

export function Gemini_2_0_Flash_Lite() {
	return new GeminiLLM('Gemini 2.0 Flash Lite', 'gemini-2.0-flash-lite-preview-02-05', 1_000_000, fixedCostPerMilTokens(0.075, 0.3));
}

const GEMINI_KEYS: string[] = [];
if (process.env.GEMINI_API_KEY) GEMINI_KEYS.push(process.env.GEMINI_API_KEY);
for (let i = 2; i <= 9; i++) {
	const key = process.env[`GEMINI_API_KEY_${i}`];
	if (key) GEMINI_KEYS.push(key);
	else break;
}
let geminiKeyIndex = 0;

/**
 * Gemini AI models
 */
class GeminiLLM extends AiLLM<GoogleGenerativeAIProvider> {
	constructor(displayName: string, model: string, maxInputToken: number, costFunction: LlmCostFunction) {
		super(displayName, GEMINI_SERVICE, model, maxInputToken, costFunction);
	}

	protected apiKey(): string {
		let envKey: string;
		if (GEMINI_KEYS.length) {
			envKey = GEMINI_KEYS[geminiKeyIndex];
			if (++geminiKeyIndex > GEMINI_KEYS.length) geminiKeyIndex = 0;
		}
		return currentUser().llmConfig.geminiKey || envKey || process.env.GEMINI_API_KEY;
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
