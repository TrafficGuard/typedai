// import { GoogleGenerativeAIProvider, createGoogleGenerativeAI } from '@ai-sdk/google';
// import { InputCostFunction, OutputCostFunction, perMilTokens } from '#llm/base-llm';
// import { AiLLM } from '#llm/services/ai-llm';
// import { currentUser } from '#user/userService/userContext';
// import { envVar } from '#utils/env-var';
// import { LLM } from '../llm';
//
// export const GEMINI_SERVICE = 'gemini';
//
// export function geminiLLMRegistry(): Record<string, () => LLM> {
// 	return {
// 		[`${GEMINI_SERVICE}:gemini-2.0-flash-thinking`]: Gemini_2_0_Flash_Thinking,
// 		[`${GEMINI_SERVICE}:gemini-2.0-flash-lite`]: Gemini_2_0_Flash_Lite,
// 		[`${GEMINI_SERVICE}:gemini-2.0-flash`]: Gemini_2_0_Flash,
// 		[`${GEMINI_SERVICE}:gemini-2.5-pro`]: Gemini_2_5_Pro,
// 	};
// }
//
// export function Gemini_2_5_Pro() {
// 	return new GeminiLLM(
// 		'Gemini 2.5 Pro',
// 		'gemini-2.5-pro-exp-03-25',
// 		1_000_000,
// 		(input: string) => 0,
// 		(output: string) => 0,
// 	);
// }
//
// export function Gemini_2_0_Flash() {
// 	return new GeminiLLM('Gemini 2.0 Flash', 'gemini-2.0-flash-001', 1_000_000, perMilTokens(0.15), perMilTokens(0.6));
// }
//
// export function Gemini_2_0_Flash_Thinking() {
// 	return new GeminiLLM('Gemini 2.0 Flash Thinking Experimental', 'gemini-2.0-flash-thinking-exp-01-21', 1_000_000, perMilTokens(0.15), perMilTokens(0.6));
// }
//
// export function Gemini_2_0_Flash_Lite() {
// 	return new GeminiLLM('Gemini 2.0 Flash Lite', 'gemini-2.0-flash-lite-preview-02-05', 1_000_000, perMilTokens(0.075), perMilTokens(0.3));
// }
//
// /**
//  * Vertex AI models - Gemini
//  */
// class GeminiLLM extends AiLLM<GoogleGenerativeAIProvider> {
// 	constructor(displayName: string, model: string, maxInputToken: number, calculateInputCost: InputCostFunction, calculateOutputCost: OutputCostFunction) {
// 		super(displayName, GEMINI_SERVICE, model, maxInputToken, calculateInputCost, calculateOutputCost);
// 	}
//
// 	protected apiKey(): string {
// 		return currentUser().llmConfig.geminiKey || envVar('GEMINI_API_KEY');
// 	}
//
// 	provider(): GoogleGenerativeAIProvider {
// 		this.aiProvider ??= createGoogleGenerativeAI({
// 			apiKey: this.apiKey(),
// 			// project: currentUser().llmConfig.vertexProjectId ?? envVar('GCLOUD_PROJECT'),
// 			// location: currentUser().llmConfig.vertexRegion ?? envVar('GCLOUD_REGION'),
// 		});
//
// 		return this.aiProvider;
// 	}
// }
