import { type GroqProvider, createGroq } from '@ai-sdk/groq';
import { type LlmCostFunction, fixedCostPerMilTokens } from '#llm/base-llm';
import { AiLLM } from '#llm/services/ai-llm';
import type { GenerateTextOptions, LLM, LlmMessage } from '#shared/llm/llm.model';
import { currentUser } from '#user/userContext';

export const GROQ_SERVICE = 'groq';

export function groqLLMRegistry(): Record<string, () => LLM> {
	return {
		// 'groq:llama-3.3-70b-versatile': groqLlama3_3_70B,
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

export function groqLlama3_3_70B(): LLM {
	return new GroqLLM('Llama3.3 70b (Groq)', 'llama-3.3-70b-versatile', 131_072, fixedCostPerMilTokens(0.59, 0.79));
}

/*
DeepSeek R1 Distill Llama 70B Tiered Pricing:
- Up to 4k total tokens: $0.75/M input, $0.99/M output
- 4k-32k total tokens: $3.00/M input, $3.00/M output
- Above 32k total tokens: $5.00/M input, $5.00/M output
*/
const groqR1DistillCostFunction: LlmCostFunction = (inputTokens: number, outputTokens: number) => {
	const totalTokens = inputTokens + outputTokens;
	let inputMil: number;
	let outputMil: number;

	if (totalTokens <= 4000) {
		inputMil = 0.75;
		outputMil = 0.99;
	} else if (totalTokens <= 32000) {
		inputMil = 3.0;
		outputMil = 3.0;
	} else {
		inputMil = 5.0;
		outputMil = 5.0;
	}

	const inputCost = (inputTokens * inputMil) / 1_000_000;
	const outputCost = (outputTokens * outputMil) / 1_000_000;
	return { inputCost, outputCost, totalCost: inputCost + outputCost };
};

export function groqLlama3_3_70B_R1_Distill(): LLM {
	return new GroqLLM('Llama3.3 70b R1 Distill (Groq)', 'deepseek-r1-distill-llama-70b', 128_000, groqR1DistillCostFunction);
}

/**
 * Qwen QWQ 32B model from Groq
 * Pricing: $0.29/M input tokens, $0.39/M output tokens
 * https://groq.com/a-guide-to-reasoning-with-qwen-qwq-32b/
 */
export function groqQwenQwq32b(): LLM {
	return new GroqLLM('Qwen QWQ 32b (Groq)', 'qwen-qwq-32b', 128_000, fixedCostPerMilTokens(0.29, 0.39));
}

export function groqQwen_32b_R1_Distill(): LLM {
	return new GroqLLM('Qwen 32b R1 Distill (Groq)', 'deepseek-r1-distill-qwen-32b', 128_000, fixedCostPerMilTokens(0.59, 0.79));
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
