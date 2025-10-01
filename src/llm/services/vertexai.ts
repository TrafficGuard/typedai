import { type GoogleVertexProvider, createVertex } from '@ai-sdk/google-vertex';
import { HarmBlockThreshold, HarmCategory, type SafetySetting } from '@google-cloud/vertexai';
import { costPerMilTokens } from '#llm/base-llm';
import { AiLLM } from '#llm/services/ai-llm';
import { logger } from '#o11y/logger';
import { type GenerateTextOptions, type LLM, LlmCostFunction, combinePrompts } from '#shared/llm/llm.model';
import { currentUser } from '#user/userContext';
import { envVar } from '#utils/env-var';

export const VERTEX_SERVICE = 'vertex';

export function vertexLLMRegistry(): Record<string, () => LLM> {
	return {
		[`${VERTEX_SERVICE}:gemini-2.5-flash-lite`]: vertexGemini_2_5_Flash_Lite,
		[`${VERTEX_SERVICE}:gemini-2.5-pro`]: vertexGemini_2_5_Pro,
		[`${VERTEX_SERVICE}:gemini-2.5-flash`]: vertexGemini_2_5_Flash,
	};
}

// Prompts less than 200,000 tokens: $1.25/million tokens for input, $10/million for output
// Prompts more than 200,000 tokens (up to the 1,048,576 max): $2.50/million for input, $15/million for output
// https://cloud.google.com/vertex-ai/generative-ai/docs/models/gemini/2-5-pro
export function vertexGemini_2_5_Pro(): LLM {
	return new VertexLLM('Gemini 2.5 Pro', 'gemini-2.5-pro', 1_000_000, costPerMilTokens(1.25, 10, 1.25 / 4, 2.5, 15, 200_000), [
		'gemini-2.5-pro-preview-05-06',
		'gemini-2.5-pro-preview-06-05',
	]);
}

// https://cloud.google.com/vertex-ai/generative-ai/docs/models/gemini/2-5-flash
export function vertexGemini_2_5_Flash(defaultOpts?: GenerateTextOptions): LLM {
	return new VertexLLM(
		'Gemini 2.5 Flash',
		'gemini-2.5-flash-preview-09-2025',
		1_000_000,
		costPerMilTokens(0.3, 2.5),
		['gemini-2.5-flash-preview-05-20', 'gemini-2.5-flash'],
		defaultOpts,
	);
}

// https://cloud.google.com/vertex-ai/generative-ai/docs/models/gemini/2-5-flash-lite
export function vertexGemini_2_5_Flash_Lite(): LLM {
	return new VertexLLM('Gemini 2.5 Flash Lite', 'gemini-2.5-flash-lite-preview-09-2025', 1_000_000, costPerMilTokens(0.01, 0.4), [
		'gemini-2.5-flash-lite',
		'gemini-2.0-flash-lite-preview-02-05',
		'gemini-2.5-flash-lite-preview-06-17',
	]);
}

const GCLOUD_PROJECTS: string[] = [];
if (process.env.GCLOUD_PROJECT) GCLOUD_PROJECTS.push(process.env.GCLOUD_PROJECT);
for (let i = 2; i <= 9; i++) {
	const projectId = process.env[`GCLOUD_PROJECT_${i}`];
	if (!projectId) break;
	GCLOUD_PROJECTS.push(projectId);
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
		super({ displayName, service: VERTEX_SERVICE, modelId: model, maxInputTokens: maxInputToken, calculateCosts, oldIds, defaultOptions });
	}

	protected apiKey(): string | undefined {
		return currentUser()?.llmConfig.vertexProjectId || process.env.GCLOUD_PROJECT;
	}

	provider(): GoogleVertexProvider {
		let project: string | undefined;
		if (GCLOUD_PROJECTS.length) {
			project = GCLOUD_PROJECTS[gcloudProjectIndex];
			if (++gcloudProjectIndex >= GCLOUD_PROJECTS.length) gcloudProjectIndex = 0;
		} else {
			project = currentUser()?.llmConfig.vertexProjectId || project || envVar('GCLOUD_PROJECT');
		}

		// console.log(`Configuring vertex provider with ${project}`);
		let location = currentUser()?.llmConfig.vertexRegion || envVar('GCLOUD_REGION');
		// Currently a note at https://cloud.google.com/vertex-ai/generative-ai/docs/models/gemini/2-5-flash-lite states that the model is only available in global location
		if (this.getId().includes('gemini-2.5-flash')) {
			logger.info('Setting global location for flash');
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
//     let filePart: { fileData?: { fileUri: string; mediaType: string }; inlineData?: { data: string; mediaType: string } };
//     if (typeof urlOrBytes === 'string') {
//       filePart = {
//         fileData: {
//           fileUri: urlOrBytes,
//           mediaType: 'image/jpeg', // Adjust mime type if needed
//         },
//       };
//     } else if (Buffer.isBuffer(urlOrBytes)) {
//       filePart = {
//         inlineData: {
//           data: urlOrBytes.toString('base64'),
//           mediaType: 'image/jpeg', // Adjust mime type if needed
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
