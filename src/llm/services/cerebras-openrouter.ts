import { EmbeddingModelV2, ImageModelV2, LanguageModelV2 } from '@ai-sdk/provider';
import { OpenRouterProvider, createOpenRouter } from '@openrouter/ai-sdk-provider';
import { costPerMilTokens } from '#llm/base-llm';
import type { GenerateTextOptions, LLM, LlmCostFunction } from '#shared/llm/llm.model';
import { currentUser } from '#user/userContext';
import { AiLLM } from './ai-llm';

export const CEREBRAS_OPENROUTER_SERVICE = 'cerebras-openrouter';

export function openrouterLLMRegistry(): Record<string, () => LLM> {
	return {
		'cerebras-openrouter:qwen/qwen3-235b-a22b-thinking-2507': () => openRouterQwen3_235b_Thinking(),
		'cerebras-openrouter:qwen/qwen/qwen3-235b-a22b-2507': () => openRouterQwen3_235b_Instruct(),
	};
}

// https://openrouter.ai/models

export function openRouterQwen3_235b_Thinking(): LLM {
	return new OpenRouterLLM('Qwen3 235b Thinking (Cerebras)', 'qwen/qwen3-235b-a22b-thinking-2507', 131_000, costPerMilTokens(0.6, 1.2), {});
}

export function openRouterQwen3_235b_Instruct(): LLM {
	return new OpenRouterLLM('Qwen3 235b Instruct (Cerebras)', 'qwen/qwen3-235b-a22b-2507', 131_000, costPerMilTokens(0.6, 1.2), {});
}

declare module '@openrouter/ai-sdk-provider' {
	interface OpenRouterProvider {
		languageModel(modelId: string): LanguageModelV2;
		/**
		  Returns the text embedding model with the given id.
		  The model id is then passed to the provider function to get the model.
		  
		  @param {string} modelId - The id of the model to return.
		  
		  @returns {LanguageModel} The language model associated with the id
		  
		  @throws {NoSuchModelError} If no such model exists.
		*/
		textEmbeddingModel(modelId: string): EmbeddingModelV2<string>;
		/**
		  Returns the image model with the given id.
		  The model id is then passed to the provider function to get the model.
		  
		  @param {string} modelId - The id of the model to return.
		  
		  @returns {ImageModel} The image model associated with the id
		*/
		imageModel(modelId: string): ImageModelV2;
	}
}

/**
 * https://inference-docs.openrouter.ai/introduction
 * Next release of OpenRouter provider should work instead of using OpenAIProvider
 */
export class OpenRouterLLM extends AiLLM<OpenRouterProvider> {
	constructor(displayName: string, model: string, maxInputTokens: number, calculateCosts: LlmCostFunction, defaultOptions?: GenerateTextOptions) {
		super({ displayName, service: CEREBRAS_OPENROUTER_SERVICE, modelId: model, maxInputTokens, calculateCosts, oldIds: [], defaultOptions });
	}

	protected provider(): OpenRouterProvider {
		return createOpenRouter({
			apiKey: this.apiKey(),
			headers: {
				'HTTP-Referer': 'https://typedai.dev', // Optional. Site URL for rankings on openrouter.ai.
				'X-Title': 'TypedAI', // Optional. Site title for rankings on
			},
			extraBody: {
				provider: {
					only: ['Cerebras'],
				},
			},
		});
	}

	protected apiKey(): string | undefined {
		return currentUser()?.llmConfig.openrouterKey || process.env.OPENROUTER_API_KEY;
	}
}
