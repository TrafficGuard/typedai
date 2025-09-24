import type { TextStreamPart } from 'ai';
import { BaseLLM } from '#llm/base-llm';
import { openaiGPT5, openaiGPT5mini, openaiGPT5nano } from '#llm/services/openai';
import { logger } from '#o11y/logger';
import type { GenerateTextOptions, GenerationStats, LLM, LlmCostFunction, LlmMessage } from '#shared/llm/llm.model';
import { sleep } from '#utils/async-utils';

export const OPENAI_FLEX_SERVICE = 'openai_flex';

const DEFAULT_FLEX_TIMEOUT_MS = 5 * 60 * 1000; // default 5 minutes

export function openAIFlexLLMRegistry(): Array<() => LLM> {
	return [openAIFlexGPT5, openAIFlexGPT5Mini];
}

export function openAIFlexGPT5(): LLM {
	return new OpenAIFlex('GPT5 Flex', 'gpt-5', openaiGPT5(), openaiGPT5('flex'));
}

export function openAIFlexGPT5Mini(): LLM {
	return new OpenAIFlex('GPT5 Mini Flex', 'gpt-5-mini', openaiGPT5mini(), openaiGPT5mini('flex'));
}

// export function openAIFlexGPT5Nano(): LLM {
// 	return new OpenAIFlex('GPT5 Nano Flex', 'gpt-5-nano', openaiGPT5nano(), openaiGPT5nano('flex'));
// }

/**
 * Flex processing

Beta

=======================

Optimize costs with flex processing.

Flex processing provides lower costs for [Responses](/docs/api-reference/responses) or [Chat Completions](/docs/api-reference/chat) requests in exchange for slower response times and occasional resource unavailability. It's ideal for non-production or lower priority tasks, such as model evaluations, data enrichment, and asynchronous workloads.

Tokens are [priced](/docs/pricing) at [Batch API rates](/docs/guides/batch), with additional discounts from [prompt caching](/docs/guides/prompt-caching).

Flex processing is in beta and currently only available for [GPT-5](/docs/models/gpt-5), [o3](/docs/models/o3), and [o4-mini](/docs/models/o4-mini) models.

API usage
---------

To use Flex processing, set the `service_tier` parameter to `flex` in your API request:

Flex processing example

```javascript
import OpenAI from "openai";
const client = new OpenAI({
    timeout: 15 * 1000 * 60, // Increase default timeout to 15 minutes
});

const response = await client.responses.create({
    model: "o3",
    instructions: "List and describe all the metaphors used in this book.",
    input: "<very long text of book here>",
    service_tier: "flex",
}, { timeout: 15 * 1000 * 60 });

console.log(response.output_text);
```

#### API request timeouts

Due to slower processing speeds with Flex processing, request timeouts are more likely. Here are some considerations for handling timeouts:

*   **Default timeout**: The default timeout is **10 minutes** when making API requests with an official OpenAI SDK. You may need to increase this timeout for lengthy prompts or complex tasks.
*   **Configuring timeouts**: Each SDK will provide a parameter to increase this timeout. In the Python and JavaScript SDKs, this is `timeout` as shown in the code samples above.
*   **Automatic retries**: The OpenAI SDKs automatically retry requests that result in a `408 Request Timeout` error code twice before throwing an exception.

Resource unavailable errors
---------------------------

Flex processing may sometimes lack sufficient resources to handle your requests, resulting in a `429 Resource Unavailable` error code. **You will not be charged when this occurs.**

Consider implementing these strategies for handling resource unavailable errors:

*   **Retry requests with exponential backoff**: Implementing exponential backoff is suitable for workloads that can tolerate delays and aims to minimize costs, as your request can eventually complete when more capacity is available. For implementation details, see [this cookbook](https://cookbook.openai.com/examples/how_to_handle_rate_limits?utm_source=chatgpt.com#retrying-with-exponential-backoff).
    
*   **Retry requests with standard processing**: When receiving a resource unavailable error, implement a retry strategy with standard processing if occasional higher costs are worth ensuring successful completion for your use case. To do so, set `service_tier` to `auto` in the retried request, or remove the `service_tier` parameter to use the default mode for the project.
 */

export class OpenAIFlex extends BaseLLM {
	private readonly flexTimeoutMs: number;

	constructor(
		displayName: string,
		model: string,
		private standardLLM: LLM,
		private flexLLM: LLM,
		timeoutMs?: number, // optional override for total flex retry window
	) {
		super({
			displayName,
			service: OPENAI_FLEX_SERVICE,
			modelId: model,
			maxInputTokens: standardLLM.getMaxInputTokens(),
			calculateCosts: () => ({
				inputCost: 0,
				outputCost: 0,
				totalCost: 0,
			}),
		});
		this.flexTimeoutMs = timeoutMs ?? DEFAULT_FLEX_TIMEOUT_MS;
	}

	protected override supportsGenerateTextFromMessages(): boolean {
		return true;
	}

	override isConfigured(): boolean {
		return openaiGPT5().isConfigured();
	}

	override async generateTextFromMessages(messages: LlmMessage[], opts?: GenerateTextOptions): Promise<string> {
		const start = Date.now();
		let attempt = 0;
		let backoff = 1000; // start 1s
		const maxBackoff = 16_000; // cap 16s

		while (Date.now() - start < this.flexTimeoutMs) {
			attempt++;
			try {
				// Ensure provider-specific timeout for this attempt does not exceed remaining time
				const elapsed = Date.now() - start;
				const remaining = Math.max(0, this.flexTimeoutMs - elapsed);

				// Clone options and ensure providerOptions.openai.timeout is set to remaining (if consumer hasn't already set a smaller timeout)
				const attemptOpts: GenerateTextOptions = { ...(opts ?? {}) };
				attemptOpts.providerOptions = { ...(opts?.providerOptions ?? {}) };
				attemptOpts.providerOptions.openai = { ...(attemptOpts.providerOptions.openai ?? {}) };

				// If no explicit timeout was specified, set it to remaining ms for this attempt.
				// If consumer set a timeout smaller than remaining, respect it.
				if (typeof attemptOpts.providerOptions.openai.timeout !== 'number') {
					attemptOpts.providerOptions.openai.timeout = remaining;
				} else {
					attemptOpts.providerOptions.openai.timeout = Math.min(attemptOpts.providerOptions.openai.timeout, remaining);
				}

				return await this.flexLLM.generateText(messages, attemptOpts);
			} catch (err: any) {
				// If 429/resource-unavailable => retry until flexTimeoutMs
				if (is429Error(err)) {
					const elapsed = Date.now() - start;
					if (elapsed >= this.flexTimeoutMs) {
						// timed out trying flex
						logger.info(`Flex provider ${this.flexLLM.getDisplayName()} timed out after ${elapsed}ms; falling back to standard provider.`);
						break;
					}
					// wait with backoff but not longer than remaining time
					const wait = Math.min(backoff, Math.max(0, this.flexTimeoutMs - elapsed));
					logger.warn(`Flex provider ${this.flexLLM.getDisplayName()} returned 429 (attempt ${attempt}). Retrying in ${wait}ms...`);
					await sleep(wait);
					backoff = Math.min(backoff * 2, maxBackoff);
					continue;
				}

				// Non-429 error: immediately fallback to standard provider, but compute remaining time and pass it as timeout
				logger.error(`Flex provider ${this.flexLLM.getDisplayName()} failed with error: ${err?.message ?? err}. Falling back to standard provider.`);
				const elapsed = Date.now() - start;
				const remaining = Math.max(0, this.flexTimeoutMs - elapsed);

				const standardOpts: GenerateTextOptions = { ...(opts ?? {}) };
				standardOpts.providerOptions = { ...(opts?.providerOptions ?? {}) };
				standardOpts.providerOptions.openai = { ...(standardOpts.providerOptions.openai ?? {}) };
				// give standard provider the remaining allowable time (if any). If remaining==0, don't override a consumer timeout.
				if (remaining > 0 && typeof standardOpts.providerOptions.openai.timeout !== 'number') {
					standardOpts.providerOptions.openai.timeout = remaining;
				}
				return await this.standardLLM.generateText(messages, standardOpts);
			}
		}

		// If loop exits (due to timeout), fall back to standard provider and supply remaining time (likely 0)
		const elapsed = Date.now() - start;
		const remaining = Math.max(0, this.flexTimeoutMs - elapsed);
		logger.info(`Flex provider attempts exhausted after ${elapsed}ms; falling back to standard provider.`);

		const finalOpts: GenerateTextOptions = { ...(opts ?? {}) };
		finalOpts.providerOptions = { ...(opts?.providerOptions ?? {}) };
		finalOpts.providerOptions.openai = { ...(finalOpts.providerOptions.openai ?? {}) };
		if (remaining > 0 && typeof finalOpts.providerOptions.openai.timeout !== 'number') {
			finalOpts.providerOptions.openai.timeout = remaining;
		}
		return await this.standardLLM.generateText(messages, finalOpts);
	}

	/**
	 * Stream from flex provider, but if no chunk arrives within flexTimeoutMs,
	 * start standard provider and stream from whichever delivers first.
	 * The "losing" stream is ignored (not canceled).
	 */
	override async streamText(
		messages: LlmMessage[] | ReadonlyArray<LlmMessage>,
		onChunk: (chunk: TextStreamPart<any>) => void,
		opts?: GenerateTextOptions,
	): Promise<GenerationStats> {
		const start = Date.now();
		let selected: 'flex' | 'standard' | null = null;

		// Kick off flex stream immediately
		const flexPromise = this.flexLLM.streamText(
			messages as LlmMessage[],
			(chunk) => {
				if (selected === null) selected = 'flex';
				if (selected === 'flex') onChunk(chunk);
			},
			opts,
		);

		let standardStarted = false;
		let standardPromise: Promise<GenerationStats> | undefined;

		const startStandard = () => {
			if (standardStarted) return;
			standardStarted = true;
			standardPromise = this.standardLLM.streamText(
				messages as LlmMessage[],
				(chunk) => {
					if (selected === null) selected = 'standard';
					if (selected === 'standard') onChunk(chunk);
				},
				opts,
			);
		};

		// Hedge: give flex up to flexTimeoutMs to deliver first chunk
		const elapsed = Date.now() - start;
		const remaining = Math.max(0, this.flexTimeoutMs - elapsed);
		const hedgeTimer = setTimeout(() => {
			if (selected === null) startStandard();
		}, remaining);

		try {
			// Wait for whichever selected stream completes
			const stats = await new Promise<GenerationStats>((resolve, reject) => {
				flexPromise
					.then((s) => {
						if (selected === 'flex' || (selected === null && !standardStarted)) {
							selected = 'flex';
							resolve(s);
						}
					})
					.catch((err) => {
						// If flex fails before selection, start standard immediately
						if (selected === null && !standardStarted) {
							startStandard();
						}
						// Only reject if standard is not running/selected
						if (selected !== 'standard') {
							// Do not reject yet; wait for standard if available
							// no-op here
						}
					});

				const waitStandard = async () => {
					if (!standardStarted) return;
					try {
						const s = await standardPromise!;
						if (selected === 'standard') {
							resolve(s);
						} else if (selected === null) {
							selected = 'standard';
							resolve(s);
						}
					} catch (e) {
						if (selected !== 'flex') {
							reject(e);
						}
					}
				};

				// Poll for when standard starts
				const checkInterval = setInterval(() => {
					if (standardStarted) {
						clearInterval(checkInterval);
						waitStandard();
					}
				}, 10);
			});

			return stats;
		} finally {
			clearTimeout(hedgeTimer);
		}
	}
}

function is429Error(err: any): boolean {
	if (!err) return false;
	if (err.status === 429 || err.statusCode === 429) return true;
	if (err.response && (err.response.status === 429 || err.response.statusCode === 429)) return true;
	// Some providers use specific codes/messages for resource unavailable
	if (err.code === 'RESOURCE_UNAVAILABLE' || err.code === '429') return true;
	const msg = (err.message || '').toString().toLowerCase();
	if (/resource.*unavailable|rate.*limit|too many requests|429/.test(msg)) return true;
	return false;
}
