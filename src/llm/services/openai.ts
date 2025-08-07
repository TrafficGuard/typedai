import { type OpenAIProvider, createOpenAI } from '@ai-sdk/openai';
import { AiLLM } from '#llm/services/ai-llm';
import type { GenerateTextOptions, LLM, LlmCostFunction, LlmMessage } from '#shared/llm/llm.model';
import { currentUser } from '#user/userContext';

export const OPENAI_SERVICE = 'openai';

export function openAiLLMRegistry(): Record<string, () => LLM> {
	return {
		'openai:gpt-5': () => openaiGPT5(),
		'openai:gpt-5-mini': () => openaiGPT5mini(),
		'openai:gpt-5-nano': () => openaiGPT5nano(),
		'openai:gpt-5-chat': () => openaiGPT5chat(),
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

function gpt5CostFunction(inputMil: number, outputMil: number): LlmCostFunction {
	return (inputTokens: number, outputTokens: number, usage: any) => {
		const metadata = usage as { openai?: { cachedPromptTokens?: number } };
		const cachedPromptTokens = metadata?.openai?.cachedPromptTokens ?? 0;
		let inputCost: number;
		if (cachedPromptTokens > 0) {
			inputCost = ((inputTokens - cachedPromptTokens) * inputMil) / 1_000_000 + (cachedPromptTokens * inputMil) / 10 / 1_000_000;
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

export function openaiGPT5(): LLM {
	return new OpenAI('GPT5', 'gpt-5', gpt5CostFunction(1.25, 10), 200_000, ['o3', 'gpt-4.1']);
}

export function openaiGPT5mini(): LLM {
	return new OpenAI('GPT5 mini', 'gpt-5-mini', gpt5CostFunction(0.25, 2), 200_000, ['gpt-4.1-mini', 'o3-mini', 'o4-mini']);
}

export function openaiGPT5nano(): LLM {
	return new OpenAI('GPT5 nano', 'gpt-5-nano', gpt5CostFunction(0.05, 0.4), 200_000, ['gpt-4.1-nano', 'o3-nano', 'o4-mini']);
}

export function openaiGPT5chat(): LLM {
	return new OpenAI('GPT5 chat', 'gpt-5-chat', gpt5CostFunction(1.25, 10), 200_000, ['gpt-4']);
}

export class OpenAI extends AiLLM<OpenAIProvider> {
	constructor(displayName: string, model: string, calculateCosts: LlmCostFunction, maxContext: number, oldIds?: string[]) {
		super(displayName, OPENAI_SERVICE, model, maxContext, calculateCosts, oldIds);
	}

	protected apiKey(): string {
		return currentUser()?.llmConfig.openaiKey || process.env.OPENAI_API_KEY;
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
