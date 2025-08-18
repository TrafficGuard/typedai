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
		// console.log(`OpenAI input: ${inputTokens} cached: ${cachedPromptTokens}`);
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

export function openaiGPT5flex(): LLM {
	return new OpenAI('GPT5 (flex)', 'gpt-5', openAICostFunction(0.625, 5), 200_000, [], 'flex');
}

export function openaiGPT5priority(): LLM {
	return new OpenAI('GPT5 (priority)', 'gpt-5', openAICostFunction(2.5, 205), 200_000, [], 'priority');
}

export function openaiGPT5(): LLM {
	return new OpenAI('GPT5', 'gpt-5', openAICostFunction(1.25, 10), 200_000, ['o3', 'gpt-4.1']);
}

export function openaiGPT5miniFlex(): LLM {
	return new OpenAI('GPT5 mini (flex)', 'gpt-5-mini', openAICostFunction(0.125, 1), 200_000, [], 'flex');
}

export function openaiGPT5mini(): LLM {
	return new OpenAI('GPT5 mini', 'gpt-5-mini', openAICostFunction(0.25, 2), 200_000, ['gpt-4.1-mini', 'o3-mini', 'o4-mini']);
}

export function openaiGPT5nano(): LLM {
	return new OpenAI('GPT5 nano', 'gpt-5-nano', openAICostFunction(0.05, 0.4), 200_000, ['gpt-4.1-nano', 'o3-nano', 'o4-mini']);
}

export function openaiGPT5chat(): LLM {
	return new OpenAI('GPT5 chat', 'gpt-5-chat', openAICostFunction(1.25, 10), 200_000, ['gpt-4.1']);
}

const OPENAI_KEYS: string[] = [];
if (process.env.OPENAI_API_KEY) OPENAI_KEYS.push(process.env.OPENAI_API_KEY);
for (let i = 2; i <= 9; i++) {
	const key = process.env[`OPENAI_API_KEY_${i}`];
	if (key) OPENAI_KEYS.push(key);
	else break;
}
let openaiKeyIndex = 0;

export class OpenAI extends AiLLM<OpenAIProvider> {
	constructor(
		displayName: string,
		model: string,
		calculateCosts: LlmCostFunction,
		maxContext: number,
		oldIds?: string[],
		serviceTier?: 'auto' | 'flex' | 'priority',
	) {
		super(
			displayName,
			OPENAI_SERVICE,
			model,
			maxContext,
			calculateCosts,
			oldIds,
			serviceTier
				? {
						providerOptions: {
							openai: {
								serviceTier,
							},
						},
					}
				: undefined,
		);
	}

	protected apiKey(): string {
		let envKey: string;
		if (OPENAI_KEYS.length) {
			envKey = OPENAI_KEYS[openaiKeyIndex];
			if (++openaiKeyIndex > OPENAI_KEYS.length) openaiKeyIndex = 0;
		}
		return currentUser()?.llmConfig.openaiKey || envKey;
	}

	provider(): OpenAIProvider {
		this.aiProvider ??= createOpenAI({
			apiKey: this.apiKey(),
		});
		return this.aiProvider;
	}

	async generateMessage(llmMessages: LlmMessage[], opts?: GenerateTextOptions): Promise<LlmMessage> {
		console.log('Defaulting temp to 1');
		opts ??= {};
		opts.temperature = 1;
		return super.generateMessage(llmMessages, opts);
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
