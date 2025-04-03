import { GroqProvider, createGroq } from '@ai-sdk/groq';
import { InputCostFunction, OutputCostFunction, perMilTokens } from '#llm/base-llm';
import { AiLLM } from '#llm/services/ai-llm';
import { currentUser } from '#user/userService/userContext';
import { GenerateTextOptions, LLM, LlmMessage } from '../llm';

export const GROQ_SERVICE = 'groq';

export function groqLLMRegistry(): Record<string, () => LLM> {
	return {
		'groq:llama-3.3-70b-versatile': groqLlama3_3_70B,
		'groq:deepseek-r1-distill-llama-70b': groqLlama3_3_70B_R1_Distill,
		'groq:qwen-qwq-32b': groqQwenQwq32b,
	};
}

// Pricing and model ids at
// https://groq.com/pricing/
// https://console.groq.com/docs/models

export function groqLlama3_3_70B(): LLM {
	return new GroqLLM('Llama3.3 70b (Groq)', 'llama-3.3-70b-versatile', 131_072, perMilTokens(0.59), perMilTokens(0.79));
}

/*
DeepSeek R1 Distill Llama 70B

Up to 4k total input & output tokens
$0.75/$0.99

4k-32k tokens
$3.00/$3.00

Tokens above 32k
$5.00/$5.00
*/
export function groqLlama3_3_70B_R1_Distill(): LLM {
	return new GroqLLM('Llama3.3 70b R1 Distill (Groq)', 'deepseek-r1-distill-llama-70b', 128_000, perMilTokens(0.59), perMilTokens(0.79));
}

/**
 * Qwen QWQ 32B model from Groq
 * Pricing: $0.29/M input tokens, $0.39/M output tokens
 * https://groq.com/a-guide-to-reasoning-with-qwen-qwq-32b/
 */
export function groqQwenQwq32b(): LLM {
	return new GroqLLM('Qwen QWQ 32b (Groq)', 'qwen-qwq-32b', 128_000, perMilTokens(0.29), perMilTokens(0.39));
}

export function groqQwen_32b_R1_Distill(): LLM {
	return new GroqLLM('Qwen 32b R1 Distill (Groq)', 'deepseek-r1-distill-qwen-32b', 128_000, perMilTokens(0.59), perMilTokens(0.79));
}

/**
 * https://wow.groq.com/
 */
export class GroqLLM extends AiLLM<GroqProvider> {
	constructor(displayName: string, model: string, maxTokens: number, calculateInputCost: InputCostFunction, calculateOutputCost: OutputCostFunction) {
		super(displayName, GROQ_SERVICE, model, maxTokens, calculateInputCost, calculateOutputCost);
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
			genOpts.maxTokens = 131072;
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
