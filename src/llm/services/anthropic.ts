import { type AnthropicProvider, createAnthropic } from '@ai-sdk/anthropic';
import type { CoreMessage } from 'ai'; // Added import
import { AiLLM } from '#llm/services/ai-llm';
import type { AgentLLMs } from '#shared/agent/agent.model';
import type { LLM, LlmCostFunction, LlmMessage } from '#shared/llm/llm.model';
import { currentUser } from '#user/userContext';
import { MultiLLM } from '../multi-llm';

export const ANTHROPIC_SERVICE = 'anthropic';

export function anthropicLLMRegistry(): Array<() => LLM> {
	return [anthropicClaude4_5_Haiku, anthropicClaude4_5_Sonnet, anthropicClaude4_1_Opus];
}

export function anthropicClaude4_1_Opus(): LLM {
	return new Anthropic('Claude 4.1 Opus (Anthropic)', 'claude-opus-4-1-20250805', 200_000, 32_000, anthropicCostFunction(15, 75), ['claude-opus-4-0']);
}

export function anthropicClaude4_5_Sonnet(): LLM {
	return new Anthropic('Claude 4.5 Sonnet (Anthropic)', 'claude-sonnet-4-5-20250929', 200_000, 64_000, anthropicCostFunction(3, 15), ['claude-sonnet-4']);
}

export function anthropicClaude4_5_Haiku(): LLM {
	return new Anthropic('Claude 4.5 Haiku', 'claude-haiku-4-5-20251001', 200_000, 64_000, anthropicCostFunction(1, 5), ['claude-3-5-haiku-20241022']);
}

function anthropicCostFunction(inputMil: number, outputMil: number): LlmCostFunction {
	return (inputTokens: number, outputTokens: number, cachedInputTokens: number, usage: any) => {
		const metadata = usage as { anthropic: { cacheCreationInputTokens: number } };
		const inputCost =
			(inputTokens * inputMil) / 1_000_000 +
			(metadata?.anthropic?.cacheCreationInputTokens ?? 0 * inputMil * 1.25) / 1_000_000 +
			(cachedInputTokens * inputMil * 0.1) / 1_000_000;
		const outputCost = (outputTokens * outputMil) / 1_000_000;
		return {
			inputCost,
			outputCost,
			totalCost: inputCost + outputCost,
		};
	};
}

export function ClaudeLLMs(): AgentLLMs {
	const sonnet4 = anthropicClaude4_5_Sonnet();
	const opus = anthropicClaude4_1_Opus();
	return {
		easy: anthropicClaude4_5_Haiku(),
		medium: sonnet4,
		hard: sonnet4,
		xhard: new MultiLLM([sonnet4], 3),
	};
}

export class Anthropic extends AiLLM<AnthropicProvider> {
	constructor(displayName: string, model: string, maxInputTokens: number, maxOutputTokens: number, calculateCosts: LlmCostFunction, oldIds?: string[]) {
		super({ displayName, service: ANTHROPIC_SERVICE, modelId: model, maxInputTokens, maxOutputTokens, calculateCosts, oldIds });
	}

	protected apiKey(): string | undefined {
		return currentUser()?.llmConfig.anthropicKey?.trim() || process.env.ANTHROPIC_API_KEY;
	}

	protected _preprocessProviderMessages(llmMessages: LlmMessage[]): LlmMessage[] {
		return llmMessages.map((msg) => {
			const clone = { ...msg };
			if (msg.cache === 'ephemeral') {
				clone.providerOptions = { anthropic: { cacheControl: { type: 'ephemeral' } } };
			}
			return clone;
		});
	}

	protected override processMessages(llmMessages: LlmMessage[]): CoreMessage[] {
		const providerSpecificMessages = this._preprocessProviderMessages(llmMessages);
		return super.processMessages(providerSpecificMessages);
	}

	provider(): AnthropicProvider {
		this.aiProvider ??= createAnthropic({
			apiKey: this.apiKey(),
		});
		return this.aiProvider;
	}
}
