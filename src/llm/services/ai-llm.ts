import { ProviderV1 } from '@ai-sdk/provider';
import {
	AssistantMessage,
	CoreMessage,
	FinishReason,
	GenerateTextResult,
	LanguageModelUsage,
	LanguageModelV1,
	ProviderMetadata,
	StreamTextResult,
	TextStreamPart,
	generateText as aiGenerateText,
	smoothStream,
	streamText as aiStreamText,
} from 'ai';
import { addCost, agentContext } from '#agent/agentContextLocalStorage';
import { BaseLLM } from '#llm/base-llm';
import { GenerateTextOptions, GenerationStats, LlmMessage, toText } from '#llm/llm';
import { LlmCall } from '#llm/llmCallService/llmCall';
import { logger } from '#o11y/logger';
import { withActiveSpan } from '#o11y/trace';
// import { currentUser } from '#user/userService/userContext';
import { appContext } from '../../applicationContext';

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

	protected processMessages(llmMessages: LlmMessage[]): LlmMessage[] {
		return llmMessages;
	}

	async generateTextFromMessages(llmMessages: LlmMessage[], opts?: GenerateTextOptions): Promise<string> {
		const msg = await this.generateMessage(llmMessages, opts);
		return toText(msg);
	}

	async _generateMessage(llmMessages: LlmMessage[], opts?: GenerateTextOptions): Promise<LlmMessage> {
		const description = opts?.id ?? '';
		return withActiveSpan(`generateTextFromMessages ${description}`, async (span) => {
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

			const llmCallSave: Promise<LlmCall> = appContext().llmCallService.saveRequest({
				messages: llmMessages,
				llmId: this.getId(),
				agentId: agentContext()?.agentId,
				// userId: currentUser().id,
				callStack: this.callStack(agentContext()),
				description,
			});

			const requestTime = Date.now();
			try {
				const providerOptions: any = {};
				// https://sdk.vercel.ai/docs/guides/sonnet-3-7#reasoning-ability
				// https://sdk.vercel.ai/docs/guides/o3#refining-reasoning-effort
				if (opts?.thinking) {
					if (this.getService() === 'openai' && this.model.startsWith('o')) providerOptions.openai = { reasoningEffort: opts.thinking };

					if (this.getModel().includes('claude-3-7')) {
						let budgetTokens = 1024; // low
						if (opts.thinking === 'medium') budgetTokens = 6000;
						if (opts.thinking === 'high') budgetTokens = 13000;
						providerOptions.anthropic = {
							thinking: { type: 'enabled', budgetTokens },
						};
						// maxOutputTokens += budgetTokens;
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
					maxTokens: opts?.maxTokens,
					providerOptions,
				});

				result.response.messages;
				const responseText = result.text;
				const finishTime = Date.now();
				const llmCall: LlmCall = await llmCallSave;

				const inputCost = this.calculateInputCost('', result.usage.promptTokens, result.providerMetadata, result.response.timestamp);
				const outputCost = this.calculateOutputCost(responseText, result.usage.completionTokens, result.response.timestamp);
				const cost = inputCost + outputCost;

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

				llmCall.messages = [...llmCall.messages, message];

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
					logger.error(e);
				}

				return message;
			} catch (error) {
				span.recordException(error);
				throw error;
			}
		});
	}

	async streamText(llmMessages: LlmMessage[], onChunkCallback: (chunk: TextStreamPart<any>) => void, opts?: GenerateTextOptions): Promise<GenerationStats> {
		return withActiveSpan(`streamText ${opts?.id ?? ''}`, async (span) => {
			const messages: CoreMessage[] = llmMessages.map((msg) => {
				if (msg.cache === 'ephemeral') {
					msg.experimental_providerMetadata = { anthropic: { cacheControl: { type: 'ephemeral' } } };
				}
				return msg;
			});

			const prompt = messages.map((m) => m.content).join('\n');
			span.setAttributes({
				inputChars: prompt.length,
				model: this.model,
				service: this.service,
			});

			const llmCallSave: Promise<LlmCall> = appContext().llmCallService.saveRequest({
				messages: llmMessages,
				llmId: this.getId(),
				agentId: agentContext()?.agentId,
				callStack: this.callStack(agentContext()),
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
			const inputCost = this.calculateInputCost('', usage.promptTokens, metadata);
			const outputCost = this.calculateOutputCost(await result.text, usage.completionTokens);
			const cost = inputCost + outputCost;
			addCost(cost);

			const llmCall: LlmCall = await llmCallSave;

			const stats: GenerationStats = {
				llmId: this.getId(),
				cost,
				inputTokens: usage.promptTokens,
				outputTokens: usage.completionTokens,
				totalTime: finish - requestTime,
				timeToFirstToken: firstTokenTime - requestTime,
				requestTime,
			};

			// messages =
			const responseMessage = response.messages[0];
			let message: LlmMessage;
			if (responseMessage.role === 'tool') {
				message = {
					role: 'tool',
					content: responseMessage.content,
					stats,
				};
			} else if (responseMessage.role === 'assistant') {
				message = {
					role: 'assistant',
					content: responseMessage.content,
					stats,
				};
			}

			llmCall.messages = [...llmCall.messages, message];

			span.setAttributes({
				inputTokens: usage.promptTokens,
				outputTokens: usage.completionTokens,
				inputCost,
				outputCost,
				cost,
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
