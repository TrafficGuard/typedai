import { type AnthropicProvider, createAnthropic } from '@ai-sdk/anthropic';
import type { CoreMessage } from 'ai'; // Added import
import { AiLLM } from '#llm/services/ai-llm';
import type { AgentLLMs } from '#shared/agent/agent.model';
import type { LLM, LlmCostFunction, LlmMessage } from '#shared/llm/llm.model';
import { currentUser } from '#user/userContext';
import { MultiLLM } from '../multi-llm';

export const ANTHROPIC_SERVICE = 'anthropic';

export function anthropicLLMRegistry(): Record<string, () => LLM> {
	return {
		[`${ANTHROPIC_SERVICE}:claude-3-5-haiku`]: Claude3_5_Haiku,
		[`${ANTHROPIC_SERVICE}:claude-sonnet-4`]: anthropicClaude4_Sonnet,
		[`${ANTHROPIC_SERVICE}:claude-opus-4`]: anthropicClaude4_Opus,
	};
}

export function anthropicClaude4_Opus() {
	return new Anthropic('Claude 4 Opus (Anthropic)', 'claude-opus-4', anthropicCostFunction(15, 75));
}

export function anthropicClaude4_Sonnet() {
	return new Anthropic('Claude 4 Sonnet (Anthropic)', 'claude-sonnet-4', anthropicCostFunction(3, 15));
}

// export function Claude3_5_Sonnet() {
// 	return new Anthropic('Claude 3.5 Sonnet', 'claude-3-5-sonnet-20241022', 3, 15);
// }

// export function Claude3_7_Sonnet() {
// 	return new Anthropic('Claude 3.7 Sonnet', 'claude-3-7-sonnet-latest', 3, 15);
// }

export function Claude3_5_Haiku() {
	return new Anthropic('Claude 3.5 Haiku', 'claude-3-5-haiku-20241022', anthropicCostFunction(1, 5));
}

function anthropicCostFunction(inputMil: number, outputMil: number): LlmCostFunction {
	return (inputTokens: number, outputTokens: number, usage: any) => {
		const metadata = usage as { anthropic: { cacheCreationInputTokens: number; cacheReadInputTokens: number } };
		const inputCost =
			(inputTokens * inputMil) / 1_000_000 +
			(metadata.anthropic.cacheCreationInputTokens * inputMil * 1.25) / 1_000_000 +
			(metadata.anthropic.cacheReadInputTokens * inputMil * 0.1) / 1_000_000;
		const outputCost = (outputTokens * outputMil) / 1_000_000;
		return {
			inputCost,
			outputCost,
			totalCost: inputCost + outputCost,
		};
	};
}

export function ClaudeLLMs(): AgentLLMs {
	const sonnet4 = anthropicClaude4_Sonnet();
	const opus = anthropicClaude4_Opus();
	return {
		easy: Claude3_5_Haiku(),
		medium: sonnet4,
		hard: opus,
		xhard: new MultiLLM([opus], 3),
	};
}

export class Anthropic extends AiLLM<AnthropicProvider> {
	constructor(displayName: string, model: string, calculateCosts: LlmCostFunction) {
		super(displayName, ANTHROPIC_SERVICE, model, 200_000, calculateCosts);
	}

	protected apiKey(): string {
		return currentUser()?.llmConfig.anthropicKey || process.env.ANTHROPIC_API_KEY;
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
