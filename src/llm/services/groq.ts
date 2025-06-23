import { type GroqProvider, createGroq } from '@ai-sdk/groq';
import { fixedCostPerMilTokens } from '#llm/base-llm';
import { AiLLM } from '#llm/services/ai-llm';
import type { GenerateTextOptions, LLM, LlmCostFunction, LlmMessage } from '#shared/llm/llm.model';
import { currentUser } from '#user/userContext';

export const GROQ_SERVICE = 'groq';

export function groqLLMRegistry(): Record<string, () => LLM> {
	return {
		'groq:qwen/qwen3-32b': groqQwen3_32b,
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

/**
 * https://wow.groq.com/
 */
export class GroqLLM extends AiLLM<GroqProvider> {
	constructor(displayName: string, model: string, maxOutputTokens: number, calculateCosts: LlmCostFunction) {
		super(displayName, GROQ_SERVICE, model, maxOutputTokens, calculateCosts);
	}

	protected apiKey(): string {
		return currentUser().llmConfig.groqKey || process.env.GROQ_API_KEY;
	}

	async generateTextFromMessages(llmMessages: LlmMessage[], opts?: GenerateTextOptions): Promise<string> {
		const genOpts = { ...opts };
		// https://groq.com/a-guide-to-reasoning-with-qwen-qwq-32b/
		// https://console.groq.com/docs/model/qwen-qwq-32b
		if (this.getModel() === 'qwen-qwq-32b') {
			genOpts.temperature = 0.6;
			genOpts.maxOutputTokens = 131072;
			genOpts.topP = 0.95;
		}
		return super.generateTextFromMessages(llmMessages, genOpts);
	}

	provider(): GroqProvider {
		this.aiProvider ??= createGroq({
			apiKey: this.apiKey() ?? '',
		});

		return this.aiProvider;
	}
}
