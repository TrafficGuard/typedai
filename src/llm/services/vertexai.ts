import { type GoogleVertexProvider, createVertex } from '@ai-sdk/google-vertex';
import { HarmBlockThreshold, HarmCategory, type SafetySetting } from '@google-cloud/vertexai';
import { type GenerateTextResult, LanguageModelResponseMetadata } from 'ai';
import axios from 'axios';
import { fixedCostPerMilTokens } from '#llm/base-llm';
import { AiLLM } from '#llm/services/ai-llm';
import { countTokens, countTokensSync } from '#llm/tokens';
import { logger } from '#o11y/logger';
import { type GenerateTextOptions, type LLM, LlmCostFunction, combinePrompts } from '#shared/llm/llm.model';
import { currentUser } from '#user/userContext';
import { envVar } from '#utils/env-var';

export const VERTEX_SERVICE = 'vertex';

export function vertexLLMRegistry(): Record<string, () => LLM> {
	return {
		[`${VERTEX_SERVICE}:gemini-2.0-flash-lite`]: vertexGemini_2_0_Flash_Lite,
		[`${VERTEX_SERVICE}:gemini-2.5-flash-lite`]: vertexGemini_2_5_Flash_Lite,
		[`${VERTEX_SERVICE}:gemini-2.5-pro`]: vertexGemini_2_5_Pro,
		[`${VERTEX_SERVICE}:gemini-2.5-flash`]: vertexGemini_2_5_Flash,
	};
}

// https://cloud.google.com/vertex-ai/generative-ai/pricing#token-based-pricing

// https://cloud.google.com/vertex-ai/generative-ai/pricing#token-based-pricing
// If a query input context is longer than 200K tokens, all tokens (input and output) are charged at long context rates.
export function gemini2_5_Pro_CostFunction(
	inputMilLow: number,
	outputMilLow: number,
	inputMilHigh?: number,
	outputMilHigh?: number,
	threshold = 200000,
): LlmCostFunction {
	return (inputTokens: number, outputTokens: number, usage, completionTime, result) => {
		let inputMil = inputMilLow;
		let outputMil = outputMilLow;
		if (inputMilHigh && outputMilHigh && inputTokens >= threshold) {
			inputMil = inputMilHigh;
			outputMil = outputMilHigh;
		}

		// const isThinking = result.reasoning?.length > 0 || result.reasoningDetails?.length > 0;
		// if(isThinking) {
		// 	outputTokens += countTokensSync(result.reasoning);
		// }
		// if(Array.isArray(responseMessage.content)) {
		// 	for(const part of responseMessage.content) {
		// 		if(part.type === 'reasoning') {
		// 			console.log('REASONING ===== ' + (countTokensSync(part.text)) + '  tokens')
		// 			console.log(part.text)
		// 		} else if(part.type === 'text') {
		// 			console.log('TEXT ======== ' + (countTokensSync(part.text)) + '  tokens')
		// 			console.log(part.text)
		// 		}
		// 	}
		// }
		// if(result.reasoningDetails?.length) {
		// 	const reasoning = result.reasoningDetails[0];
		// 	if(reasoning.type === 'text') {
		// 		console.log('REASONING')
		// 		console.log(result.text + '\n');
		// 		outputTokens += countTokensSync(reasoning.text)
		// 	}
		// }

		const inputCost = (inputTokens * inputMil) / 1_000_000;
		const outputCost = (outputTokens * outputMil) / 1_000_000;
		return {
			inputCost,
			outputCost,
			totalCost: inputCost + outputCost,
		};
	};
}

// Prompts less than 200,000 tokens: $1.25/million tokens for input, $10/million for output
// Prompts more than 200,000 tokens (up to the 1,048,576 max): $2.50/million for input, $15/million for output
// https://cloud.google.com/vertex-ai/generative-ai/docs/models/gemini/2-5-pro
export function vertexGemini_2_5_Pro(): LLM {
	return new VertexLLM('Gemini 2.5 Pro', 'gemini-2.5-pro', 1_000_000, gemini2_5_Pro_CostFunction(1.25, 10, 2.5, 15), [
		'gemini-2.5-pro-preview-05-06',
		'gemini-2.5-pro-preview-06-05',
	]);
}

// https://cloud.google.com/vertex-ai/generative-ai/docs/models/gemini/2-5-flash
export function vertexGemini_2_5_Flash(defaultOpts?: GenerateTextOptions): LLM {
	return new VertexLLM('Gemini 2.5 Flash', 'gemini-2.5-flash', 1_000_000, fixedCostPerMilTokens(0.3, 2.5), ['gemini-2.5-flash-preview-05-20'], defaultOpts);
}

export function vertexGemini_2_0_Flash_Lite() {
	return new VertexLLM('Gemini 2.0 Flash Lite', 'gemini-2.0-flash-lite', 1_000_000, fixedCostPerMilTokens(0.075, 0.3));
}

// https://cloud.google.com/vertex-ai/generative-ai/docs/models/gemini/2-5-flash-lite
export function vertexGemini_2_5_Flash_Lite() {
	return new VertexLLM('Gemini 2.5 Flash Lite', 'gemini-2.5-flash-lite-preview-06-17', 1_000_000, fixedCostPerMilTokens(0.01, 0.4), [
		'gemini-2.0-flash-lite-preview-02-05',
	]);
}

const GCLOUD_PROJECTS: string[] = [];

for (let i = 2; i <= 9; i++) {
	const key = process.env[`GCLOUD_PROJECT_${i}`];
	if (!key) break;
	if (i === 2) GCLOUD_PROJECTS.push(process.env.GCLOUD_PROJECT);
	GCLOUD_PROJECTS.push(key);
}
let gcloudProjectIndex = 0;

/**
 * Vertex AI models - Gemini
 */
class VertexLLM extends AiLLM<GoogleVertexProvider> {
	constructor(
		displayName: string,
		model: string,
		maxInputToken: number,
		calculateCosts: LlmCostFunction,
		oldIds?: string[],
		defaultOptions?: GenerateTextOptions,
	) {
		super(displayName, VERTEX_SERVICE, model, maxInputToken, calculateCosts, oldIds, defaultOptions);
	}

	protected apiKey(): string {
		return currentUser()?.llmConfig.vertexProjectId || process.env.GCLOUD_PROJECT;
	}

	provider(): GoogleVertexProvider {
		let project: string;
		if (GCLOUD_PROJECTS.length) {
			project = GCLOUD_PROJECTS[gcloudProjectIndex];
			if (++gcloudProjectIndex >= GCLOUD_PROJECTS.length) gcloudProjectIndex = 0;
		} else {
			project = currentUser().llmConfig.vertexProjectId || project || envVar('GCLOUD_PROJECT');
		}

		console.log(`Configuring vertex provider with ${project}`);
		let location = currentUser().llmConfig.vertexRegion || envVar('GCLOUD_REGION');
		// Currently a note at https://cloud.google.com/vertex-ai/generative-ai/docs/models/gemini/2-5-flash-lite states that the model is only available in global location
		if (this.getId().includes('gemini-2.5-flash-lite')) {
			logger.info('Setting global location for flash-lite');
			location = 'global';
		}
		this.aiProvider ??= createVertex({
			project: project,
			location: location,
		});

		return this.aiProvider;
	}
}

const SAFETY_SETTINGS: SafetySetting[] = [
	{
		category: HarmCategory.HARM_CATEGORY_HATE_SPEECH,
		threshold: HarmBlockThreshold.BLOCK_NONE,
	},
	{
		category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
		threshold: HarmBlockThreshold.BLOCK_NONE,
	},
	{
		category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
		threshold: HarmBlockThreshold.BLOCK_NONE,
	},
	{
		category: HarmCategory.HARM_CATEGORY_HARASSMENT,
		threshold: HarmBlockThreshold.BLOCK_NONE,
	},
];

// async imageToText(urlOrBytes: string | Buffer): Promise<string> {
//   return withActiveSpan('imageToText', async (span) => {
//     const generativeVisionModel = this.vertex().getGenerativeModel({
//       model: this.imageToTextModel,
//     }) as GenerativeModel;
//
//     let filePart: { fileData?: { fileUri: string; mimeType: string }; inlineData?: { data: string; mimeType: string } };
//     if (typeof urlOrBytes === 'string') {
//       filePart = {
//         fileData: {
//           fileUri: urlOrBytes,
//           mimeType: 'image/jpeg', // Adjust mime type if needed
//         },
//       };
//     } else if (Buffer.isBuffer(urlOrBytes)) {
//       filePart = {
//         inlineData: {
//           data: urlOrBytes.toString('base64'),
//           mimeType: 'image/jpeg', // Adjust mime type if needed
//         },
//       };
//     } else {
//       throw new Error('Invalid input: must be a URL string or a Buffer');
//     }
//
//     const textPart = {
//       text: 'Describe the contents of this image',
//     };
//
//     const request = {
//       contents: [
//         {
//           role: 'user',
//           parts: [filePart, textPart],
//         },
//       ],
//     };
//
//     try {
//       const response = await generativeVisionModel.generateContent(request);
//       const fullTextResponse = response.response.candidates[0].content.parts[0].text;
//
//       span.setAttributes({
//         inputType: typeof urlOrBytes === 'string' ? 'url' : 'buffer',
//         outputLength: fullTextResponse.length,
//       });
//
//       return fullTextResponse;
//     } catch (error) {
//       logger.error('Error in imageToText:', error);
//       span.recordException(error);
//       span.setStatus({ code: SpanStatusCode.ERROR, message: error.message });
//       throw error;
//     }
//   });
// }
