/**
 * V2 SDK interface implementation using V1 SDK
 *
 * This provides the simplified send()/receive() pattern from V2 while using
 * the V1 query() function internally, enabling features like session forking
 * that aren't available in the official V2 preview.
 */

import { type Options, type Query, type SDKMessage, type SDKResultMessage, query } from '@anthropic-ai/claude-agent-sdk';

// Re-export types that consumers will need
export type { SDKMessage, SDKResultMessage, Options };

/**
 * Options for creating a session, extending V1 Options
 */
export interface SessionOptions extends Omit<Options, 'resume' | 'forkSession'> {
	model: string;
}

/**
 * Options for resuming a session
 */
export interface ResumeSessionOptions extends SessionOptions {
	/**
	 * When true, creates a fork of the session instead of continuing it.
	 * The original session remains unchanged and a new session ID is created.
	 */
	fork?: boolean;
}

/**
 * Result from unstable_v2_prompt()
 */
export interface PromptResult {
	result: string;
	sessionId: string;
	totalCostUsd: number;
	usage: {
		inputTokens: number;
		outputTokens: number;
		cacheReadInputTokens: number;
		cacheCreationInputTokens: number;
	};
	durationMs: number;
	numTurns: number;
}

/**
 * Session interface for multi-turn conversations
 */
export interface Session {
	/**
	 * Send a message to Claude
	 */
	send(message: string): Promise<void>;

	/**
	 * Receive the response as a stream of messages
	 */
	receive(): AsyncGenerator<SDKMessage>;

	/**
	 * Close the session and release resources
	 */
	close(): void;

	/**
	 * Create a forked copy of this session.
	 * The fork starts with the same conversation history but has a new session ID.
	 * Changes to the fork don't affect the original session.
	 */
	fork(options?: Partial<SessionOptions>): Session;

	/**
	 * The session ID, available after the first message exchange
	 */
	readonly sessionId: string | undefined;

	/**
	 * Support for `await using` automatic cleanup (TypeScript 5.2+)
	 */
	[Symbol.asyncDispose](): Promise<void>;
}

/**
 * Internal session implementation
 */
class SessionImpl implements Session {
	private _sessionId: string | undefined;
	private options: SessionOptions;
	private resumeSessionId: string | undefined;
	private isFork: boolean;
	private currentQuery: Query | null = null;
	private abortController: AbortController;
	private closed = false;

	constructor(options: SessionOptions, resumeSessionId?: string, isFork = false) {
		this.options = options;
		this.resumeSessionId = resumeSessionId;
		this.isFork = isFork;
		this.abortController = new AbortController();
	}

	get sessionId(): string | undefined {
		return this._sessionId;
	}

	async send(message: string): Promise<void> {
		if (this.closed) {
			throw new Error('Session is closed');
		}

		if (this.currentQuery) {
			throw new Error('Cannot send while a previous receive() is still in progress. Await all messages from receive() first.');
		}

		// Build query options
		const queryOptions: Options = {
			...this.options,
			abortController: this.abortController,
		};

		// Handle resume/fork logic
		if (this._sessionId) {
			// We have a session ID from a previous exchange - resume it
			queryOptions.resume = this._sessionId;
		} else if (this.resumeSessionId) {
			// This is a resumed or forked session
			queryOptions.resume = this.resumeSessionId;
			if (this.isFork) {
				queryOptions.forkSession = true;
			}
		}

		// Start the query
		this.currentQuery = query({
			prompt: message,
			options: queryOptions,
		});
	}

	async *receive(): AsyncGenerator<SDKMessage> {
		if (this.closed) {
			throw new Error('Session is closed');
		}

		if (!this.currentQuery) {
			throw new Error('No message sent. Call send() before receive().');
		}

		try {
			for await (const msg of this.currentQuery) {
				// Capture session ID from any message
				if (msg.session_id && !this._sessionId) {
					this._sessionId = msg.session_id;
					// Clear the resume session ID after first use
					this.resumeSessionId = undefined;
					this.isFork = false;
				}

				yield msg;
			}
		} finally {
			this.currentQuery = null;
		}
	}

	close(): void {
		if (this.closed) return;

		this.closed = true;
		this.abortController.abort();
		this.currentQuery = null;
	}

	fork(options?: Partial<SessionOptions>): Session {
		if (!this._sessionId) {
			throw new Error('Cannot fork: no session ID available. Complete at least one send/receive cycle first.');
		}

		const mergedOptions: SessionOptions = {
			...this.options,
			...options,
		};

		return new SessionImpl(mergedOptions, this._sessionId, true);
	}

	async [Symbol.asyncDispose](): Promise<void> {
		this.close();
	}
}

/**
 * Create a new session for multi-turn conversations.
 *
 * @example
 * ```typescript
 * await using session = unstable_v2_createSession({
 *   model: 'claude-sonnet-4-5-20250929'
 * });
 *
 * await session.send('Hello!');
 * for await (const msg of session.receive()) {
 *   if (msg.type === 'assistant') {
 *     console.log(extractText(msg));
 *   }
 * }
 *
 * // Fork the session to explore different paths
 * const fork = session.fork();
 * await fork.send('What if we tried a different approach?');
 * for await (const msg of fork.receive()) {
 *   // ...
 * }
 * ```
 */
export function unstable_v2_createSession(options: SessionOptions): Session {
	return new SessionImpl(options);
}

/**
 * Resume an existing session by ID.
 *
 * @param sessionId - The session ID to resume
 * @param options - Session options (fork: true to create a fork instead of continuing)
 *
 * @example
 * ```typescript
 * // Resume and continue the original session
 * const session = unstable_v2_resumeSession(savedSessionId, {
 *   model: 'claude-sonnet-4-5-20250929'
 * });
 *
 * // Resume but fork to a new session (original unchanged)
 * const forkedSession = unstable_v2_resumeSession(savedSessionId, {
 *   model: 'claude-sonnet-4-5-20250929',
 *   fork: true
 * });
 * ```
 */
export function unstable_v2_resumeSession(sessionId: string, options: ResumeSessionOptions): Session {
	const { fork = false, ...sessionOptions } = options;
	return new SessionImpl(sessionOptions, sessionId, fork);
}

/**
 * One-shot convenience function for single-turn queries.
 *
 * @param prompt - The prompt to send
 * @param options - Session options
 * @returns The result including response text, session ID, and usage stats
 *
 * @example
 * ```typescript
 * const result = await unstable_v2_prompt('What is 2 + 2?', {
 *   model: 'claude-sonnet-4-5-20250929'
 * });
 * console.log(result.result); // "4"
 * console.log(result.sessionId); // Can be used to resume later
 * ```
 */
export async function unstable_v2_prompt(prompt: string, options: SessionOptions): Promise<PromptResult> {
	const session = unstable_v2_createSession(options);

	try {
		await session.send(prompt);

		let result: PromptResult | null = null;

		for await (const msg of session.receive()) {
			if (msg.type === 'result') {
				if (msg.subtype === 'success') {
					result = {
						result: msg.result,
						sessionId: msg.session_id,
						totalCostUsd: msg.total_cost_usd,
						usage: {
							inputTokens: msg.usage.input_tokens,
							outputTokens: msg.usage.output_tokens,
							cacheReadInputTokens: msg.usage.cache_read_input_tokens ?? 0,
							cacheCreationInputTokens: msg.usage.cache_creation_input_tokens ?? 0,
						},
						durationMs: msg.duration_ms,
						numTurns: msg.num_turns,
					};
				} else {
					// Handle error results
					const errorMsg = msg as SDKResultMessage & { errors?: string[] };
					throw new Error(`Query failed (${msg.subtype}): ${errorMsg.errors?.join(', ') || 'Unknown error'}`);
				}
			}
		}

		if (!result) {
			throw new Error('No result received from query');
		}

		return result;
	} finally {
		session.close();
	}
}

/**
 * Helper function to extract text content from an assistant message
 */
export function extractAssistantText(msg: SDKMessage): string | null {
	if (msg.type !== 'assistant') return null;

	type ContentBlock = (typeof msg.message.content)[number];
	type TextBlock = { type: 'text'; text: string };

	return msg.message.content
		.filter((block: ContentBlock): block is TextBlock => block.type === 'text')
		.map((block: TextBlock) => block.text)
		.join('');
}

/**
 * Helper function to check if a message is an assistant message with text
 */
export function isAssistantMessage(msg: SDKMessage): msg is SDKMessage & { type: 'assistant' } {
	return msg.type === 'assistant';
}

/**
 * Helper function to check if a message is a result message
 */
export function isResultMessage(msg: SDKMessage): msg is SDKResultMessage {
	return msg.type === 'result';
}

/**
 * Helper function to check if a result is successful
 */
export function isSuccessResult(msg: SDKMessage): msg is SDKResultMessage & { subtype: 'success' } {
	return msg.type === 'result' && msg.subtype === 'success';
}
