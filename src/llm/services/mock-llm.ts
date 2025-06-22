import { addCost, agentContext } from '#agent/agentContextLocalStorage';
import { appContext } from '#app/applicationContext';
import { callStack } from '#llm/llmCallService/llmCall';
import { logger } from '#o11y/logger';
import { withActiveSpan } from '#o11y/trace';
import type { AgentLLMs } from '#shared/agent/agent.model';
import { type GenerateTextOptions, type GenerationStats, type LLM, type LlmMessage, messageText, system, user } from '#shared/llm/llm.model';
import type { LlmCall } from '#shared/llmCall/llmCall.model';
import { BaseLLM } from '../base-llm';

// A discriminated union to represent the different types of calls that can be made to the mock.
export type MockLLMCall =
	| {
			type: 'generateMessage';
			messages: ReadonlyArray<LlmMessage>;
			options?: GenerateTextOptions;
	  }
	| {
			type: 'generateText';
			systemPrompt: string | undefined;
			userPrompt: string;
			options?: GenerateTextOptions;
	  };

//  Convenience alias for the “assistant” member of the union
type AssistantMessage = Extract<LlmMessage, { role: 'assistant' }>;

export class MockLLM extends BaseLLM {
	private messageResponses: (() => Promise<LlmMessage>)[] = [];
	private textResponses: (() => Promise<string>)[] = [];
	private calls: MockLLMCall[] = [];

	constructor(id = 'mock', service = 'mock', model = 'mock', maxInputTokens = 100000) {
		super(id, service, model, maxInputTokens, () => ({ inputCost: 0, outputCost: 0, totalCost: 0 }));
	}

	// =================================================================
	// Test-Facing API: For setting up and asserting on behavior in tests
	// =================================================================

	/**
	 * Resets all configured responses and clears the call history.
	 * Should be called in `beforeEach` or `afterEach` for test isolation.
	 */
	reset(): void {
		this.messageResponses = [];
		this.textResponses = [];
		this.calls = [];
	}

	/**
	 * Queue a response for the next `generateMessage` call.
	 * The response is always treated as an *assistant* message.
	 */
	addMessageResponse(response: string | Partial<AssistantMessage>): this {
		// 2.  Build a guaranteed-to-be-assistant LlmMessage
		const message: AssistantMessage =
			typeof response === 'string' ? { role: 'assistant', content: response } : ({ ...response, role: 'assistant' } as AssistantMessage);

		this.messageResponses.push(() => Promise.resolve(message));
		return this;
	}

	/**
	 * Adds a successful response to the queue for the next `generateText` call.
	 * @param response The string content for the response.
	 * @returns The MockLLM instance for chaining.
	 */
	addResponse(response: string): this {
		this.textResponses.push(() => Promise.resolve(response));
		return this;
	}

	/**
	 * Configures the next `generateMessage` call to fail with the given error.
	 * @returns The MockLLM instance for chaining.
	 */
	rejectNextMessage(error: Error): this {
		this.messageResponses.push(() => Promise.reject(error));
		return this;
	}

	/**
	 * Configures the next `generateText` call to fail with the given error.
	 * @returns The MockLLM instance for chaining.
	 */
	rejectNextText(error: Error): this {
		this.textResponses.push(() => Promise.reject(error));
		return this;
	}

	/**
	 * Gets all calls made to this mock instance.
	 */
	getCalls(): ReadonlyArray<MockLLMCall> {
		return this.calls;
	}

	/**
	 * Gets all `generateMessage` calls made to this mock instance for inspection.
	 */
	getMessageCalls(): Extract<MockLLMCall, { type: 'generateMessage' }>[] {
		return this.calls.filter((c): c is Extract<MockLLMCall, { type: 'generateMessage' }> => c.type === 'generateMessage');
	}

	/**
	 * Gets all `generateText` calls made to this mock instance for inspection.
	 */
	getTextCalls(): Extract<MockLLMCall, { type: 'generateText' }>[] {
		return this.calls.filter((c): c is Extract<MockLLMCall, { type: 'generateText' }> => c.type === 'generateText');
	}

	/**
	 * Gets the last call made to this mock instance.
	 */
	getLastCall(): MockLLMCall | undefined {
		return this.calls.at(-1);
	}

	/**
	 * Gets the total number of calls (`generateMessage` and `generateText`) made to this mock.
	 */
	getCallCount(): number {
		// Tests expect to count *only* the real LLM requests (generateMessage),
		// not the synthetic mirror “generateText” entries we record for convenience.
		return this.calls.filter((c) => c.type === 'generateMessage').length;
	}

	/**
	 * Throws an error if any configured responses were not consumed by the test.
	 * Useful for calling in `afterEach` to ensure test configurations are precise.
	 */
	assertNoPendingResponses(): void {
		const pendingMessages = this.messageResponses.length;
		const pendingTexts = this.textResponses.length;
		if (pendingMessages > 0 || pendingTexts > 0) {
			this.reset(); // Clear to prevent cascading failures
			throw new Error(`MockLLM Error: Test finished with ${pendingMessages} unconsumed message responses and ${pendingTexts} unconsumed text responses.`);
		}
	}

	// =================================================================
	// Production-Facing API: Implementation of the LLM interface
	// =================================================================

	/**
	 * Overrides `BaseLLM.generateText` to route calls to either `_generateText` or `_generateMessage`
	 * based on the arguments. This preserves the dual-queue system of `MockLLM` and allows it to
	 * handle both simple string prompts and complex message arrays.
	 */
	generateText(userPrompt: string, opts?: GenerateTextOptions): Promise<string>;
	generateText(systemPrompt: string, userPrompt: string, opts?: GenerateTextOptions): Promise<string>;
	generateText(messages: ReadonlyArray<LlmMessage>, opts?: GenerateTextOptions): Promise<string>;
	async generateText(
		userOrSystemOrMessages: string | ReadonlyArray<LlmMessage>,
		userOrOpts?: string | GenerateTextOptions,
		opts?: GenerateTextOptions,
	): Promise<string> {
		// If the original call was with a message array, use the message-based generation.
		if (Array.isArray(userOrSystemOrMessages)) {
			const assistantMessage = await this._generateMessage(userOrSystemOrMessages, userOrOpts as GenerateTextOptions);
			return messageText(assistantMessage);
		}

		// Otherwise, it was a string-based call, so use the text-based generation.
		const hasSystemPrompt = typeof userOrOpts === 'string';
		const systemPrompt = hasSystemPrompt ? (userOrSystemOrMessages as string) : undefined;
		const userPrompt = hasSystemPrompt ? (userOrOpts as string) : (userOrSystemOrMessages as string);
		const theOpts = hasSystemPrompt ? opts : (userOrOpts as GenerateTextOptions);
		return this._generateText(systemPrompt, userPrompt, theOpts);
	}

	protected async _generateMessage(messages: ReadonlyArray<LlmMessage>, opts?: GenerateTextOptions): Promise<LlmMessage> {
		/*                                                                                                                                                  
		   Record this call in BOTH flavours so that tests using                                                                                                                                                           
		   getTextCalls() (expecting ‘generateText’ entries) and/or                                                                                                                                                        
		   getMessageCalls() continue to work.                                                                                                                                                                             
		*/
		const systemPrompt = messages.find((m) => m.role === 'system') ? messageText(messages.find((m) => m.role === 'system')!) : undefined;
		const userPrompt = messages
			.filter((m) => m.role === 'user')
			.map((m) => messageText(m))
			.join('\n');

		this.calls.push({ type: 'generateMessage', messages, options: opts });
		this.calls.push({
			// Allow tests that only look at “text” calls to see this one
			type: 'generateText',
			systemPrompt,
			userPrompt,
			options: opts,
		} as any);

		// Pick a response – prefer messageResponses, but fall back to textResponses (tests queue responses with addResponse).
		let responseFn = this.messageResponses.shift();
		if (!responseFn) {
			const textResponseFn = this.textResponses.shift();
			if (textResponseFn) {
				responseFn = async () => {
					const text = await textResponseFn();
					return { role: 'assistant', content: text };
				};
			}
		}
		if (!responseFn) throw new Error(`MockLLM: No more responses configured for generateMessage. Call count: ${this.getCallCount()}`);

		const assistantMessage = await responseFn();
		await this.saveLlmCall(messages, assistantMessage, opts);
		return assistantMessage;
	}

	protected async _generateText(systemPrompt: string | undefined, userPrompt: string, opts?: GenerateTextOptions): Promise<string> {
		this.calls.push({ type: 'generateText', systemPrompt, userPrompt, options: opts });

		const responseFn = this.textResponses.shift();
		if (!responseFn) {
			throw new Error(`MockLLM: No more responses configured for generateText. Call count: ${this.getCallCount()}`);
		}

		const messages: LlmMessage[] = [];
		if (systemPrompt) messages.push(system(systemPrompt));
		messages.push(user(userPrompt));

		const responseText = await responseFn();
		const assistantMessage: LlmMessage = { role: 'assistant', content: responseText };

		await this.saveLlmCall(messages, assistantMessage, opts);

		return responseText;
	}

	/**
	 * Shared logic to persist the LLM call for both generateMessage and generateText,
	 * simulating the behavior of a real LLM integration.
	 */
	private async saveLlmCall(requestMessages: ReadonlyArray<LlmMessage>, assistantMessage: LlmMessage, opts?: GenerateTextOptions): Promise<void> {
		const description = opts?.id ?? '';
		return withActiveSpan(`saveLlmCall ${description}`, async (span) => {
			const fullPromptText = requestMessages.map((m) => messageText(m)).join('\n');
			const responseText = messageText(assistantMessage);

			const llmCallSave: Promise<LlmCall> = appContext().llmCallService.saveRequest({
				messages: requestMessages as LlmMessage[],
				llmId: this.getId(),
				agentId: agentContext()?.agentId,
				callStack: callStack(),
				description,
				settings: opts,
			});
			const requestTime = Date.now();

			const timeToFirstToken = 1;
			const finishTime = Date.now();
			const llmCall: LlmCall = await llmCallSave;

			const inputTokens = await this.countTokens(fullPromptText);
			const outputTokens = await this.countTokens(responseText);
			const { totalCost } = this.calculateCosts(inputTokens, outputTokens);
			addCost(totalCost);

			llmCall.timeToFirstToken = timeToFirstToken;
			llmCall.totalTime = finishTime - requestTime;
			llmCall.cost = totalCost;
			llmCall.inputTokens = inputTokens;
			llmCall.outputTokens = outputTokens;

			assistantMessage.stats = {
				llmId: this.getId(),
				cost: totalCost,
				inputTokens,
				outputTokens,
				requestTime,
				timeToFirstToken,
				totalTime: llmCall.totalTime,
			};

			llmCall.messages = [...llmCall.messages, assistantMessage];

			span.setAttributes({
				inputChars: fullPromptText.length,
				outputChars: responseText.length,
				inputTokens,
				outputTokens,
				cost: totalCost,
				model: this.model,
				service: this.service,
				description,
			});

			try {
				await appContext().llmCallService.saveResponse(llmCall);
			} catch (e) {
				logger.error(e, 'Failed to save MockLLM response');
			}
		});
	}
}

export const mockLLM = new MockLLM();

export function mockLLMRegistry(): Record<string, () => LLM> {
	return {
		// Tests need the same instance returned
		'mock:mock': () => mockLLM,
	};
}

export function mockLLMs(): AgentLLMs {
	return {
		easy: mockLLM,
		medium: mockLLM,
		hard: mockLLM,
		xhard: mockLLM,
	};
}
