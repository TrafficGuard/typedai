import Anthropic from '@anthropic-ai/sdk';
import { AnthropicVertex } from '@anthropic-ai/vertex-sdk';
import { addCost, agentContext } from '#agent/agentContextLocalStorage';
import { AgentLLMs } from '#agent/agentContextTypes';
import { LlmCall } from '#llm/llmCallService/llmCall';
import { logger } from '#o11y/logger';
import { withActiveSpan } from '#o11y/trace';
import { currentUser } from '#user/userService/userContext';
import { envVar } from '#utils/env-var';
import { appContext } from '../../applicationContext';
import { RetryableError, cacheRetry } from '../../cache/cacheRetry';
import { BaseLLM, InputCostFunction, perMilTokens } from '../base-llm';
import { MaxTokensError } from '../errors';
import { GenerateTextOptions, GenerationStats, LLM, LlmMessage } from '../llm';

type Message = Anthropic.Messages.Message;
type MessageParam = Anthropic.Messages.MessageParam;
type TextBlock = Anthropic.Messages.TextBlock;
type TextBlockParam = Anthropic.Messages.TextBlockParam;
type ImageBlockParam = Anthropic.Messages.ImageBlockParam;
type BetaBase64PDFBlock = Anthropic.Beta.BetaBase64PDFBlock;

export const ANTHROPIC_VERTEX_SERVICE = 'anthropic-vertex';

// https://cloud.google.com/vertex-ai/generative-ai/docs/partner-models/use-claude#anthropic_claude_region_availability

export function anthropicVertexLLMRegistry(): Record<string, () => LLM> {
	return {
		[`${ANTHROPIC_VERTEX_SERVICE}:claude-3-5-haiku`]: Claude3_5_Haiku_Vertex,
		[`${ANTHROPIC_VERTEX_SERVICE}:claude-3-5-sonnet`]: Claude3_5_Sonnet_Vertex,
		[`${ANTHROPIC_VERTEX_SERVICE}:claude-3-7-sonnet`]: Claude3_7_Sonnet_Vertex,
	};
}

// Supported image types image/jpeg', 'image/png', 'image/gif' or 'image/webp'
export function Claude3_5_Sonnet_Vertex() {
	return new AnthropicVertexLLM('Claude 3.5 Sonnet (Vertex)', 'claude-3-5-sonnet-v2@20241022', 3, 15);
}

export function Claude3_7_Sonnet_Vertex() {
	return new AnthropicVertexLLM('Claude 3.7 Sonnet (Vertex)', 'claude-3-7-sonnet@20250219', 3, 15);
}

export function Claude3_5_Haiku_Vertex() {
	return new AnthropicVertexLLM('Claude 3.5 Haiku (Vertex)', 'claude-3-5-haiku@20241022', 1, 5);
}

function inputCostFunction(dollarsPerMillionTokens: number): InputCostFunction {
	return (input: string, tokens: number, usage: any) =>
		(tokens * dollarsPerMillionTokens) / 1_000_000 +
		(usage.cache_creation_input_tokens * dollarsPerMillionTokens * 1.25) / 1_000_000 +
		(usage.cache_read_input_tokens * dollarsPerMillionTokens * 0.1) / 1_000_000;
}

export function ClaudeVertexLLMs(): AgentLLMs {
	const hard = Claude3_5_Sonnet_Vertex();
	return {
		easy: Claude3_5_Haiku_Vertex(),
		medium: hard,
		hard: hard,
		xhard: hard,
	};
}

/**
 * Anthropic Claude 3 through Google Cloud Vertex
 * @see https://github.com/anthropics/anthropic-sdk-typescript/tree/main/packages/vertex-sdk
 */
class AnthropicVertexLLM extends BaseLLM {
	client: AnthropicVertex | undefined;

	constructor(
		displayName: string,
		model: string,
		private inputTokensMil: number,
		private outputTokenMil: number,
	) {
		super(displayName, ANTHROPIC_VERTEX_SERVICE, model, 200_000, inputCostFunction(inputTokensMil), perMilTokens(outputTokenMil));
	}

	private api(): AnthropicVertex {
		this.client ??= new AnthropicVertex({
			projectId: currentUser().llmConfig.vertexProjectId ?? envVar('GCLOUD_PROJECT'),
			region: currentUser().llmConfig.vertexRegion || process.env.GCLOUD_CLAUDE_REGION || envVar('GCLOUD_REGION'),
		});
		return this.client;
	}

	isConfigured(): boolean {
		return Boolean(currentUser().llmConfig.vertexRegion || process.env.GCLOUD_REGION);
	}

	protected supportsGenerateTextFromMessages(): boolean {
		return true;
	}

	// Error when
	// {"error":{"code":400,"message":"Project `1234567890` is not allowed to use Publisher Model `projects/project-id/locations/us-central1/publishers/anthropic/models/claude-3-haiku@20240307`","status":"FAILED_PRECONDITION"}}

	// Error when
	// {"error":{"code":400,"message":"Project `1234567890` is not allowed to use Publisher Model `projects/project-id/locations/us-central1/publishers/anthropic/models/claude-3-haiku@20240307`","status":"FAILED_PRECONDITION"}}
	@cacheRetry({ backOffMs: 5000 })
	async _generateTextFromMessages(messages: ReadonlyArray<LlmMessage>, opts?: GenerateTextOptions): Promise<LlmMessage> {
		const description = opts?.id ?? '';
		return await withActiveSpan(`generateTextFromMessages ${description}`, async (span) => {
			let maxOutputTokens = 8192;
			// Don't mutate the messages arg array
			const localMessages = [...messages];

			const userMsg = localMessages.findLast((message) => message.role === 'user');

			span.setAttributes({
				userPrompt: userMsg.content.toString(),
				// inputChars: combinedPrompt.length,
				model: this.model,
				service: this.service,
				caller: agentContext()?.callStack.at(-1) ?? '',
				description,
			});
			if (opts?.id) span.setAttribute('id', opts.id);

			const llmCallSave: Promise<LlmCall> = appContext().llmCallService.saveRequest({
				messages: localMessages,
				llmId: this.getId(),
				userId: currentUser().id,
				agentId: agentContext()?.agentId,
				callStack: this.callStack(agentContext()),
				description,
			});

			const requestTime = Date.now();

			let generatedMessage: Message;
			let systemMessageContent: string | undefined = undefined;

			try {
				const firstMessage = localMessages[0];
				if (firstMessage?.role === 'system') {
					systemMessageContent = firstMessage.content.toString();
					localMessages.shift(); // removes first element
				}

				/*
				 The Anthropic types are
				 export interface MessageParam {
				  content: string | Array<TextBlockParam | ImageBlockParam | ToolUseBlockParam | ToolResultBlockParam>;

				  role: 'user' | 'assistant';
				}
				export interface TextBlockParam {
				  text: string;

				  type: 'text';
				}
				export interface ImageBlockParam {
				  source: ImageBlockParam.Source;

				  type: 'image';
				}

				export namespace ImageBlockParam {
				  export interface Source {
					data: string;

					media_type: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';

					type: 'base64';
				  }
				}
				 */
				const anthropicMessages: MessageParam[] = localMessages.map((message) => {
					let content: string | Array<TextBlockParam | ImageBlockParam | BetaBase64PDFBlock>;

					if (typeof message.content === 'string') {
						if (message.cache === 'ephemeral') {
							const text: TextBlockParam = {
								type: 'text',
								text: message.content,
								cache_control: {
									type: 'ephemeral',
								},
							};
							content = [text];
						} else {
							content = message.content;
						}
					} else if (Array.isArray(message.content)) {
						content = message.content.map((part: any) => {
							if (part.type === 'text') {
								const textBlock: TextBlockParam = {
									type: 'text',
									text: part.text,
								};
								if (message.cache === 'ephemeral') {
									textBlock.cache_control = {
										type: 'ephemeral',
									};
								}
								return textBlock;
							}
							if (part.type === 'image') {
								const imageBlock: ImageBlockParam = {
									type: 'image',
									source: {
										type: 'base64',
										data: part.image.toString(),
										media_type: part.mimeType || 'image/png',
									},
								};
								if (message.cache === 'ephemeral') {
									imageBlock.cache_control = {
										type: 'ephemeral',
									};
								}
								return imageBlock;
							}
							if (part.type === 'file') {
								if (part.mimeType === 'application/pdf') {
									const pdfBlock: BetaBase64PDFBlock = {
										type: 'document',
										source: {
											type: 'base64',
											media_type: 'application/pdf',
											data: part.data,
										},
									};
									if (message.cache === 'ephemeral') {
										pdfBlock.cache_control = {
											type: 'ephemeral',
										};
									}
									return pdfBlock;
								}
								throw new Error(`Unsupported file type: ${part.type}`);
							}
						});
					} else {
						content = '[No content]';
					}

					return {
						role: message.role as 'user' | 'assistant',
						content,
					};
				});
				// https://docs.anthropic.com/en/docs/build-with-claude/extended-thinking#important-considerations-when-using-extended-thinking
				// Your budget_tokens must always be less than the max_tokens specified.
				// Working with the thinking budget: The minimum budget is 1,024 tokens.
				// Streaming is required when max_tokens is greater than 21,333
				// For thinking budgets above 32K: We recommend using batch processing
				let thinking: Anthropic.Messages.ThinkingConfigEnabled | undefined = undefined;
				if (opts?.thinking && this.getModel().includes('claude-3-7')) {
					// if(console.log)opts.thinking = 'high'
					let budget = 1024; // low
					if (opts.thinking === 'medium') budget = 6000;
					if (opts.thinking === 'high') budget = 13000;
					thinking = { type: 'enabled', budget_tokens: budget };
					maxOutputTokens += thinking.budget_tokens;
				}

				generatedMessage = await this.api().messages.create({
					system: systemMessageContent,
					messages: anthropicMessages,
					model: this.model,
					max_tokens: maxOutputTokens,
					stop_sequences: opts?.stopSequences,
					thinking,
				});
			} catch (e) {
				if (this.isRetryableError(e)) {
					throw new RetryableError(e);
				}
				throw e;
			}

			// This started happening randomly!
			if (typeof generatedMessage === 'string') {
				generatedMessage = JSON.parse(generatedMessage);
			}

			const errorMessage = generatedMessage as any;
			if (errorMessage.type === 'error') {
				throw new Error(`${errorMessage.error.type} ${errorMessage.error.message}`);
			}

			if (!generatedMessage.content.length) throw new Error(`Response Message did not have any content: ${JSON.stringify(generatedMessage)}`);

			if (generatedMessage.content[0].type !== 'text' && generatedMessage.content[0].type !== 'thinking')
				throw new Error(`Message content type was not text or thinking. Was ${generatedMessage.content[0].type}`);

			let responseText = '';
			for (const content of generatedMessage.content) {
				if (content.type === 'thinking') responseText += `${content.thinking}\n`;
				if (content.type === 'text') responseText += content.text;
			}

			const finishTime = Date.now();
			const timeToFirstToken = finishTime - requestTime;

			const llmCall: LlmCall = await llmCallSave;

			const inputTokens = generatedMessage.usage.input_tokens;
			const outputTokens = generatedMessage.usage.output_tokens;
			const usage = generatedMessage.usage;

			const inputCost = this.calculateInputCost(null, inputTokens, usage);

			const outputCost = (outputTokens * this.outputTokenMil) / 1_000_000;
			const cost = inputCost + outputCost;
			addCost(cost);

			llmCall.timeToFirstToken = timeToFirstToken;
			llmCall.totalTime = finishTime - requestTime;
			llmCall.cost = cost;
			llmCall.inputTokens = inputTokens;
			llmCall.outputTokens = outputTokens;

			span.setAttributes({
				inputTokens,
				outputTokens,
				cachedInputTokens: usage.cache_read_input_tokens,
				response: responseText,
				inputCost: inputCost.toFixed(4),
				outputCost: outputCost.toFixed(4),
				cost: cost.toFixed(4),
				outputChars: responseText.length,
				callStack: this.callStack(agentContext()),
			});

			const stats: GenerationStats = {
				llmId: this.getId(),
				cost,
				inputTokens,
				outputTokens,
				requestTime,
				timeToFirstToken: llmCall.timeToFirstToken,
				totalTime: llmCall.totalTime,
			};
			const message: LlmMessage = {
				role: 'assistant',
				content: responseText,
				stats,
			};

			llmCall.messages = [...llmCall.messages, message];

			try {
				await appContext()?.llmCallService.saveResponse(llmCall);
			} catch (e) {
				// queue to save
				logger.error(e);
			}

			if (generatedMessage.stop_reason === 'max_tokens') {
				// TODO we can replay with request with the current response appended so the LLM can complete it
				logger.error('= RESPONSE exceeded max tokens ===============================');
				// logger.debug(responseText);
				throw new MaxTokensError(maxOutputTokens, responseText);
			}
			return message;
		});
	}

	isRetryableError(e: any) {
		if (e.status === 429 || e.status === 529) return true;
		if (e.error?.code === 429 || e.error?.code === 529) return true;
		return e.error?.error?.code === 429 || e.error?.error?.code === 529;
	}
}
