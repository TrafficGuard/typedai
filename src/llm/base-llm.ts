import { StreamTextResult, TextStreamPart } from 'ai';
import { AgentContext } from '#agent/agentContextTypes';
import { countTokens } from '#llm/tokens';
import { GenerateJsonOptions, GenerateTextOptions, GenerationStats, LLM, LlmMessage, Prompt, SystemUserPrompt, isSystemUserPrompt, system, user } from './llm';
import { extractJsonResult, extractTag } from './responseParsers';

export interface SerializedLLM {
	service: string;
	model: string;
}

export type InputCostFunction = (input: string, inputTokens: number, usage?: any, completionTime?: Date) => number;
export type OutputCostFunction = (output: string, outputTokens: number, completionTime?: Date) => number;

export function perMilTokens(dollarsPerMillionTokens: number): InputCostFunction {
	return (_, tokens) => (tokens * dollarsPerMillionTokens) / 1_000_000;
}

export abstract class BaseLLM implements LLM {
	constructor(
		protected readonly displayName: string,
		protected readonly service: string,
		protected model: string,
		protected maxInputTokens: number,
		readonly calculateInputCost: InputCostFunction,
		readonly calculateOutputCost: OutputCostFunction,
	) {}

	protected _generateText(systemPrompt: string | undefined, userPrompt: string, opts?: GenerateTextOptions): Promise<string> {
		throw new Error('Not implemented');
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
			const hasSystemPrompt = messages[0].role === 'system';
			const systemPrompt = hasSystemPrompt ? (messages[0].content as string) : undefined;
			const userPrompt = hasSystemPrompt ? (messages[1].content as string) : (messages[0].content as string);
			return this._generateText(systemPrompt, userPrompt, opts);
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

	generateTextWithJson(userPrompt: string, opts?: GenerateTextOptions): Promise<string>;
	generateTextWithJson(systemPrompt: string, userPrompt: string, opts?: GenerateTextOptions): Promise<string>;
	generateTextWithJson(messages: LlmMessage[], opts?: GenerateTextOptions): Promise<string>;
	async generateTextWithJson(
		userOrSystemOrMessages: string | LlmMessage[],
		userOrOpts?: string | GenerateTextOptions,
		opts?: GenerateTextOptions,
	): Promise<string> {
		const { messages, options } = this.parseGenerateTextParameters(userOrSystemOrMessages, userOrOpts, opts);
		try {
			const response = await this.generateText(messages, options);
			return extractJsonResult(response);
		} catch (e) {
			if (e instanceof SyntaxError) {
				const response = await this.generateText(messages, options);
				return extractJsonResult(response);
			}
			throw e;
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

	isRetryableError(e: any): boolean {
		return false;
	}

	getModel(): string {
		return this.model;
	}

	getService(): string {
		return this.service;
	}

	getId(): string {
		return `${this.service}:${this.model}`;
	}

	getDisplayName(): string {
		return this.displayName;
	}

	countTokens(text: string): Promise<number> {
		// defaults to gpt4o token parser
		return countTokens(text);
	}

	protected generateTextFromMessages(llmMessages: LlmMessage[], opts?: GenerateTextOptions): Promise<string> {
		throw new Error('Not implemented');
	}

	async streamText(llmMessages: LlmMessage[], onChunk: (chunk: TextStreamPart<any>) => void, opts?: GenerateTextOptions): Promise<GenerationStats> {
		throw new Error('Not implemented');
	}

	isConfigured(): boolean {
		// Default implementation, should be overridden by specific LLM implementations
		return true;
	}

	protected callStack(agent?: AgentContext): string {
		if (!agent) return '';
		const arr: string[] = agent.callStack;
		if (!arr || arr.length === 0) return '';
		if (arr.length === 1) return arr[0];
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
