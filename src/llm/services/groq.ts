import { type GroqProvider, createGroq } from '@ai-sdk/groq';
import { LanguageModelV1, extractReasoningMiddleware, wrapLanguageModel } from 'ai';
import { fixedCostPerMilTokens } from '#llm/base-llm';
import { AiLLM } from '#llm/services/ai-llm';
import type { GenerateTextOptions, LLM, LlmCostFunction, LlmMessage } from '#shared/llm/llm.model';
import { currentUser } from '#user/userContext';

export const GROQ_SERVICE = 'groq';

export function groqLLMRegistry(): Record<string, () => LLM> {
	return {
		'groq:qwen/qwen3-32b': groqQwen3_32b,
		'groq:moonshotai/kimi-k2-instruct': groqKimiK2,
	};
}

// Pricing and model ids at
// https://groq.com/pricing/
// https://console.groq.com/docs/models

// Qwen3 32B 131khttps://console.groq.com/docs/model/qwen3-32b
// 16,384 max output tokens
export function groqQwen3_32b(): LLM {
	return new GroqLLM('Qwen3 32b (Groq)', 'qwen/qwen3-32b', 131_072, fixedCostPerMilTokens(0.29, 0.59));
}

export function groqKimiK2(): LLM {
	return new GroqLLM(
		'Kimi K2 (Groq)',
		'moonshotai/kimi-k2-instruct',
		// 16,384 max output tokens (from official Groq documentation)
		16384,
		fixedCostPerMilTokens(1.0, 3.0),
	);
}

/**
 * https://wow.groq.com/
 */
export class GroqLLM extends AiLLM<GroqProvider> {
	constructor(displayName: string, model: string, maxOutputTokens: number, calculateCosts: LlmCostFunction) {
		super(displayName, GROQ_SERVICE, model, maxOutputTokens, calculateCosts);
	}

	aiModel(): LanguageModelV1 {
		const aiModel = super.aiModel();
		if (this.getModel().includes('qwen3-32b')) {
			return wrapLanguageModel({
				model: aiModel,
				middleware: extractReasoningMiddleware({ tagName: 'think' }),
			});
		}
		return aiModel;
	}

	protected apiKey(): string {
		return currentUser()?.llmConfig.groqKey || process.env.GROQ_API_KEY;
	}

	provider(): GroqProvider {
		this.aiProvider ??= createGroq({
			apiKey: this.apiKey() ?? '',
		});

		return this.aiProvider;
	}
}
