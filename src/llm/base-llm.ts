import { type TextStreamPart } from 'ai';
import { countTokens } from '#llm/tokens';
import { logger } from '#o11y/logger';
import type { AgentContext } from '#shared/agent/agent.model';
import {
	type GenerateJsonOptions,
	type GenerateTextOptions,
	type GenerateTextWithJsonResponse,
	type GenerationStats,
	type LLM,
	LlmCostFunction,
	type LlmMessage,
	type Prompt,
	assistant,
	isSystemUserPrompt,
	messageText,
	system,
	user,
} from '#shared/llm/llm.model';
// Import extractReasoningAndJson, extractJsonResult is still used by generateJson
import { extractJsonResult, extractReasoningAndJson, extractTag } from './responseParsers';

export interface SerializedLLM {
	service: string;
	model: string;
}

export interface BaseLlmConfig {
	displayName: string;
	service: string;
	modelId: string;
	maxInputTokens: number;
	maxOutputTokens?: number;
	calculateCosts: LlmCostFunction;
	oldIds?: string[];
	/** The provider's native model identifier if different from modelId */
	serviceModelId?: string;
}

export function costPerMilTokens(
	inputMil: number,
	outputMil: number,
	cachedInputMil?: number,
	longInputMil?: number,
	longOutputMil?: number,
	longThreshold = 128000,
): LlmCostFunction {
	return (inputTokens: number, outputTokens: number, cachedInputTokens: number) => {
		const useLongContext = !!longInputMil && !!longOutputMil && inputTokens >= longThreshold;
		const inputMilCost = useLongContext ? longInputMil! : inputMil;
		const outputMilCost = useLongContext ? longOutputMil! : outputMil;

		const standardInputTokens = inputTokens - cachedInputTokens;
		const cachedMilCost = useLongContext ? (cachedInputMil ?? inputMilCost) : (cachedInputMil ?? inputMil);

		const standardInputCost = (standardInputTokens * inputMilCost) / 1_000_000;
		const cachedInputCost = (cachedInputTokens * cachedMilCost) / 1_000_000;
		const inputCost = standardInputCost + cachedInputCost;
		const outputCost = (outputTokens * outputMilCost) / 1_000_000;
		return {
			inputCost,
			outputCost,
			totalCost: inputCost + outputCost,
		};
	};
}

export abstract class BaseLLM implements LLM {
	protected readonly displayName: string;
	protected readonly service: string;
	protected modelId: string;
	protected serviceModelId?: string;
	protected maxInputTokens: number;
	protected maxOutputTokens?: number;
	readonly calculateCosts: LlmCostFunction;
	private oldIds: string[] = [];

	constructor(cfg: BaseLlmConfig) {
		this.displayName = cfg.displayName;
		this.service = cfg.service;
		this.modelId = cfg.modelId;
		this.serviceModelId = cfg.serviceModelId;
		this.maxInputTokens = cfg.maxInputTokens;
		this.maxOutputTokens = cfg.maxOutputTokens;
		this.calculateCosts = cfg.calculateCosts;
		this.oldIds = cfg.oldIds ?? [];
	}

	protected _generateText(systemPrompt: string | undefined, userPrompt: string, opts?: GenerateTextOptions): Promise<string> {
		throw new Error(`BaseLLM._generateText Not implemented for ${this.getId()}`);
	}

	protected supportsGenerateTextFromMessages(): boolean {
		return false;
	}

	protected parseGenerateTextParameters(
		userOrSystemOrMessages: string | LlmMessage[],
		userOrOptions?: string | GenerateTextOptions,
		opts?: GenerateTextOptions,
	): { messages: LlmMessage[]; options?: GenerateTextOptions } {
		let messages: LlmMessage[];
		let options: GenerateTextOptions | undefined;
		// Args: messages, opts
		if (Array.isArray(userOrSystemOrMessages)) {
			messages = userOrSystemOrMessages;
			options = userOrOptions as GenerateTextOptions;
		} else {
			let userPrompt: string;
			let systemPrompt: string | undefined;
			// Args: system, user, opts
			if (typeof userOrOptions === 'string') {
				systemPrompt = userOrSystemOrMessages;
				userPrompt = userOrOptions as string;
				options = opts;
			} else {
				// Args: user, opts
				userPrompt = userOrSystemOrMessages;
				options = userOrOptions;
			}

			messages = [];
			if (systemPrompt) {
				messages.push({
					role: 'system',
					content: systemPrompt,
				});
			}
			messages.push({
				role: 'user',
				content: userPrompt,
			});
		}

		return { messages, options };
	}

	generateText(userPrompt: string, opts?: GenerateTextOptions): Promise<string>;
	generateText(systemPrompt: string, userPrompt: string, opts?: GenerateTextOptions): Promise<string>;
	generateText(messages: LlmMessage[], opts?: GenerateTextOptions): Promise<string>;
	async generateText(userOrSystemOrMessages: string | LlmMessage[], userOrOpts?: string | GenerateTextOptions, opts?: GenerateTextOptions): Promise<string> {
		const { messages, options } = this.parseGenerateTextParameters(userOrSystemOrMessages, userOrOpts, opts);
		if (!this.supportsGenerateTextFromMessages()) {
			if (messages.length > 2) throw new Error('LLM service/model doesnt support multiple user messages');
			const hasSystemPrompt = messages[0]!.role === 'system';
			const systemPrompt = hasSystemPrompt ? (messages[0]!.content as string) : undefined;
			const userPrompt = hasSystemPrompt ? (messages[1]!.content as string) : (messages[0]!.content as string);
			const theOpts = typeof userOrOpts === 'string' ? opts : userOrOpts;
			return this._generateText(systemPrompt, userPrompt, theOpts);
		}
		return this.generateTextFromMessages(messages, options);
	}

	generateTextWithResult(userPrompt: string, opts?: GenerateTextOptions): Promise<string>;
	generateTextWithResult(systemPrompt: string, userPrompt: string, opts?: GenerateTextOptions): Promise<string>;
	generateTextWithResult(messages: LlmMessage[], opts?: GenerateTextOptions): Promise<string>;
	async generateTextWithResult(
		userOrSystemOrMessages: string | LlmMessage[],
		userOrOpts?: string | GenerateTextOptions,
		opts?: GenerateTextOptions,
	): Promise<string> {
		const { messages, options } = this.parseGenerateTextParameters(userOrSystemOrMessages, userOrOpts, opts);
		const response = await this.generateText(messages, options);
		return extractTag(response, 'result');
	}

	generateTextWithJson<T>(userPrompt: string, opts?: GenerateJsonOptions): Promise<GenerateTextWithJsonResponse<T>>;
	generateTextWithJson<T>(systemPrompt: string, userPrompt: string, opts?: GenerateJsonOptions): Promise<GenerateTextWithJsonResponse<T>>;
	generateTextWithJson<T>(messages: LlmMessage[], opts?: GenerateJsonOptions): Promise<GenerateTextWithJsonResponse<T>>;
	async generateTextWithJson<T>(
		userOrSystemOrMessages: string | LlmMessage[],
		userOrOpts?: string | GenerateJsonOptions,
		opts?: GenerateJsonOptions,
	): Promise<GenerateTextWithJsonResponse<T>> {
		const { messages, options } = this.parseGenerateTextParameters(userOrSystemOrMessages, userOrOpts, opts);
		try {
			const responseText = await this.generateText(messages, options);
			const { reasoning, object } = extractReasoningAndJson<T>(responseText);
			return {
				message: assistant(responseText), // Full raw response text as an assistant message
				reasoning,
				object,
			};
		} catch (e) {
			// Retry if SyntaxError (JSON parsing failed) or Error (specific structure not found by extractReasoningAndJson)
			if (e instanceof SyntaxError || (e instanceof Error && e.message.startsWith('Failed to extract structured JSON'))) {
				logger.warn({ id: options?.id, error: (e as Error).message }, 'JSON parsing failed, retrying LLM call');
				const responseText = await this.generateText(messages, options); // Second attempt
				const { reasoning, object } = extractReasoningAndJson<T>(responseText); // Second parse attempt
				logger.info({ id: options?.id }, 'Retry succeeded');
				return {
					message: assistant(responseText),
					reasoning,
					object,
				};
			}
			throw e; // Re-throw other errors
		}
	}

	generateJson<T>(userPrompt: string, opts?: GenerateJsonOptions): Promise<T>;
	generateJson<T>(systemPrompt: string, userPrompt: string, opts?: GenerateJsonOptions): Promise<T>;
	generateJson<T>(messages: LlmMessage[], opts?: GenerateJsonOptions): Promise<T>;
	async generateJson<T>(userOrSystemOrMessages: string | LlmMessage[], userOrOpts?: string | GenerateJsonOptions, opts?: GenerateJsonOptions): Promise<T> {
		const { messages, options } = this.parseGenerateTextParameters(userOrSystemOrMessages, userOrOpts, opts);
		const combinedOptions: GenerateTextOptions = options ? { ...options, type: 'json' } : { type: 'json' };
		const response = await this.generateText(messages, combinedOptions);
		try {
			return extractJsonResult(response);
		} catch (e) {
			if (e instanceof SyntaxError) {
				// TODO should try to just extract it from the response message
				const response = await this.generateText(messages, options);
				return extractJsonResult(response);
			}
			throw e;
		}
	}

	/** Generate a LlmMessage response */
	async generateMessage(prompt: Prompt, opts?: GenerateTextOptions): Promise<LlmMessage> {
		let messages: ReadonlyArray<LlmMessage>;
		if (typeof prompt === 'string') {
			messages = [user(prompt)];
		} else if (isSystemUserPrompt(prompt)) {
			messages = [system(prompt[0]), user(prompt[1])];
		} else {
			messages = prompt;
		}
		return this._generateMessage(messages, opts);
	}

	protected _generateMessage(messages: ReadonlyArray<LlmMessage>, opts?: GenerateTextOptions): Promise<LlmMessage> {
		throw new Error(`_generateMessage not implemented for ${this.getId()}`);
	}

	getMaxInputTokens(): number {
		return this.maxInputTokens;
	}

	getMaxOutputTokens(): number | undefined {
		return this.maxOutputTokens;
	}

	isRetryableError(e: any): boolean {
		return false;
	}

	getModel(): string {
		return this.modelId;
	}

	getServiceModelId(): string {
		return this.serviceModelId ?? this.modelId;
	}

	getService(): string {
		return this.service;
	}

	getId(): string {
		return `${this.service}:${this.modelId}`;
	}

	getDisplayName(): string {
		return this.displayName;
	}

	countTokens(text: string): Promise<number> {
		// defaults to gpt4o token parser
		return countTokens(text);
	}

	protected async generateTextFromMessages(llmMessages: LlmMessage[], opts?: GenerateTextOptions): Promise<string> {
		const msg = await this.generateMessage(llmMessages, opts);
		return messageText(msg);
	}

	async streamText(llmMessages: LlmMessage[], onChunk: (chunk: TextStreamPart<any>) => void, opts?: GenerateTextOptions): Promise<GenerationStats> {
		throw new Error(`BaseLLM.streamText Not implemented for ${this.getId()}`);
	}

	isConfigured(): boolean {
		// Default implementation, should be overridden by specific LLM implementations
		return true;
	}

	getOldModels(): string[] {
		return this.oldIds;
	}

	/** @deprecated Use callStack in llmCall.ts */
	callStack(agent?: AgentContext): string {
		if (!agent) return '';
		const arr: string[] = agent.callStack;
		if (!arr || arr.length === 0) return '';
		if (arr.length === 1) return arr[0]!;
		// Remove duplicates from when we call multiple in parallel, eg in findFilesToEdit
		let i = arr.length - 1;
		while (i > 0 && arr[i] === arr[i - 1]) {
			i--;
		}

		return arr.slice(0, i + 1).join(' > ');
	}

	// generateMessage(userPrompt: string, opts?: GenerateTextOptions): Promise<LlmMessage>;
	// generateMessage(messages: [systemPrompt: string, userPrompt: string], opts?: GenerateTextOptions): Promise<LlmMessage>;
	// generateMessage(messages: LlmMessage[] | ReadonlyArray<LlmMessage>, opts?: GenerateTextOptions): Promise<LlmMessage>;
	// generateMessage(
	// 	messages: string | [systemPrompt: string, userPrompt: string] | LlmMessage[] | ReadonlyArray<LlmMessage>,
	// 	opts?: GenerateTextOptions,
	// ): Promise<LlmMessage> {
	// 	return Promise.resolve(undefined);
	// }
}
