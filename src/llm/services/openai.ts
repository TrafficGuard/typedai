import { type OpenAIProvider, createOpenAI } from '@ai-sdk/openai';
import { AiLLM } from '#llm/services/ai-llm';
import type { GenerateTextOptions, LLM, LlmCostFunction, LlmMessage } from '#shared/llm/llm.model';
import { currentUser } from '#user/userContext';

export const OPENAI_SERVICE = 'openai';

export function openAiLLMRegistry(): Record<string, () => LLM> {
	return {
		'openai:gpt-4.1': () => openaiGPT41(),
		'openai:gpt-4.1-mini': () => openaiGPT41mini(),
		'openai:gpt-4.1-nano': () => openaiGPT41nano(),
		'openai:o3': () => openAIo3(),
		'openai:o4-mini': () => openAIo4mini(),
	};
}

// https://sdk.vercel.ai/providers/ai-sdk-providers/openai#prompt-caching
function openAICostFunction(inputMil: number, outputMil: number): LlmCostFunction {
	return (inputTokens: number, outputTokens: number, usage: any) => {
		const metadata = usage as { openai?: { cachedPromptTokens?: number } };
		const cachedPromptTokens = metadata?.openai?.cachedPromptTokens ?? 0;
		let inputCost: number;
		if (cachedPromptTokens > 0) {
			inputCost = ((inputTokens - cachedPromptTokens) * inputMil) / 1_000_000 + (cachedPromptTokens * inputMil) / 4 / 1_000_000;
		} else {
			inputCost = (inputTokens * inputMil) / 1_000_000;
		}
		const outputCost = (outputTokens * outputMil) / 1_000_000;
		return {
			inputCost,
			outputCost,
			totalCost: inputCost + outputCost,
		};
	};
}

export function openAIo3() {
	return new OpenAI('OpenAI o3', 'o3', openAICostFunction(2, 8), 200_000);
}

export function openAIo4mini() {
	return new OpenAI('OpenAI o4-mini', 'o4-mini', openAICostFunction(1.1, 4.4), 200_000);
}

export function openaiGPT41() {
	return new OpenAI('GPT4.1', 'gpt-4.1', openAICostFunction(2, 8), 1_047_576);
}

export function openaiGPT41mini() {
	return new OpenAI('GPT4.1 mini', 'gpt-4.1-mini', openAICostFunction(0.4, 1.6), 1_047_576);
}

export function openaiGPT41nano() {
	return new OpenAI('GPT4.1 nano', 'gpt-4.1-nano', openAICostFunction(0.1, 0.4), 1_047_576);
}

export class OpenAI extends AiLLM<OpenAIProvider> {
	constructor(displayName: string, model: string, calculateCosts: LlmCostFunction, maxContext: number) {
		super(displayName, OPENAI_SERVICE, model, maxContext, calculateCosts);
	}

	protected apiKey(): string {
		return currentUser().llmConfig.openaiKey || process.env.OPENAI_API_KEY;
	}

	provider(): OpenAIProvider {
		this.aiProvider ??= createOpenAI({
			apiKey: this.apiKey(),
		});
		return this.aiProvider;
	}

	async generateTextFromMessages(llmMessages: LlmMessage[], opts?: GenerateTextOptions): Promise<string> {
		if (this.getModel().startsWith('o1-')) {
			if (opts?.stopSequences) {
				opts.stopSequences = undefined;
			}
			if (llmMessages[0].role === 'system') {
				const systemPrompt = llmMessages.shift().content;
				const userPrompt = llmMessages[0].content;
				if (typeof systemPrompt !== 'string' || typeof userPrompt !== 'string')
					throw new Error('System prompt and first user message must be only string content when using o1 models, as system prompts are not supported');
				llmMessages[0].content = `Always follow the system prompt instructions when replying:\n<system-prompt>\n${systemPrompt}\n</system-prompt>\n\n${userPrompt}`;
			}
		}

		return super.generateTextFromMessages(llmMessages, opts);
	}

	// async generateImage(description: string): Promise<string> {
	// 	const response = await this.sdk().images.generate({
	// 		model: 'dall-e-3',
	// 		prompt: description,
	// 		n: 1,
	// 		size: '1792x1024',
	// 	});
	// 	const imageUrl = response.data[0].url;
	// 	logger.info(`Generated image at ${imageUrl}`);
	// 	// await getFileSystem().writeFile('', imageUrl, 'utf8');
	// 	return imageUrl;
	// }
}
