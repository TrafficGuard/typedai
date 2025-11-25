import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { TextStreamPart } from 'ai';
import { addCost, agentContext } from '#agent/agentContextLocalStorage';
import { cloneAndTruncateBuffers } from '#agent/trimObject';
import { ApplicationContext } from '#app/applicationTypes';
import { BaseLLM, type BaseLlmConfig, costPerMilTokens } from '#llm/base-llm';
import { type CreateLlmRequest, callStack } from '#llm/llmCallService/llmCall';
import { logger } from '#o11y/logger';
import { withActiveSpan } from '#o11y/trace';
import type { GenerateTextOptions, GenerationStats, LLM, LlmCostFunction, LlmMessage } from '#shared/llm/llm.model';
import { contentText } from '#shared/llm/llm.model';
import type { LlmCall } from '#shared/llmCall/llmCall.model';
import { currentUser } from '#user/userContext';
import { errorToString } from '#utils/errors';

export const CLAUDE_CODE_SERVICE = 'claude-code';

/**
 * Response format from Claude Code CLI with --output-format json
 */
interface ClaudeCodeResponse {
	type: 'result';
	subtype: 'success' | 'error';
	result: string;
	total_cost_usd: number;
	duration_ms: number;
	duration_api_ms?: number;
	num_turns: number;
	session_id: string;
	is_error: boolean;
}

export function claudeCodeLLMRegistry(): Array<() => LLM> {
	return [claudeCodeSonnet, claudeCodeHaiku, claudeCodeOpus];
}

export function claudeCodeHaiku(): LLM {
	return new ClaudeCode('Claude Code Haiku', 'haiku', 200_000, costPerMilTokens(1, 5));
}

export function claudeCodeSonnet(): LLM {
	return new ClaudeCode('Claude Code Sonnet', 'sonnet', 200_000, costPerMilTokens(3, 15));
}

export function claudeCodeOpus(): LLM {
	return new ClaudeCode('Claude Code Opus', 'opus', 200_000, costPerMilTokens(5, 25));
}

export class ClaudeCode extends BaseLLM {
	constructor(displayName: string, modelId: string, maxInputTokens: number, calculateCosts: LlmCostFunction) {
		super({
			displayName,
			service: CLAUDE_CODE_SERVICE,
			modelId,
			maxInputTokens,
			calculateCosts,
		});
	}

	protected override supportsGenerateTextFromMessages(): boolean {
		return true;
	}

	protected override async _generateMessage(messages: ReadonlyArray<LlmMessage>, opts?: GenerateTextOptions): Promise<LlmMessage> {
		const description = opts?.id ?? '';
		return await withActiveSpan(`generateMessage ${description}`, async (span) => {
			// Transform messages to Anthropic API format
			const { systemPrompt, anthropicMessages } = this.transformToAnthropicFormat(messages);

			if (anthropicMessages.length === 0) {
				throw new Error('No messages to send to Claude Code CLI');
			}

			// For multi-turn conversations, concatenate all messages into a single user message
			// This is a limitation of using -p flag - it's a single turn
			const combinedContent: any[] = [];

			for (const msg of anthropicMessages) {
				// Add a text separator between messages to maintain context
				if (msg.role === 'user') {
					combinedContent.push(...msg.content);
				} else if (msg.role === 'assistant') {
					// Add assistant's previous response as context
					combinedContent.push({
						type: 'text',
						text: `Previous assistant response: ${msg.content.map((c: any) => (c.type === 'text' ? c.text : '')).join('')}`,
					});
				}
			}

			const streamJsonInput = {
				type: 'user',
				message: {
					role: 'user',
					content: combinedContent,
				},
			};

			const inputJson = JSON.stringify(streamJsonInput);

			// Set span attributes
			span.setAttributes({
				inputChars: inputJson.length,
				model: this.getServiceModelId(),
				service: this.service,
				description,
			});

			// Build CLI command with stream-json format
			let command = 'claude -p --output-format stream-json --input-format stream-json --verbose';
			if (systemPrompt) command += ` --append-system-prompt ${this.escapeShellArg(systemPrompt)}`;

			// Save LLM call request
			const settingsToSave = { ...opts };
			settingsToSave.abortSignal = undefined;

			const createLlmCallRequest: CreateLlmRequest = {
				messages: cloneAndTruncateBuffers(Array.from(messages)),
				llmId: this.getId(),
				agentId: agentContext()?.agentId,
				callStack: callStack(),
				description,
				settings: settingsToSave,
			};
			const llmCall: LlmCall = await this.saveLlmCallRequest(createLlmCallRequest);

			const requestTime = Date.now();

			try {
				logger.info({ llmCallId: llmCall.id }, `Generating text - ${opts?.id}`);
				logger.debug({ command, input: inputJson }, 'Executing Claude Code CLI command');

				// Use spawn with stdin for stream-json input
				const result = await this.executeClaudeCommandWithStdin(command, inputJson);

				if (result.exitCode !== 0) throw new Error(`Claude Code CLI execution failed: ${result.stderr || 'Unknown error'}`);

				// Parse the stream-json output to find the result
				const lines = result.stdout.split('\n').filter((line) => line.trim());
				let response: ClaudeCodeResponse | null = null;

				for (const line of lines) {
					try {
						const parsed = JSON.parse(line);
						if (parsed.type === 'result') {
							response = parsed;
							break;
						}
					} catch (e) {
						// Skip invalid JSON lines
					}
				}

				if (!response) {
					logger.error({ stdout: result.stdout }, 'Failed to find result in Claude Code response');
					throw new Error('Failed to find result in Claude Code response');
				}

				// Check for errors in the response
				if (response.is_error || response.subtype === 'error') throw new Error(`Claude Code error: ${response.result}`);

				const finishTime = Date.now();
				const cost = response.total_cost_usd;

				// Estimate tokens from cost (Claude Code pricing: $3/1M input, $15/1M output)
				// This is a rough estimate since we don't get exact token counts from CLI
				let inputTokens = 0;
				let outputTokens = 0;
				if (cost > 0) {
					const totalTokens = (cost / 15) * 1_000_000;
					outputTokens = Math.floor(response.result.length / 4); // Rough token estimate
					inputTokens = Math.floor(totalTokens - outputTokens);
				}

				// Update llmCall with response data
				llmCall.timeToFirstToken = finishTime - requestTime;
				llmCall.totalTime = finishTime - requestTime;
				llmCall.cost = cost;
				llmCall.inputTokens = inputTokens;
				llmCall.outputTokens = outputTokens;

				addCost(cost);

				const stats: GenerationStats = {
					llmId: this.getId(),
					cost,
					inputTokens,
					outputTokens,
					requestTime,
					timeToFirstToken: llmCall.timeToFirstToken,
					totalTime: llmCall.totalTime,
					finishReason: 'stop',
				};

				// Log stats for monitoring
				logger.debug(
					{
						cost: response.total_cost_usd,
						duration: response.duration_ms,
						apiDuration: response.duration_api_ms,
						turns: response.num_turns,
						sessionId: response.session_id,
					},
					'Claude Code response stats',
				);

				// Create response message
				const message: LlmMessage = {
					role: 'assistant',
					content: response.result,
					stats,
				};

				llmCall.messages = [...llmCall.messages, cloneAndTruncateBuffers(message)];

				span.setAttributes({
					inputTokens,
					outputTokens,
					response: response.result,
					cost,
				});

				this.saveLlmCallResponse(llmCall);

				return message;
			} catch (error) {
				llmCall.error = errorToString(error);
				this.saveLlmCallResponse(llmCall);

				span.recordException(error);
				throw error;
			}
		});
	}

	override async streamText(llmMessages: LlmMessage[], onChunk: (chunk: TextStreamPart<any>) => void, opts?: GenerateTextOptions): Promise<GenerationStats> {
		// Extract system messages
		const systemMessages = llmMessages.filter((msg) => msg.role === 'system');
		const systemPrompt = systemMessages.length > 0 ? systemMessages.map((msg) => contentText(msg.content)).join('\n') : undefined;

		// Extract user messages
		const userMessages = llmMessages.filter((msg) => msg.role === 'user');
		const userPrompt = userMessages.map((msg) => contentText(msg.content)).join('\n');

		// Build CLI command with streaming enabled (requires --verbose for stream-json)
		let command = `claude --verbose --model ${this.modelId} -p ${this.escapeShellArg(userPrompt)} --output-format stream-json --verbose`;
		if (systemPrompt) command += ` --append-system-prompt ${this.escapeShellArg(systemPrompt)}`;

		logger.debug({ command }, 'Executing Claude Code CLI command with streaming');

		const requestTime = Date.now();
		let firstTokenTime = 0;
		let totalCost = 0;
		let duration = 0;
		let sessionId = '';
		let fullText = '';
		let inputTokens = 0;
		let outputTokens = 0;
		let numTurns = 0;

		return new Promise((resolve, reject) => {
			const proc = spawn('sh', ['-c', command], {
				stdio: ['ignore', 'pipe', 'pipe'],
			});

			let buffer = '';

			proc.stdout.on('data', (data: Buffer) => {
				if (!firstTokenTime) firstTokenTime = Date.now();

				buffer += data.toString();
				const lines = buffer.split('\n');
				buffer = lines.pop() || ''; // Keep incomplete line in buffer

				for (const line of lines) {
					if (!line.trim()) continue;

					try {
						const jsonLine = JSON.parse(line);

						// Handle assistant messages (streaming content)
						if (jsonLine.type === 'assistant' && jsonLine.message) {
							const msg = jsonLine.message;
							if (msg.content && Array.isArray(msg.content)) {
								for (const part of msg.content) {
									if (part.type === 'text' && part.text) {
										fullText += part.text;
										// Send text delta to onChunk callback
										onChunk({ type: 'text-delta', id: msg.id || '', text: part.text });
									}
								}
							}

							// Extract token usage if available
							if (msg.usage) {
								inputTokens = msg.usage.input_tokens || 0;
								outputTokens = msg.usage.output_tokens || 0;
							}
						}

						// Handle final result message with stats
						if (jsonLine.type === 'result') {
							totalCost = jsonLine.total_cost_usd || 0;
							duration = jsonLine.duration_ms || 0;
							sessionId = jsonLine.session_id || '';
							numTurns = jsonLine.num_turns || 1;

							// Override token counts from result if available
							if (jsonLine.usage) {
								inputTokens = jsonLine.usage.input_tokens || inputTokens;
								outputTokens = jsonLine.usage.output_tokens || outputTokens;
							}

							// Log stats
							logger.debug(
								{
									cost: totalCost,
									duration,
									sessionId,
									turns: numTurns,
								},
								'Claude Code streaming stats',
							);
						}
					} catch (e) {
						logger.debug({ line }, 'Skipping non-JSON line in stream');
					}
				}
			});

			proc.stderr.on('data', (data: Buffer) => {
				logger.error({ stderr: data.toString() }, 'Claude Code CLI stderr');
			});

			proc.on('close', (code: number) => {
				const finishTime = Date.now();
				if (!firstTokenTime) firstTokenTime = finishTime;

				if (code !== 0) {
					reject(new Error(`Claude Code CLI execution failed with code ${code}`));
					return;
				}

				// If we still don't have token counts, estimate from cost
				if (totalCost > 0 && inputTokens === 0 && outputTokens === 0) {
					// Rough estimation: Claude Code pricing is $3/1M input, $15/1M output
					const totalTokens = (totalCost / 15) * 1_000_000;
					outputTokens = Math.floor(fullText.length / 4); // Rough token estimate
					inputTokens = Math.floor(totalTokens - outputTokens);
				}

				const stats: GenerationStats = {
					llmId: this.getId(),
					cost: totalCost,
					inputTokens,
					outputTokens,
					totalTime: finishTime - requestTime,
					timeToFirstToken: firstTokenTime - requestTime,
					finishReason: 'stop',
					requestTime,
				};

				resolve(stats);
			});

			proc.on('error', (error: Error) => {
				reject(new Error(`Failed to spawn Claude Code CLI: ${error.message}`));
			});
		});
	}

	protected apiKey(): string | undefined {
		return currentUser()?.llmConfig.anthropicKey?.trim() || process.env.ANTHROPIC_API_KEY;
	}

	// override isConfigured(): boolean {
	// 	// Claude Code requires the CLI to be installed
	// 	// We return true here and let it fail at execution time with a clear error
	// 	// A proper async check would require execCommand which this synchronous method doesn't support
	// 	return true;
	// }

	/**
	 * Escapes a string for safe use as a shell argument.
	 * Uses single quotes and escapes any single quotes in the string.
	 */
	private escapeShellArg(arg: string): string {
		return `'${arg.replace(/'/g, "'\\''")}'`;
	}

	/**
	 * Transforms messages to Anthropic API format for Claude Code CLI --input-format stream-json
	 * Format: {"type":"user","message":{"role":"user","content":[...]}}
	 */
	private transformToAnthropicFormat(messages: ReadonlyArray<LlmMessage>): {
		systemPrompt?: string;
		anthropicMessages: any[];
	} {
		const systemMessages = messages.filter((msg) => msg.role === 'system');
		const systemPrompt = systemMessages.length > 0 ? systemMessages.map((msg) => contentText(msg.content)).join('\n') : undefined;

		// Convert non-system messages to Anthropic format
		const anthropicMessages = messages
			.filter((msg) => msg.role !== 'system')
			.map((msg) => {
				const content: any[] = [];

				if (typeof msg.content === 'string') {
					content.push({ type: 'text', text: msg.content });
				} else if (Array.isArray(msg.content)) {
					for (const part of msg.content) {
						if (part.type === 'text') {
							content.push({ type: 'text', text: part.text });
						} else if (part.type === 'image') {
							// Transform image to Anthropic format
							const imageUrl = part.image;
							if (imageUrl.startsWith('data:')) {
								// Extract media type and base64 data
								const match = imageUrl.match(/^data:([^;]+);base64,(.+)$/);
								if (match) {
									content.push({
										type: 'image',
										source: {
											type: 'base64',
											media_type: match[1],
											data: match[2],
										},
									});
								}
							} else {
								// URL-based image
								content.push({
									type: 'image',
									source: {
										type: 'url',
										url: imageUrl,
									},
								});
							}
						}
						// Skip other content types (tool-call, reasoning, etc.) as they're not supported in input
					}
				}

				return {
					role: msg.role,
					content,
				};
			});

		return { systemPrompt, anthropicMessages };
	}

	/**
	 * Executes a Claude Code CLI command using spawn to avoid shell issues.
	 */
	private executeClaudeCommand(command: string): Promise<{ stdout: string; stderr: string; exitCode: number }> {
		return new Promise((resolve, reject) => {
			const proc = spawn('sh', ['-c', command], {
				stdio: ['ignore', 'pipe', 'pipe'],
			});

			let stdout = '';
			let stderr = '';

			proc.stdout.on('data', (data: Buffer) => {
				stdout += data.toString();
			});

			proc.stderr.on('data', (data: Buffer) => {
				stderr += data.toString();
			});

			proc.on('close', (code: number | null) => {
				resolve({
					stdout,
					stderr,
					exitCode: code ?? 1,
				});
			});

			proc.on('error', (error: Error) => {
				reject(new Error(`Failed to spawn Claude Code CLI: ${error.message}`));
			});
		});
	}

	/**
	 * Executes a Claude Code CLI command with JSON input via stdin.
	 */
	private executeClaudeCommandWithStdin(command: string, input: string): Promise<{ stdout: string; stderr: string; exitCode: number }> {
		return new Promise((resolve, reject) => {
			const proc = spawn('sh', ['-c', command], {
				stdio: ['pipe', 'pipe', 'pipe'],
			});

			let stdout = '';
			let stderr = '';

			proc.stdout.on('data', (data: Buffer) => {
				stdout += data.toString();
			});

			proc.stderr.on('data', (data: Buffer) => {
				stderr += data.toString();
			});

			proc.on('close', (code: number | null) => {
				resolve({
					stdout,
					stderr,
					exitCode: code ?? 1,
				});
			});

			proc.on('error', (error: Error) => {
				reject(new Error(`Failed to spawn Claude Code CLI: ${error.message}`));
			});

			// Write input to stdin and close it
			proc.stdin.write(`${input}\n`);
			proc.stdin.end();
		});
	}

	// Lazy load to fix dependency cycle
	private _appContextModule: typeof import('#app/applicationContext') | undefined;
	private appContext(): ApplicationContext {
		this._appContextModule ??= require('#app/applicationContext');
		if (!this._appContextModule) throw new Error('appContext not initialized');
		return this._appContextModule.appContext();
	}

	async saveLlmCallRequest(llmCall: CreateLlmRequest): Promise<LlmCall> {
		try {
			return await this.appContext().llmCallService.saveRequest(llmCall);
		} catch (e) {
			// If the initial save fails then we'll just save it later with the response
			return {
				...llmCall,
				id: randomUUID(),
				requestTime: Date.now(),
			};
		}
	}

	async saveLlmCallResponse(llmCall: LlmCall) {
		try {
			await this.appContext().llmCallService.saveResponse(llmCall);
		} catch (e) {
			logger.error(e);
		}
	}
}
