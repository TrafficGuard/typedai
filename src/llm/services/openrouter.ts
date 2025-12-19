import { EmbeddingModelV2, ImageModelV2, LanguageModelV2 } from '@ai-sdk/provider';
import { OpenRouterProvider, createOpenRouter } from '@openrouter/ai-sdk-provider';
import { costPerMilTokens } from '#llm/base-llm';
import type { GenerateTextOptions, LLM, LlmCostFunction } from '#shared/llm/llm.model';
import { currentUser } from '#user/userContext';
import { AiLLM } from './ai-llm';

export const OPENROUTER_SERVICE = 'openrouter';

export function openrouterLLMRegistry(): Record<string, () => LLM> {
	return {
		'openrouter:morph/morph-v3-fast': () => openRouterMorph(),
	};
}

// https://openrouter.ai/models

export function openRouterMorph(): LLM {
	return new OpenRouterLLM('Morph', 'morph/morph-v3-fast', 81_000, costPerMilTokens(0.8, 1.2), {});
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
 * Note: OpenRouterProvider doesn't fully implement ProviderV3, so we use 'any' for the generic parameter
 */
export class OpenRouterLLM extends AiLLM<any> {
	constructor(displayName: string, model: string, maxInputTokens: number, calculateCosts: LlmCostFunction, defaultOptions?: GenerateTextOptions) {
		super({ displayName, service: OPENROUTER_SERVICE, modelId: model, maxInputTokens, calculateCosts, oldIds: [], defaultOptions });
	}

	protected provider(): OpenRouterProvider {
		return createOpenRouter({
			apiKey: this.apiKey(),
			headers: {
				'HTTP-Referer': 'https://typedai.dev', // Optional. Site URL for rankings on openrouter.ai.
				'X-Title': 'TypedAI', // Optional. Site title for rankings on
			},
		});
	}

	protected apiKey(): string | undefined {
		return currentUser()?.llmConfig.openrouterKey || process.env.OPENROUTER_API_KEY;
	}
}
