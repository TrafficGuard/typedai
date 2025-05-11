import { type OpenAIProvider, createOpenAI } from '@ai-sdk/openai';
import type { LlmCostFunction } from '#llm/base-llm';
import { AiLLM } from '#llm/services/ai-llm';
import type { GenerateTextOptions, LLM, LlmMessage } from '#shared/model/llm.model';
import { currentUser } from '#user/userContext';

export const OPENAI_SERVICE = 'openai';

export function openAiLLMRegistry(): Record<string, () => LLM> {
	return {
		'openai:gpt-4o': () => GPT4o(),
		'openai:gpt-4o-mini': () => GPT4oMini(),
		'openai:o1-preview': () => openAIo1Preview(),
		'openai:o1': () => openAIo1(),
		'openai:o1-mini': () => openAIo1mini(),
		'openai:o3-mini': () => openAIo3mini(),
	};
}

// https://sdk.vercel.ai/providers/ai-sdk-providers/openai#prompt-caching
function openAICostFunction(inputMil: number, outputMil: number): LlmCostFunction {
	return (inputTokens: number, outputTokens: number, usage: any) => {
		const metadata = usage as { openai?: { cachedPromptTokens?: number } };
		const cachedPromptTokens = metadata?.openai?.cachedPromptTokens ?? 0;
		let inputCost: number;
		if (cachedPromptTokens > 0) {
			inputCost = ((inputTokens - cachedPromptTokens) * inputMil) / 1_000_000 + (cachedPromptTokens * inputMil) / 2 / 1_000_000;
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

export function openAIo1() {
	return new OpenAI('OpenAI o1', 'o1', openAICostFunction(15, 60));
}

export function openAIo1Preview() {
	return new OpenAI('OpenAI o1 preview', 'o1-preview', openAICostFunction(15, 60));
}

export function openAIo1mini() {
	return new OpenAI('OpenAI o1-mini', 'o1-mini', openAICostFunction(3, 12));
}

export function openAIo3mini() {
	return new OpenAI('OpenAI o3-mini', 'o3-mini', openAICostFunction(1.1, 4.4));
}

export function GPT4o() {
	return new OpenAI('GPT4o', 'gpt-4o', openAICostFunction(2.5, 10));
}

export function GPT4oMini() {
	return new OpenAI('GPT4o mini', 'gpt-4o-mini', openAICostFunction(0.15, 0.6));
}

export class OpenAI extends AiLLM<OpenAIProvider> {
	constructor(displayName: string, model: string, calculateCosts: LlmCostFunction) {
		super(displayName, OPENAI_SERVICE, model, 128_000, calculateCosts);
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
