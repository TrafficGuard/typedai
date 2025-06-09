import { randomUUID } from 'node:crypto';
import type { LanguageModelV1, ProviderV1 } from '@ai-sdk/provider';
import {
	type FilePart as AiFilePart,
	type ImagePart as AiImagePart,
	type TextPart as AiTextPart,
	type ToolCallPart as AiToolCallPart,
	type CoreMessage,
	type GenerateTextResult,
	type TextStreamPart,
	generateText as aiGenerateText,
	streamText as aiStreamText,
	smoothStream,
} from 'ai';
import { addCost, agentContext } from '#agent/agentContextLocalStorage';
import { cloneAndTruncateBuffers } from '#agent/trimObject';
import { appContext } from '#app/applicationContext';
import { BaseLLM } from '#llm/base-llm';
import { type CreateLlmRequest, callStack } from '#llm/llmCallService/llmCall';
import { logger } from '#o11y/logger';
import { withActiveSpan } from '#o11y/trace';
import {
	type AssistantContentExt,
	type CoreContent,
	type FilePartExt,
	type GenerateTextOptions,
	type GenerationStats,
	type ImagePartExt,
	type LlmMessage,
	type ReasoningPart,
	type RedactedReasoningPart,
	type TextPartExt,
	type ToolCallPartExt,
	messageText,
	// Removed RenamedAiFilePart and RenamedAiImagePart imports from llm.model.ts
	// as AiFilePart and AiImagePart are already imported directly from 'ai' below.
} from '#shared/llm/llm.model';
import type { LlmCall } from '#shared/llmCall/llmCall.model';
import { errorToString } from '#utils/errors';

// Helper to convert DataContent | URL to string for our UI-facing models
function convertDataContentToString(content: string | URL | Uint8Array | ArrayBuffer | Buffer | undefined): string {
	if (content === undefined) return '';
	if (typeof content === 'string') return content;
	if (content instanceof URL) return content.toString();
	// Assuming Buffer is available in Node.js environment.
	// For browser, Uint8Array and ArrayBuffer might need different handling if Buffer polyfill isn't used.
	if (typeof Buffer !== 'undefined') {
		if (content instanceof Buffer) return content.toString('base64');
		if (content instanceof Uint8Array) return Buffer.from(content).toString('base64');
		if (content instanceof ArrayBuffer) return Buffer.from(content).toString('base64');
	} else {
		// Basic browser-compatible Uint8Array to base64 (simplified)
		if (content instanceof Uint8Array) {
			let binary = '';
			const len = content.byteLength;
			for (let i = 0; i < len; i++) {
				binary += String.fromCharCode(content[i]);
			}
			return btoa(binary);
		}
		// ArrayBuffer would need to be converted to Uint8Array first in a pure browser context
		if (content instanceof ArrayBuffer) {
			const uint8Array = new Uint8Array(content);
			let binary = '';
			const len = uint8Array.byteLength;
			for (let i = 0; i < len; i++) {
				binary += String.fromCharCode(uint8Array[i]);
			}
			return btoa(binary);
		}
	}
	logger.warn('Unknown DataContent type in convertDataContentToString');
	return ''; // Should ideally not happen with proper type handling
}

/**
 * Base class for LLM implementations using the Vercel ai package
 */
export abstract class AiLLM<Provider extends ProviderV1> extends BaseLLM {
	protected aiProvider: Provider | undefined;

	protected abstract provider(): Provider;

	protected abstract apiKey(): string | undefined;

	isConfigured(): boolean {
		return Boolean(this.apiKey());
	}

	aiModel(): LanguageModelV1 {
		return this.provider().languageModel(this.getModel());
	}

	protected supportsGenerateTextFromMessages(): boolean {
		return true;
	}

	protected processMessages(llmMessages: LlmMessage[]): CoreMessage[] {
		return llmMessages.map((msg) => {
			const { llmId, cache, stats, providerOptions, content, ...restOfMsg } = msg;

			let processedContent: CoreContent;
			if (typeof content === 'string') {
				processedContent = content;
			} else {
				processedContent = content.map((part) => {
					// Strip extra properties not present in CoreMessage parts
					if (part.type === 'image') {
						const extPart = part as ImagePartExt;
						return {
							type: 'image',
							image: extPart.image, // string (URL or base64) is compatible with DataContent
							mimeType: extPart.mimeType,
						} as AiImagePart;
					}
					if (part.type === 'file') {
						const extPart = part as FilePartExt;
						return {
							type: 'file',
							data: extPart.data, // AiFilePart (from 'ai') expects 'data'
							mimeType: extPart.mimeType,
						} as AiFilePart; // Use AiFilePart (alias for 'ai'.FilePart)
					}
					if (part.type === 'text') {
						const extPart = part as TextPartExt;
						return {
							type: 'text',
							text: extPart.text,
						} as AiTextPart;
					}
					if (part.type === 'tool-call') {
						return part as AiToolCallPart;
					}
					if (part.type === 'reasoning') {
						// Assuming local ReasoningPart is compatible with ai's internal one
						return part as ReasoningPart;
					}
					if (part.type === 'redacted-reasoning') {
						// Assuming local RedactedReasoningPart (now with data) is compatible
						return part as RedactedReasoningPart;
					}
					// Fallback for unknown parts, though ideally all are handled
					return part as any;
				}) as Exclude<CoreContent, string>;
			}
			return { ...restOfMsg, content: processedContent } as CoreMessage;
		});
	}

	async _generateMessage(llmMessages: LlmMessage[], opts?: GenerateTextOptions): Promise<LlmMessage> {
		const description = opts?.id ?? '';
		return await withActiveSpan(`generateTextFromMessages ${description}`, async (span) => {
			// The processMessages method now correctly returns CoreMessage[]
			const messages: CoreMessage[] = this.processMessages(llmMessages);

			// Gemini Flash 2.0 thinking max is about 42
			if (opts?.topK > 40) opts.topK = 40;

			const prompt = messages.map((m) => m.content).join('\n');
			span.setAttributes({
				inputChars: prompt.length,
				model: this.model,
				service: this.service,
				// userId: currentUser().id,
				description,
			});

			if (!opts?.id) console.log(new Error('No generateMessage id provided'));
			logger.info(`LLM call ${opts?.id} using ${this.getId()}`);

			const createLlmCallRequest: CreateLlmRequest = {
				messages: cloneAndTruncateBuffers(llmMessages),
				llmId: this.getId(),
				agentId: agentContext()?.agentId,
				// userId: currentUser().id,
				callStack: callStack(),
				description,
				settings: opts,
			};
			let llmCall: LlmCall;
			try {
				llmCall = await appContext().llmCallService.saveRequest(createLlmCallRequest);
			} catch (e) {
				llmCall = {
					...createLlmCallRequest,
					id: randomUUID(),
					requestTime: Date.now(),
				};
			}

			const requestTime = Date.now();
			try {
				const providerOptions: any = {};
				if (opts?.thinking) {
					// https://sdk.vercel.ai/docs/guides/o3#refining-reasoning-effort
					if (this.getService() === 'openai' && this.model.startsWith('o')) providerOptions.openai = { reasoningEffort: opts.thinking };
					let thinkingBudget: number;
					// https://sdk.vercel.ai/docs/guides/sonnet-3-7#reasoning-ability
					// https://docs.anthropic.com/en/docs/build-with-claude/extended-thinking
					if (this.getModel().includes('claude-3-7')) {
						if (opts.thinking === 'low') thinkingBudget = 1024;
						if (opts.thinking === 'medium') thinkingBudget = 6000;
						else if (opts.thinking === 'high') thinkingBudget = 13000;
						providerOptions.anthropic = {
							thinking: { type: 'enabled', budgetTokens: thinkingBudget },
						};
						// maxOutputTokens += budgetTokens;
						// Streaming is required when max_tokens is greater than 21,333
					}
					// https://cloud.google.com/vertex-ai/generative-ai/docs/thinking#budget
					else if (this.getId().includes('gemini-2.5-flash')) {
						if (opts.thinking === 'low') thinkingBudget = 8192;
						else if (opts.thinking === 'medium') thinkingBudget = 16384;
						else if (opts.thinking === 'high') thinkingBudget = 24576;
						providerOptions.google = {
							thinkingConfig: {
								includeThoughts: true,
								thinkingBudget,
							},
						};
					}
				}

				const result: GenerateTextResult<any, any> = await aiGenerateText({
					model: this.aiModel(),
					messages,
					temperature: opts?.temperature,
					topP: opts?.topP,
					topK: opts?.topK,
					frequencyPenalty: opts?.frequencyPenalty,
					presencePenalty: opts?.presencePenalty,
					stopSequences: opts?.stopSequences,
					maxRetries: opts?.maxRetries,
					maxTokens: opts?.maxOutputTokens,
					providerOptions,
				});

				const responseText = result.text;
				const finishTime = Date.now();

				const { inputCost, outputCost, totalCost } = this.calculateCosts(
					result.usage.promptTokens,
					result.usage.completionTokens,
					result.providerMetadata,
					result.response.timestamp,
					result,
				);
				const cost = Number.isNaN(totalCost) ? 0 : totalCost;

				logger.info(`LLM response ${opts?.id}`);

				// Add the response as an assistant message

				llmCall.timeToFirstToken = finishTime - requestTime;
				llmCall.totalTime = finishTime - requestTime;
				llmCall.cost = cost;
				llmCall.inputTokens = result.usage.promptTokens;
				llmCall.outputTokens = result.usage.completionTokens;

				addCost(cost);

				const stats: GenerationStats = {
					llmId: this.getId(),
					cost,
					inputTokens: result.usage.promptTokens,
					outputTokens: result.usage.completionTokens,
					requestTime,
					timeToFirstToken: llmCall.timeToFirstToken,
					totalTime: llmCall.totalTime,
				};
				const message: LlmMessage = {
					role: 'assistant',
					content: responseText,
					stats,
				};

				llmCall.messages = [...llmCall.messages, cloneAndTruncateBuffers(message)];

				span.setAttributes({
					inputChars: prompt.length,
					outputChars: responseText.length,
					response: responseText,
					inputCost,
					outputCost,
					cost,
				});

				try {
					await appContext().llmCallService.saveResponse(llmCall);
				} catch (e) {
					logger.warn(e, `Error saving LlmCall response ${e.message}`);
				}

				return message;
			} catch (error) {
				llmCall.error = errorToString(error);
				try {
					await appContext().llmCallService.saveResponse(llmCall);
				} catch (e) {
					logger.warn(e, `Error saving LlmCall response with error ${e.message}`);
				}

				span.recordException(error);
				throw error;
			}
		});
	}

	// https://sdk.vercel.ai/docs/ai-sdk-core/generating-text#streamtext
	async streamText(llmMessages: LlmMessage[], onChunkCallback: (chunk: TextStreamPart<any>) => void, opts?: GenerateTextOptions): Promise<GenerationStats> {
		return withActiveSpan(`streamText ${opts?.id ?? ''}`, async (span) => {
			// The processMessages method now correctly returns CoreMessage[]
			const messages: CoreMessage[] = this.processMessages(llmMessages);

			const prompt = messages.map((m) => (typeof m.content === 'string' ? m.content : m.content.map((p) => ('text' in p ? p.text : '')).join(''))).join('\n');
			span.setAttributes({
				inputChars: prompt.length,
				model: this.model,
				service: this.service,
			});

			const llmCallSave: Promise<LlmCall> = appContext().llmCallService.saveRequest({
				messages: llmMessages,
				llmId: this.getId(),
				agentId: agentContext()?.agentId,
				callStack: callStack(),
				settings: opts,
			});

			const requestTime = Date.now();

			const firstTokenTime = 0;

			console.log('streaming...');
			const result = aiStreamText({
				model: this.aiModel(),
				messages,
				temperature: opts?.temperature,
				topP: opts?.topP,
				stopSequences: opts?.stopSequences,
				experimental_transform: smoothStream(),
			});

			for await (const part of result.fullStream) {
				onChunkCallback(part);
			}

			const [usage, finishReason, metadata, response] = await Promise.all([result.usage, result.finishReason, result.providerMetadata, result.response]);
			const finish = Date.now();
			const { inputCost, outputCost, totalCost } = this.calculateCosts(usage.promptTokens, usage.completionTokens, metadata, new Date(finish));

			addCost(totalCost);

			const llmCall: LlmCall = await llmCallSave;

			const stats: GenerationStats = {
				llmId: this.getId(),
				cost: totalCost,
				inputTokens: usage.promptTokens,
				outputTokens: usage.completionTokens,
				totalTime: finish - requestTime,
				timeToFirstToken: firstTokenTime - requestTime,
				requestTime,
			};

			// messages =
			const responseMessage = response.messages[0];
			let assistantResponseMessageContent: AssistantContentExt;

			if (typeof responseMessage.content === 'string') {
				assistantResponseMessageContent = responseMessage.content;
			} else {
				// Map parts from ai.AssistantContent to AssistantContentExt
				// This needs to handle potential ReasoningPart, etc.
				assistantResponseMessageContent = responseMessage.content.map((part) => {
					// Explicitly map parts from ai.AssistantContent to AssistantContentExt
					if (part.type === 'text') {
						return part as TextPartExt;
					}
					if (part.type === 'image') {
						const aiImagePart = part as AiImagePart; // ai.ImagePart
						return {
							type: 'image',
							image: convertDataContentToString(aiImagePart.image),
							mimeType: aiImagePart.mimeType,
						} as ImagePartExt;
					}
					if (part.type === 'file') {
						const aiFilePart = part as AiFilePart; // ai.FilePart
						return {
							type: 'file',
							data: convertDataContentToString(aiFilePart.data), // Our FilePartExt uses 'data', ai.FilePart has 'data'
							mimeType: aiFilePart.mimeType,
						} as FilePartExt;
					}
					if (part.type === 'tool-call') {
						return part as ToolCallPartExt;
					}
					if (part.type === 'reasoning') {
						return part as ReasoningPart;
					}
					if (part.type === 'redacted-reasoning') {
						const aiRedactedPart = part as { type: 'redacted-reasoning'; data?: any; providerMetadata?: Record<string, unknown> }; // Cast to access potential 'data'
						return {
							type: 'redacted-reasoning',
							data: convertDataContentToString(aiRedactedPart.data), // Convert its data field
							providerMetadata: aiRedactedPart.providerMetadata,
						} as RedactedReasoningPart;
					}
					logger.warn(`Unhandled part type in streamText content conversion: ${part.type}`);
					return part as any; // Fallback, may cause issues
				});
			}

			const message: LlmMessage = {
				role: 'assistant',
				content: assistantResponseMessageContent,
				stats,
			};

			llmCall.messages = [...llmCall.messages, cloneAndTruncateBuffers(message)];

			span.setAttributes({
				inputTokens: usage.promptTokens,
				outputTokens: usage.completionTokens,
				inputCost,
				outputCost,
				totalCost,
			});

			try {
				await appContext().llmCallService.saveResponse(llmCall);
			} catch (e) {
				logger.error(e);
			}

			if (finishReason !== 'stop') throw new Error(`Unexpected finish reason ${finishReason}`);

			return stats;
		});
	}
}
