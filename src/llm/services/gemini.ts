import { type GoogleGenerativeAIProvider, createGoogleGenerativeAI } from '@ai-sdk/google';
import { fixedCostPerMilTokens } from '#llm/base-llm';
import { AiLLM } from '#llm/services/ai-llm';
import { gemini2_5_Pro_CostFunction } from '#llm/services/vertexai';
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
	return new GeminiLLM('Gemini 2.5 Pro (Gemini)', 'gemini-2.5-pro', 1_000_000, gemini2_5_Pro_CostFunction(1.25, 10, 2.5, 15), [
		'gemini-2.5-pro-preview-05-06',
		'gemini-2.5-pro-preview-06-05',
	]);
}

export function Gemini_2_5_Flash(): LLM {
	return new GeminiLLM('Gemini 2.5 Flash (Gemini)', 'gemini-2.5-flash', 1_000_000, fixedCostPerMilTokens(0.3, 2.5));
}

export function Gemini_2_5_Flash_Lite(): LLM {
	return new GeminiLLM('Gemini 2.5 Flash Lite (Gemini)', 'gemini-2.5-flash-lite-preview-06-17', 1_000_000, fixedCostPerMilTokens(0.1, 0.4));
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
	constructor(displayName: string, model: string, maxInputToken: number, costFunction: LlmCostFunction, oldModelIds: string[] = []) {
		super(displayName, GEMINI_SERVICE, model, maxInputToken, costFunction, oldModelIds);
	}

	protected apiKey(): string | undefined {
		let envKey: string | undefined;
		if (GEMINI_KEYS.length) {
			envKey = GEMINI_KEYS[geminiKeyIndex];
			if (++geminiKeyIndex > GEMINI_KEYS.length) geminiKeyIndex = 0;
		}
		return currentUser()?.llmConfig.geminiKey || envKey || process.env.GEMINI_API_KEY;
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
