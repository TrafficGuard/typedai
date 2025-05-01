import { InvalidPromptError } from 'ai';
import OpenAI from 'openai';
import { addCost, agentContext } from '#agent/agentContextLocalStorage';
import { Perplexity } from '#functions/web/perplexity';
import type { LlmCall } from '#llm/llmCallService/llmCall';
import { logger as log } from '#o11y/logger';
import { withSpan } from '#o11y/trace';
import { currentUser, functionConfig } from '#user/userService/userContext';
import { envVar } from '#utils/env-var';
import { appContext } from '../../applicationContext';
import { BaseLLM, type LlmCostFunction } from '../base-llm';
import { type GenerateTextOptions, type GenerationStats, type LLM, type LlmMessage, type Prompt, assistant, isSystemUserPrompt, system, user } from '../llm';

export const PERPLEXITY_SERVICE = 'perplexity';

/*
https://docs.perplexity.ai/guides/pricing
Model	Input Tokens (Per Million Tokens)	Output Tokens (Per Million Tokens)	Price per 1000 searches
sonar-reasoning-pro	$2	$8	$5
sonar-reasoning	$1	$5	$5
sonar-pro	$3	$15	$5
sonar	$1	$1	$5
*/

function perplexityCostFunction(inputMil: number, outputMil: number): LlmCostFunction {
	return (inputTokens: number, outputTokens: number, usage: any) => {
		const ppUsage = usage as { num_search_queries?: number; thinking_tokens?: number };
		const searches = ppUsage?.num_search_queries ?? 0;
		const searchCost = searches * 0.005; // $5 per 1000 requests
		const thinkingTokens = ppUsage?.thinking_tokens ?? 0;
		const thinkingCost = (thinkingTokens * 3) / 1_000_000; // Assuming $3/M for thinking tokens

		const inputCost = (inputTokens * inputMil) / 1_000_000;
		const outputCost = (outputTokens * outputMil) / 1_000_000;
		const totalCost = Number((inputCost + outputCost + searchCost + thinkingCost).toFixed(6));

		return {
			inputCost, // Note: This doesn't include search/thinking cost separately
			outputCost, // Note: This doesn't include search/thinking cost separately
			totalCost,
		};
	};
}

export function perplexityLLMRegistry(): Record<string, () => LLM> {
	return {
		[`${PERPLEXITY_SERVICE}:sonar`]: perplexityLLM,
		[`${PERPLEXITY_SERVICE}:sonar-reasoning-pro`]: perplexityReasoningProLLM,
		[`${PERPLEXITY_SERVICE}:sonar-deep-research`]: perplexityDeepResearchLLM,
	};
}

export function perplexityLLM(): LLM {
	return new PerplexityLLM(
		'Perplexity',
		'sonar',
		127_000, // maxTokens
		perplexityCostFunction(1, 1), // $1/M input, $1/M output
	);
}

export function perplexityReasoningProLLM(): LLM {
	return new PerplexityLLM(
		'Perplexity Reasoning Pro',
		'sonar-reasoning-pro',
		127_000, // maxTokens
		perplexityCostFunction(2, 8), // $2/M input, $8/M output
	);
}

export function perplexityDeepResearchLLM(): LLM {
	return new PerplexityLLM(
		'Perplexity Deep Research',
		'sonar-deep-research',
		60_000, // maxTokens
		perplexityCostFunction(2, 8), // $2/M input, $8/M output
	);
}

export class PerplexityLLM extends BaseLLM {
	private openai: OpenAI;

	constructor(displayName: string, model: string, maxTokens: number, calculateCosts: LlmCostFunction) {
		super(displayName, PERPLEXITY_SERVICE, model, maxTokens, calculateCosts);
	}

	private api(): OpenAI {
		this.openai ??= new OpenAI({
			apiKey: functionConfig(Perplexity).key || envVar('PERPLEXITY_KEY'),
			baseURL: 'https://api.perplexity.ai',
		});
		return this.openai;
	}

	isConfigured(): boolean {
		return Boolean(functionConfig(Perplexity)?.key || process.env.PERPLEXITY_KEY);
	}

	/** Generate a LlmMessage response */
	async generateMessage(prompt: Prompt, opts?: GenerateTextOptions): Promise<LlmMessage> {
		let messages: ReadonlyArray<LlmMessage>;
		// Normalize the different prompt types into an array of LlmMessage
		if (typeof prompt === 'string') {
			messages = [user(prompt)];
		} else if (isSystemUserPrompt(prompt)) {
			messages = [system(prompt[0]), user(prompt[1])];
		} else {
			// Prompt is already LlmMessage[] or ReadonlyArray<LlmMessage>
			messages = prompt; // Directly assign if it's already the correct array type
		}
		// Delegate to the internal implementation that handles the API call and processing
		return this._generateMessage(messages, opts);
	}

	protected supportsGenerateTextFromMessages(): boolean {
		// Although _generateMessage handles message arrays, the primary generateText methods
		// in BaseLLM might rely on _generateText(system, user). Keeping this false maintains
		// consistency unless generateText is refactored to use _generateMessage.
		return false;
	}

	protected _generateMessage(messages: ReadonlyArray<LlmMessage>, opts?: GenerateTextOptions): Promise<LlmMessage> {
		const description = opts?.id ?? '';
		return withSpan(`generateText ${description}`, async (span) => {
			// Perplexity only support string content, convert TextPart's to string, fail if any FilePart or ImagePart are found
			const apiMessages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = messages.map((m) => {
				let content = '';
				if (typeof m.content === 'string') content = m.content;
				else {
					for (const item of m.content) {
						if (item.type === 'text') {
							content += item.text;
						} else {
							let mimeType = '<unknown>';
							if (item.type === 'file') mimeType = item.mimeType;
							if (item.type === 'image') mimeType = item.mimeType;
							throw new InvalidPromptError({ message: `Perplexity only support text messages. Messages contain ${mimeType}`, prompt: '' });
						}
					}
				}
				if (m.role !== 'user' && m.role !== 'assistant' && m.role !== 'system')
					throw new InvalidPromptError({ prompt: '', message: 'Only user, assistant and system roles are supported' });
				return {
					role: m.role,
					content: content,
				};
			});

			// Get system prompt and user prompt for logging
			const systemMessage = apiMessages.find((m) => m.role === 'system');
			const lastUserMessage = apiMessages.findLast((message) => message.role === 'user');

			if (systemMessage) span.setAttribute('systemPrompt', systemMessage.content as string);
			span.setAttributes({
				userPrompt: lastUserMessage?.content as string,
				inputChars: apiMessages.reduce((acc, m) => acc + (m.content as string).length, 0),
				model: this.model,
				service: this.service,
				description,
			});

			const llmCallSave: Promise<LlmCall> = appContext().llmCallService.saveRequest({
				messages,
				llmId: this.getId(),
				userId: currentUser().id,
				agentId: agentContext()?.agentId,
				callStack: this.callStack(agentContext()),
				description,
			});
			const requestTime = Date.now();

			try {
				const response = await this.api().chat.completions.create({
					model: this.model,
					messages: apiMessages,
					stream: false,
				});

				const promptTokens = response.usage?.prompt_tokens ?? 0;
				const completionTokens = response.usage?.completion_tokens ?? 0;
				const ppUsage = response.usage as any;
				const citationTokens = ppUsage?.citation_tokens ?? 0;
				const searches = ppUsage?.num_search_queries ?? 0;
				const searchCost = searches * 0.005; // $5 per 1000 requests
				// https://docs.perplexity.ai/guides/pricing#detailed-pricing-breakdown-for-sonar-deep-research
				const thinkingTokens = ppUsage?.thinking_tokens ?? 0;

				const { totalCost } = this.calculateCosts(promptTokens, completionTokens, ppUsage);
				const cost = totalCost;
				addCost(cost);

				const timeToFirstToken = Date.now() - requestTime;
				const finishTime = Date.now();

				const citations: string[] = (response as any).citations;
				const citationContent = !citations.length ? '' : `\nCitations:\n${citations.map((value, index) => `\n[${index + 1}] ${value}`).join('')}`;

				const responseText = response.choices[0].message.content + citationContent;

				const llmCall: LlmCall = await llmCallSave;
				llmCall.messages = [...messages, assistant(responseText)];
				llmCall.timeToFirstToken = timeToFirstToken;
				llmCall.totalTime = finishTime - requestTime;
				llmCall.cost = cost;

				const stats: GenerationStats = {
					llmId: this.getId(),
					cost,
					inputTokens: promptTokens,
					outputTokens: completionTokens,
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
					await appContext().llmCallService.saveResponse(llmCall);
				} catch (e) {
					// queue to save
					console.error(e);
				}

				span.setAttributes({
					response: responseText,
					timeToFirstToken,
					promptTokens,
					completionTokens,
					searches,
					cost,
					outputChars: responseText.length,
				});
				if (thinkingTokens) span.setAttribute('thinkingTokens', thinkingTokens);

				return message;
			} catch (e) {
				log.error(e, `Perplexity error during generateMessage. Messages: ${JSON.stringify(messages)}`);
				throw e;
			}
		});
	}
}

export function convertCitationsToMarkdownLinks(reportText: string, citations: string[]): string {
	// Create a regex pattern to match citation IDs in the report text
	const citationPattern = /\[(\d+)]/g;

	// Replace each citation ID with a markdown link
	return reportText.replace(citationPattern, (match, id) => {
		const citationId = Number.parseInt(id, 10) - 1; // Convert the matched ID to a number and subtract 1 (since array indices start at 0)
		if (citationId >= 0 && citationId < citations.length) {
			// If the citation ID is valid, replace the ID with a markdown link
			return `[${citations[citationId]}](#${citationId + 1})`;
		}
		// If the citation ID is not valid, return the original match to keep the text unchanged
		return match;
	});
}
