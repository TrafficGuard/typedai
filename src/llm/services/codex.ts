import { spawn, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { addCost, agentContext } from '#agent/agentContextLocalStorage';
import { cloneAndTruncateBuffers } from '#agent/trimObject';
import { ApplicationContext } from '#app/applicationTypes';
import { BaseLLM, costPerMilTokens } from '#llm/base-llm';
import { type CreateLlmRequest, callStack } from '#llm/llmCallService/llmCall';
import { logger } from '#o11y/logger';
import { withActiveSpan } from '#o11y/trace';
import type { GenerateTextOptions, GenerationStats, LLM, LlmMessage } from '#shared/llm/llm.model';
import { messageText } from '#shared/llm/llm.model';
import type { LlmCall } from '#shared/llmCall/llmCall.model';
import { errorToString } from '#utils/errors';

export const CODEX_CLI_SERVICE = 'codex-cli';
const CODEX_MODEL_ID = 'codex-exec';

interface CodexUsageEvent {
	input_tokens?: number;
	output_tokens?: number;
	cached_input_tokens?: number;
}

interface CodexItemEvent {
	id?: string;
	type?: string;
	text?: string;
	content?: Array<{ text?: string }>;
	delta?: { text?: string };
}

interface CodexEvent {
	type: string;
	item?: CodexItemEvent;
	usage?: CodexUsageEvent;
	thread_id?: string;
	message?: string;
	error?: { message?: string };
}

interface CodexExecResult {
	text: string;
	usage: {
		inputTokens: number;
		outputTokens: number;
		cachedInputTokens: number;
	};
	threadId?: string;
	timeToFirstToken: number;
	totalTime: number;
}

let cachedCliAvailability: boolean | undefined;

export function isCodexCliAvailable(): boolean {
	if (cachedCliAvailability !== undefined) return cachedCliAvailability;
	try {
		const result = spawnSync('codex', ['--version'], { stdio: 'ignore' });
		cachedCliAvailability = !result.error && result.status === 0;
	} catch {
		cachedCliAvailability = false;
	}
	return cachedCliAvailability;
}

export function codexLLMRegistry(): Array<() => LLM> {
	return [gpt5_1_codex, gpt5_1_codex_mini];
}

export function gpt5_1_codex(): LLM {
	return new CodexExec('GPT-5.1 Codex', 'gpt-5.1-codex', 'gpt-5.1-codex', 200_000, costPerMilTokens(0, 0));
}

export function gpt5_1_codex_mini(): LLM {
	return new CodexExec('GPT-5.1 Codex Mini', 'gpt-5.1-codex-mini', 'gpt-5.1-codex-mini', 200_000, costPerMilTokens(0, 0));
}

export class CodexExec extends BaseLLM {
	constructor(displayName: string, modelId: string, serviceModelId: string, maxInputTokens: number, calculateCosts = costPerMilTokens(0, 0)) {
		super({
			displayName,
			service: CODEX_CLI_SERVICE,
			modelId,
			serviceModelId,
			maxInputTokens,
			calculateCosts,
		});
	}

	protected override supportsGenerateTextFromMessages(): boolean {
		return true;
	}

	override isConfigured(): boolean {
		return isCodexCliAvailable();
	}

	protected override async _generateMessage(messages: ReadonlyArray<LlmMessage>, opts?: GenerateTextOptions): Promise<LlmMessage> {
		const description = opts?.id ?? '';
		return await withActiveSpan(`codex exec ${description}`, async (span) => {
			const prompt = this.buildPrompt(messages);
			const requestTime = Date.now();
			span.setAttributes({
				description,
				model: this.getServiceModelId(),
				service: this.service,
				inputChars: prompt.length,
			});

			const settingsToSave = { ...opts };
			settingsToSave.abortSignal = undefined;

			const createLlmCallRequest: CreateLlmRequest = {
				messages: cloneAndTruncateBuffers(Array.from(messages)),
				llmId: this.getId(),
				description,
				settings: settingsToSave,
				agentId: agentContext()?.agentId,
				callStack: callStack(),
			};

			const llmCall = await this.saveLlmCallRequest(createLlmCallRequest);

			try {
				const execResult = await this.executeCodex(prompt, requestTime, opts?.abortSignal);
				const costs = this.calculateCosts(execResult.usage.inputTokens, execResult.usage.outputTokens, execResult.usage.cachedInputTokens);

				const stats: GenerationStats = {
					llmId: this.getId(),
					requestTime,
					totalTime: execResult.totalTime,
					timeToFirstToken: execResult.timeToFirstToken,
					inputTokens: execResult.usage.inputTokens,
					outputTokens: execResult.usage.outputTokens,
					cachedInputTokens: execResult.usage.cachedInputTokens,
					cost: costs.totalCost,
					finishReason: 'stop',
				};

				const message: LlmMessage = {
					role: 'assistant',
					content: execResult.text,
					stats,
				};

				llmCall.messages = [...llmCall.messages, cloneAndTruncateBuffers(message)];
				llmCall.timeToFirstToken = stats.timeToFirstToken;
				llmCall.totalTime = stats.totalTime;
				llmCall.inputTokens = stats.inputTokens;
				llmCall.outputTokens = stats.outputTokens;
				llmCall.cost = stats.cost ?? undefined;

				if (stats.cost) addCost(stats.cost);

				span.setAttributes({
					inputTokens: stats.inputTokens,
					outputTokens: stats.outputTokens,
					cachedInputTokens: stats.cachedInputTokens ?? 0,
					cost: stats.cost ?? 0,
					threadId: execResult.threadId ?? '',
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

	protected apiKey(): string | undefined {
		return process.env.CODEX_API_KEY?.trim();
	}

	private buildPrompt(messages: ReadonlyArray<LlmMessage>): string {
		if (!messages.length) throw new Error('No messages supplied to Codex CLI');

		const systemSegments = messages.filter((msg) => msg.role === 'system');
		const systemPrompt =
			systemSegments.length > 0
				? systemSegments
						.map((msg) => messageText(msg))
						.filter(Boolean)
						.join('\n')
						.trim()
				: '';

		let lastUserIndex = -1;
		for (let i = messages.length - 1; i >= 0; i--) {
			if (messages[i]!.role === 'user') {
				lastUserIndex = i;
				break;
			}
		}
		if (lastUserIndex === -1) throw new Error('Codex CLI requires at least one user message');

		const finalUserMessage = messages[lastUserIndex]!;
		const finalUserMessageText = messageText(finalUserMessage).trim();
		const historyMessages = messages.filter((_, idx) => idx < lastUserIndex && messages[idx]!.role !== 'system');
		const conversation = historyMessages
			.map((msg) => `${this.friendlyRole(msg.role)}: ${messageText(msg).trim()}`)
			.filter((line) => line.trim().length > 0)
			.join('\n');

		const sections: string[] = [];
		if (systemPrompt) sections.push(`System instructions:\n${systemPrompt}`);
		if (conversation) sections.push(`Conversation so far:\n${conversation}`);
		sections.push(`Task:\n${finalUserMessageText || '(no text provided)'}`);

		return sections.join('\n\n').trim();
	}

	private friendlyRole(role: LlmMessage['role']): string {
		switch (role) {
			case 'assistant':
				return 'Assistant';
			case 'user':
				return 'User';
			case 'system':
				return 'System';
			default:
				return role;
		}
	}

	private executeCodex(prompt: string, requestTime: number, abortSignal?: AbortSignal): Promise<CodexExecResult> {
		return new Promise((resolve, reject) => {
			const args = ['exec', '-m', this.getServiceModelId(), '--json', prompt];
			const env = { ...process.env };
			const apiKey = this.apiKey();
			if (apiKey) env.CODEX_API_KEY = apiKey;

			const proc = spawn('codex', args, { env });

			let stderr = '';
			let stdoutBuffer = '';
			let aggregatedMessage = '';
			let firstTokenTimestamp = 0;
			let inputTokens = 0;
			let outputTokens = 0;
			let cachedInputTokens = 0;
			let threadId: string | undefined;
			let rejected = false;

			const cleanupAbort = () => {
				if (!abortSignal) return;
				abortSignal.removeEventListener('abort', onAbort);
			};

			const onAbort = () => {
				rejected = true;
				proc.kill('SIGINT');
				reject(new Error('Codex exec aborted'));
			};

			if (abortSignal) {
				if (abortSignal.aborted) {
					onAbort();
					return;
				}
				abortSignal.addEventListener('abort', onAbort);
			}

			proc.stdout.on('data', (data: Buffer) => {
				if (!firstTokenTimestamp) firstTokenTimestamp = Date.now();
				stdoutBuffer += data.toString();
				const lines = stdoutBuffer.split(/\r?\n/);
				stdoutBuffer = lines.pop() ?? '';

				for (const line of lines) {
					if (!line.trim()) continue;
					try {
						this.consumeEvent(JSON.parse(line) as CodexEvent, {
							onThreadId: (id) => {
								threadId = id;
							},
							onText: (text) => {
								if (text) aggregatedMessage = text;
							},
							onUsage: (usage) => {
								inputTokens = usage.input_tokens ?? inputTokens;
								outputTokens = usage.output_tokens ?? outputTokens;
								cachedInputTokens = usage.cached_input_tokens ?? cachedInputTokens;
							},
							onError: (message) => {
								rejected = true;
								proc.kill('SIGINT');
								reject(new Error(message));
							},
						});
					} catch (error) {
						logger.debug({ line }, 'Skipping Codex CLI line that is not JSON');
					}
				}
			});

			proc.stderr.on('data', (data: Buffer) => {
				const chunk = data.toString();
				stderr += chunk;
				logger.debug({ chunk }, 'Codex CLI stderr');
			});

			proc.on('error', (error) => {
				cleanupAbort();
				if (!rejected) reject(new Error(`Failed to start Codex CLI: ${error.message}`));
			});

			proc.on('close', (code) => {
				cleanupAbort();
				if (rejected) return;
				const finishTime = Date.now();
				if (code !== 0) {
					const errorMessage = stderr.trim() || `Codex CLI exited with code ${code}`;
					reject(new Error(errorMessage));
					return;
				}

				const text = aggregatedMessage.trim();
				if (!text) {
					reject(new Error('Codex CLI did not return an agent message'));
					return;
				}
				resolve({
					text,
					usage: {
						inputTokens,
						outputTokens,
						cachedInputTokens,
					},
					threadId,
					timeToFirstToken: (firstTokenTimestamp || finishTime) - requestTime,
					totalTime: finishTime - requestTime,
				});
			});
		});
	}

	private consumeEvent(
		event: CodexEvent,
		handlers: {
			onThreadId(id: string): void;
			onText(text: string): void;
			onUsage(usage: CodexUsageEvent): void;
			onError(message: string): void;
		},
	) {
		switch (event.type) {
			case 'thread.started':
				if (event.thread_id) handlers.onThreadId(event.thread_id);
				break;
			case 'item.completed':
				if (event.item?.type === 'agent_message') handlers.onText(this.extractItemText(event.item));
				break;
			case 'turn.completed':
				if (event.usage) handlers.onUsage(event.usage);
				break;
			case 'error':
				handlers.onError(event.message ?? event.error?.message ?? 'Codex exec reported an error');
				break;
			default:
				break;
		}
	}

	private extractItemText(item: CodexItemEvent): string {
		if (item.text) return item.text;
		if (item.delta?.text) return item.delta.text;
		if (item.content && Array.isArray(item.content)) {
			return item.content
				.map((part) => part.text)
				.filter((text): text is string => Boolean(text))
				.join('\n');
		}
		return '';
	}

	// Lazy load to fix dependency cycle
	private _appContextModule: typeof import('#app/applicationContext') | undefined;
	private appContext(): ApplicationContext {
		this._appContextModule ??= require('#app/applicationContext');
		if (!this._appContextModule) throw new Error('appContext not initialized');
		return this._appContextModule.appContext();
	}

	private async saveLlmCallRequest(llmCall: CreateLlmRequest): Promise<LlmCall> {
		try {
			return await this.appContext().llmCallService.saveRequest(llmCall);
		} catch {
			return {
				...llmCall,
				id: randomUUID(),
				requestTime: Date.now(),
			};
		}
	}

	private async saveLlmCallResponse(llmCall: LlmCall) {
		try {
			await this.appContext().llmCallService.saveResponse(llmCall);
		} catch (error) {
			logger.error(error);
		}
	}
}
