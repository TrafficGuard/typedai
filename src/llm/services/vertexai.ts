import { type GoogleVertexProvider, createVertex } from '@ai-sdk/google-vertex';
import { HarmBlockThreshold, HarmCategory, type SafetySetting } from '@google-cloud/vertexai';
import { type GenerateTextResult, LanguageModelResponseMetadata } from 'ai';
import axios from 'axios';
import { type LlmCostFunction, fixedCostPerMilTokens } from '#llm/base-llm';
import { AiLLM } from '#llm/services/ai-llm';
import { currentUser } from '#user/userService/userContext';
import { envVar } from '#utils/env-var';
import { type LLM, combinePrompts } from '../llm';

export const VERTEX_SERVICE = 'vertex';

export function vertexLLMRegistry(): Record<string, () => LLM> {
	return {
		[`${VERTEX_SERVICE}:gemini-2.0-flash-lite`]: vertexGemini_2_0_Flash_Lite,
		[`${VERTEX_SERVICE}:gemini-2.0-flash`]: vertexGemini_2_0_Flash,
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
	return (inputTokens: number, outputTokens: number) => {
		let inputMil = inputMilLow;
		let outputMil = outputMilLow;
		if (inputMilHigh && outputMilHigh && inputTokens >= threshold) {
			inputMil = inputMilHigh;
			outputMil = outputMilHigh;
		}
		const inputCost = (inputTokens * inputMil) / 1_000_000;
		const outputCost = (outputTokens * outputMil) / 1_000_000;
		return {
			inputCost,
			outputCost,
			totalCost: inputCost + outputCost,
		};
	};
}

export function gemini2_5_Flash_CostFunction(inputMil: number, outputMil: number, reasoningOutputMil?: number): LlmCostFunction {
	return (inputTokens: number, outputTokens: number, usage: any, date, result: GenerateTextResult<any, any>) => {
		const isThinking = result.reasoning?.length > 0 || result.reasoningDetails?.length > 0;
		const inputCost = (inputTokens * inputMil) / 1_000_000;
		const outputCost = (outputTokens * (isThinking ? reasoningOutputMil : outputMil)) / 1_000_000;
		return {
			inputCost,
			outputCost,
			totalCost: inputCost + outputCost,
		};
	};
}

// Prompts less than 200,000 tokens: $1.25/million tokens for input, $10/million for output
// Prompts more than 200,000 tokens (up to the 1,048,576 max): $2.50/million for input, $15/million for output
export function vertexGemini_2_5_Pro(): LLM {
	return new VertexLLM('Gemini 2.5 Pro', 'gemini-2.5-pro-exp-03-25', 1_000_000, gemini2_5_Pro_CostFunction(1.25, 10, 2.5, 15));
}

export function vertexGemini_2_5_Flash(): LLM {
	return new VertexLLM('Gemini 2.5 Flash', 'gemini-2.5-flash-preview-04-17', 1_000_000, gemini2_5_Flash_CostFunction(0.15, 0.6, 3.5));
}

export function vertexGemini_2_0_Flash() {
	return new VertexLLM('Gemini 2.0 Flash', 'gemini-2.0-flash-001', 1_000_000, fixedCostPerMilTokens(0.1, 0.4));
}

export function vertexGemini_2_0_Flash_Lite() {
	return new VertexLLM('Gemini 2.0 Flash Lite', 'gemini-2.0-flash-lite', 1_000_000, fixedCostPerMilTokens(0.075, 0.3));
}

/**
 * Vertex AI models - Gemini
 */
class VertexLLM extends AiLLM<GoogleVertexProvider> {
	constructor(displayName: string, model: string, maxInputToken: number, calculateCosts: LlmCostFunction) {
		super(displayName, VERTEX_SERVICE, model, maxInputToken, calculateCosts);
	}

	protected apiKey(): string {
		return currentUser().llmConfig.vertexProjectId || process.env.GCLOUD_PROJECT;
	}

	provider(): GoogleVertexProvider {
		this.aiProvider ??= createVertex({
			// apiKey: this.apiKey(),
			project: currentUser().llmConfig.vertexProjectId ?? envVar('GCLOUD_PROJECT'),
			location: currentUser().llmConfig.vertexRegion ?? envVar('GCLOUD_REGION'),
		});

		return this.aiProvider;
	}
}

async function restCall(userPrompt: string, systemPrompt: string): Promise<string> {
	// Replace these placeholders with actual values
	const ACCESS_TOKEN = ''; // You can run `$(gcloud auth print-access-token)` manually to get this

	// Define the payload as an object

	const messages = [];
	// if(systemPrompt) messages.push({
	// 	"role": "system",
	// 	"content": systemPrompt
	// })
	// messages.push({
	// 	"role": "user",
	// 	"content": userPrompt
	// })
	messages.push({
		role: 'user',
		content: combinePrompts(userPrompt, systemPrompt),
	});

	const payload = {
		model: 'meta/llama3-405b-instruct-maas',
		stream: false,
		messages,
	};

	// Create the request configuration
	const config = {
		headers: {
			Authorization: `Bearer ${ACCESS_TOKEN}`,
			'Content-Type': 'application/json',
		},
	};

	const REGION = 'us-central1';
	const ENDPOINT = `${REGION}-aiplatform.googleapis.com`;
	const PROJECT_ID = currentUser().llmConfig.vertexProjectId ?? envVar('GCLOUD_PROJECT');
	try {
		const url = `https://${ENDPOINT}/v1beta1/projects/${PROJECT_ID}/locations/${REGION}/endpoints/openapi/chat/completions`;
		const response: any = await axios.post(url, payload, config);

		console.log(typeof response);

		// response = '{"data":' + response.substring(4) + "}"
		console.log(response.data);
		// const data = JSON.parse(response).data
		const data = response.data;
		console.log(data);
		// console.log(data.choices)
		const content = data.choices[0].delta.content;
		console.log('Response:', content);
		return content;
	} catch (error) {
		console.error('Error:', error);
		throw error;
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
