import { type OpenAIProvider, createOpenAI } from '@ai-sdk/openai';
import { AiLLM } from '#llm/services/ai-llm';
import { createEnvKeyRotator } from '#llm/services/key-rotation';
import type { GenerateTextOptions, LLM, LlmCostFunction, LlmMessage } from '#shared/llm/llm.model';
import { currentUser } from '#user/userContext';

export const OPENAI_SERVICE = 'openai';

export function openAiLLMRegistry(): Array<() => LLM> {
	return [openaiGPT5, openaiGPT5mini, openaiGPT5nano, openaiGPT5codex, openaiGPT5pro];
}

// https://sdk.vercel.ai/providers/ai-sdk-providers/openai#prompt-caching
// TODO replace with costPerMilTokens in base-llm.ts
function costPerMilTokens(inputMil: number, outputMil: number): LlmCostFunction {
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

// pricing, max input/output token etc at https://platform.openai.com/docs/models/compare

export function openaiGPT5flex(): LLM {
	return openaiGPT5('flex');
}

export function openaiGPT5priority(): LLM {
	return openaiGPT5('priority');
}

export function openaiGPT5(serviceTier?: 'auto' | 'flex' | 'priority'): LLM {
	return new OpenAI('GPT5', 'gpt-5', 'gpt-5', costPerMilTokens(1.25, 10), 200_000, 128_000, ['o3', 'gpt-4.1'], serviceTier);
}

export function openaiGPT5miniFlex(): LLM {
	return openaiGPT5mini('flex');
}

export function openaiGPT5mini(serviceTier?: 'auto' | 'flex' | 'priority'): LLM {
	return new OpenAI('GPT5 mini', 'gpt-5-mini', 'gpt-5-mini', costPerMilTokens(0.25, 2), 400_000, 128_000, ['gpt-4.1-mini', 'o3-mini', 'o4-mini'], serviceTier);
}

export function openaiGPT5nano(serviceTier?: 'auto' | 'flex' | 'priority'): LLM {
	return new OpenAI(
		'GPT5 nano',
		'gpt-5-nano',
		'gpt-5-nano',
		costPerMilTokens(0.05, 0.4),
		400_000,
		128_000,
		['gpt-4.1-nano', 'o3-nano', 'o4-mini'],
		serviceTier,
	);
}

export function openaiGPT5codex(): LLM {
	return new OpenAI('GPT5 codex', 'gpt-5-codex', 'gpt-5-codex', costPerMilTokens(1.25, 10), 400_000, 128_000);
}

export function openaiGPT5pro(): LLM {
	return new OpenAI('GPT5 pro', 'gpt-5-pro', 'gpt-5-pro', costPerMilTokens(15, 120), 400_000, 272_000);
}

// export function openaiGPT5chat(): LLM {
// 	return new OpenAI('GPT5 chat', 'gpt-5-chat', 'gpt-5-chat', costPerMilTokens(1.25, 10), 128_000, 16_384, ['gpt-4.1']);
// }

const openaiKeyRotator = createEnvKeyRotator('OPENAI_API_KEY');

export class OpenAI extends AiLLM<OpenAIProvider> {
	constructor(
		displayName: string,
		model: string,
		serviceModelId: string,
		calculateCosts: LlmCostFunction,
		maxInputTokens: number,
		maxOutputTokens: number,
		oldIds?: string[],
		serviceTier?: 'auto' | 'flex' | 'priority',
	) {
		super({
			displayName,
			service: OPENAI_SERVICE,
			modelId: model,
			serviceModelId: serviceModelId,
			maxInputTokens,
			calculateCosts,
			oldIds,
			defaultOptions: serviceTier
				? {
						providerOptions: {
							openai: {
								serviceTier,
							},
						},
					}
				: undefined,
		});
	}

	protected override apiKey(): string | undefined {
		return currentUser()?.llmConfig.openaiKey?.trim() || openaiKeyRotator.next();
	}

	override provider(): OpenAIProvider {
		this.aiProvider ??= createOpenAI({ apiKey: this.apiKey()! });
		return this.aiProvider;
	}

	override async generateMessage(llmMessages: LlmMessage[], opts?: GenerateTextOptions): Promise<LlmMessage> {
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
