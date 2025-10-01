import { randomUUID } from 'node:crypto';
import type { LanguageModelV2, ProviderV2 } from '@ai-sdk/provider';
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
import { BaseLLM, type BaseLlmConfig } from '#llm/base-llm';
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
import { quotaRetry } from '#utils/quotaRetry';

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
				binary += String.fromCharCode(content[i]!);
			}
			return btoa(binary);
		}
		// ArrayBuffer would need to be converted to Uint8Array first in a pure browser context
		if (content instanceof ArrayBuffer) {
			const uint8Array = new Uint8Array(content);
			let binary = '';
			const len = uint8Array.byteLength;
			for (let i = 0; i < len; i++) {
				binary += String.fromCharCode(uint8Array[i]!);
			}
			return btoa(binary);
		}
	}
	logger.warn('Unknown DataContent type in convertDataContentToString');
	return ''; // Should ideally not happen with proper type handling
}

export interface AiLlmConfig extends BaseLlmConfig {
	defaultOptions?: GenerateTextOptions;
}

/**
 * Base class for LLM implementations using the Vercel ai package
 */
export abstract class AiLLM<Provider extends ProviderV2> extends BaseLLM {
	protected aiProvider: Provider | undefined;
	protected defaultOptions?: GenerateTextOptions;

	constructor(cfg: AiLlmConfig) {
		super(cfg);
		this.defaultOptions = cfg.defaultOptions;
	}

	protected abstract provider(): Provider;

	protected abstract apiKey(): string | undefined;

	override isConfigured(): boolean {
		let key = this.apiKey();
		if (!key) return false;
		key = key.trim();
		const isConfigured = key.length > 0 && key !== 'undefined' && key !== 'null';
		// logger.info(`Checking if ${this.getId()} is configured ${this.apiKey()} ${isConfigured}`);
		return isConfigured;
	}

	aiModel(): LanguageModelV2 {
		return this.provider().languageModel(this.getServiceModelId());
	}

	protected override supportsGenerateTextFromMessages(): boolean {
		return true;
	}

	protected processMessages(llmMessages: LlmMessage[]): CoreMessage[] {
		return llmMessages.map((msg) => {
			const { llmId, cache, stats, providerOptions, content, ...restOfMsg } = msg;

			let processedContent: CoreContent;
			if (typeof content === 'string') {
				processedContent = content;
			} else {
				processedContent = content
					// Remove reasoning and redacted-reasoning parts
					.filter((part) => part.type !== 'reasoning' && part.type !== 'redacted-reasoning')
					.map((part) => {
						// Strip extra properties not present in CoreMessage parts
						if (part.type === 'image') {
							const extPart = part as ImagePartExt;
							return {
								type: 'image',
								image: extPart.image, // string (URL or base64) is compatible with DataContent
								mediaType: extPart.mediaType,
							} as AiImagePart;
						}
						if (part.type === 'file') {
							const extPart = part as FilePartExt;
							return {
								type: 'file',
								data: extPart.data, // AiFilePart (from 'ai') expects 'data'
								mediaType: extPart.mediaType,
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
						// Fallback for unknown parts, though ideally all are handled
						return part as any;
					}) as Exclude<CoreContent, string>;

				// If there are multiple text parts, then concatenate them as some providers don't handle multiple text parts
				const textParts = processedContent.filter((part) => part.type === 'text');
				if (textParts.length > 1) {
					const nonTextParts = processedContent.filter((part) => part.type !== 'text');
					const text = textParts.map((part) => part.text).join('\n');
					processedContent = [{ type: 'text', text }, ...nonTextParts] as CoreContent;
				}
			}
			return { ...restOfMsg, content: processedContent } as CoreMessage;
		});
	}

	@quotaRetry({ retries: 5, initialBackoffMs: 5000 })
	override async _generateMessage(llmMessages: LlmMessage[], opts?: GenerateTextOptions): Promise<LlmMessage> {
		const combinedOpts = { ...this.defaultOptions, ...opts };
		const description = combinedOpts.id ?? '';
		return await withActiveSpan(`generateTextFromMessages ${description}`, async (span) => {
			// The processMessages method now correctly returns CoreMessage[] and strips out reasoning parts
			const messages: CoreMessage[] = this.processMessages(llmMessages);

			// Gemini Flash 2.0 thinking max is about 42
			if (combinedOpts.topK && combinedOpts.topK > 40) combinedOpts.topK = 40;

			combinedOpts.providerOptions ??= {};
			const providerOptions: any = combinedOpts.providerOptions;
			if (combinedOpts.thinking) {
				// if (this.getService() === 'groq') {
				// 	providerOptions.groq = { reasoningFormat: 'parsed' };
				// }

				// https://sdk.vercel.ai/docs/guides/o3#refining-reasoning-effort
				if (this.getService() === 'openai' && (this.getModel().startsWith('o') || this.getModel().includes('gpt5')))
					providerOptions.openai = { reasoningEffort: combinedOpts.thinking };
				let thinkingBudget: number | undefined;
				// https://sdk.vercel.ai/docs/guides/sonnet-3-7#reasoning-ability
				// https://docs.anthropic.com/en/docs/build-with-claude/extended-thinking
				if (this.getModel().includes('claude-3-7') || this.getModel().includes('opus-4') || this.getModel().includes('sonnet-4')) {
					if (combinedOpts.thinking === 'low') thinkingBudget = 1024;
					if (combinedOpts.thinking === 'medium') thinkingBudget = 6000;
					else if (combinedOpts.thinking === 'high') thinkingBudget = 13000;
					if (thinkingBudget) {
						providerOptions.anthropic = {
							thinking: { type: 'enabled', budgetTokens: thinkingBudget },
						};
					}
					// maxOutputTokens += budgetTokens;
					// Streaming is required when max_tokens is greater than 21,333
				}
				// https://cloud.google.com/vertex-ai/generative-ai/docs/thinking#budget
				else if (this.getId().includes('gemini-2.5')) {
					if (combinedOpts.thinking === 'low') thinkingBudget = 8192;
					else if (combinedOpts.thinking === 'medium') thinkingBudget = 16384;
					else if (combinedOpts.thinking === 'high') thinkingBudget = 24576;
					if (thinkingBudget) {
						providerOptions.google = {
							thinkingConfig: {
								includeThoughts: true,
								thinkingBudget,
							},
						};
					}
				}
			}

			const prompt = messages.map((m) => m.content).join('\n');
			span.setAttributes({
				inputChars: prompt.length,
				model: this.getServiceModelId(),
				configModelId: this.getModel(),
				service: this.service,
				// userId: currentUser().id,
				description,
				opts: JSON.stringify(combinedOpts),
			});

			if (!combinedOpts.id) {
				const lastMessage = llmMessages[llmMessages.length - 1]!;
				const lastMessageText = messageText(lastMessage);
				const promptPreview = lastMessageText.length > 50 ? `${lastMessageText.slice(0, 50)}...` : lastMessageText;
				console.log(new Error(`No generateMessage id provided. (${promptPreview})`));
			}
			// logger.info(`LLM call ${combinedOpts.id} using ${this.getId()}`);

			const createLlmCallRequest: CreateLlmRequest = {
				messages: cloneAndTruncateBuffers(llmMessages),
				llmId: this.getId(),
				agentId: agentContext()?.agentId,
				// userId: currentUser().id,
				callStack: callStack(),
				description,
				settings: combinedOpts,
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

			console.log(providerOptions);

			const requestTime = Date.now();
			try {
				const result: GenerateTextResult<any, any> = await aiGenerateText({
					model: this.aiModel(),
					messages,
					temperature: combinedOpts.temperature,
					// topP: combinedOpts.topP, Claude models fail with `temperature` and `top_p` cannot both be specified for this model. Please use only one.
					topK: combinedOpts.topK,
					// Not supported by Grok4
					// frequencyPenalty: combinedOpts.frequencyPenalty,
					// presencePenalty: combinedOpts.presencePenalty,
					stopSequences: combinedOpts.stopSequences,
					maxRetries: combinedOpts.maxRetries,
					maxOutputTokens: combinedOpts.maxOutputTokens,
					providerOptions,
				});

				const responseText = result.text;
				const finishTime = Date.now();

				const { inputCost, outputCost, totalCost } = this.calculateCosts(
					result.usage.inputTokens ?? 0,
					result.usage.outputTokens ?? 0,
					result.usage.cachedInputTokens ?? 0,
					result.usage,
				);
				const cost = Number.isNaN(totalCost) ? 0 : totalCost;

				if (result.finishReason === 'length') {
					logger.info(
						{ opts: combinedOpts },
						`LLM finished due to length. ${this.getId()} Output tokens: ${result.usage.outputTokens}. Opts Max Output Tokens: ${combinedOpts.maxOutputTokens}. LLM CallId ${llmCall.id}`,
					);
				}

				// logger.info(`LLM response ${combinedOpts.id}`);

				// Add the response as an assistant message

				llmCall.timeToFirstToken = finishTime - requestTime;
				llmCall.totalTime = finishTime - requestTime;
				llmCall.cost = cost;
				llmCall.inputTokens = result.usage.inputTokens;
				llmCall.outputTokens = result.usage.outputTokens;

				addCost(cost);

				const stats: GenerationStats = {
					llmId: this.getId(),
					cost,
					inputTokens: result.usage.inputTokens ?? 0,
					outputTokens: result.usage.outputTokens ?? 0,
					cachedInputTokens: result.usage.cachedInputTokens,
					reasoningTokens: result.usage.reasoningTokens,
					requestTime,
					timeToFirstToken: llmCall.timeToFirstToken,
					totalTime: llmCall.totalTime,
				};

				// Convert to AssistantContentExt
				const assistantMsg = result.response.messages.find((msg) => msg.role === 'assistant');
				if (!assistantMsg) throw new Error('No assistant message found');
				const assistantContent: AssistantContentExt = [];
				if (Array.isArray(assistantMsg?.content)) {
					for (const content of assistantMsg.content) {
						if (content.type === 'text') {
							assistantContent.push({
								type: 'text',
								text: content.text.trim(),
								sources: result.sources,
							});
						} else if (content.type === 'reasoning') {
							assistantContent.push({
								type: 'reasoning',
								text: content.text.trim(),
							});
						} else if (content.type === 'tool-call') {
							assistantContent.push({
								type: 'tool-call',
								toolCallId: content.toolCallId,
								toolName: content.toolName,
								input: content.input,
							});
						}
						// else if(content.type === 'file') {
						// 	assistantContent.push({
						// 		type: 'image',
						// 		url: content.url,
						// 	})
						// }
					}
				} else {
					assistantContent.push({
						type: 'text',
						text: assistantMsg.content,
					});
				}

				const message: LlmMessage = {
					role: 'assistant',
					content: assistantContent,
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
	override async streamText(
		llmMessages: LlmMessage[],
		onChunkCallback: (chunk: TextStreamPart<any>) => void,
		opts?: GenerateTextOptions,
	): Promise<GenerationStats> {
		const combinedOpts = { ...this.defaultOptions, ...opts };
		return withActiveSpan(`streamText ${combinedOpts?.id ?? ''}`, async (span) => {
			// The processMessages method now correctly returns CoreMessage[]
			const messages: CoreMessage[] = this.processMessages(llmMessages);

			const prompt = messages.map((m) => (typeof m.content === 'string' ? m.content : m.content.map((p) => ('text' in p ? p.text : '')).join(''))).join('\n');
			span.setAttributes({
				inputChars: prompt.length,
				model: this.getServiceModelId(),
				configModelId: this.getModel(),
				service: this.service,
			});

			const llmCallSave: Promise<LlmCall> = appContext().llmCallService.saveRequest({
				messages: llmMessages,
				llmId: this.getId(),
				agentId: agentContext()?.agentId,
				callStack: callStack(),
				settings: combinedOpts,
			});

			const requestTime = Date.now();

			const firstTokenTime = 0;

			const result = aiStreamText({
				model: this.aiModel(),
				messages,
				temperature: combinedOpts?.temperature,
				// topP: combinedOpts?.topP, // anthropic '`temperature` and `top_p` cannot both be specified for this model. Please use only one.'
				stopSequences: combinedOpts?.stopSequences,
				experimental_transform: smoothStream(),
			});

			for await (const part of result.fullStream) {
				onChunkCallback(part);
			}

			const [usage, finishReason, metadata, response] = await Promise.all([result.usage, result.finishReason, result.providerMetadata, result.response]);
			const finish = Date.now();
			const { inputCost, outputCost, totalCost } = this.calculateCosts(usage.inputTokens ?? 0, usage.outputTokens ?? 0, usage.cachedInputTokens ?? 0);

			addCost(totalCost);

			const llmCall: LlmCall = await llmCallSave;

			const stats: GenerationStats = {
				llmId: this.getId(),
				cost: totalCost,
				inputTokens: usage.inputTokens ?? 0,
				outputTokens: usage.outputTokens ?? 0,
				totalTime: finish - requestTime,
				timeToFirstToken: firstTokenTime - requestTime,
				requestTime,
			};

			// messages =
			const responseMessage = response.messages[0]!;
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
							mediaType: aiImagePart.mediaType,
						} as ImagePartExt;
					}
					if (part.type === 'file') {
						const aiFilePart = part as AiFilePart; // ai.FilePart
						return {
							type: 'file',
							data: convertDataContentToString(aiFilePart.data), // Our FilePartExt uses 'data', ai.FilePart has 'data'
							mediaType: aiFilePart.mediaType,
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
				inputTokens: usage.inputTokens,
				outputTokens: usage.outputTokens,
				inputCost,
				outputCost,
				totalCost,
			});

			try {
				await appContext().llmCallService.saveResponse(llmCall);
			} catch (e) {
				logger.error(e);
			}

			if (finishReason !== 'stop') throw new Error(`Unexpected finish reason: ${finishReason}`);

			return stats;
		});
	}
}
