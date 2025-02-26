import { AnthropicProvider, createAnthropic } from '@ai-sdk/anthropic';
import { AgentLLMs } from '#agent/agentContextTypes';
import { InputCostFunction, OutputCostFunction, perMilTokens } from '#llm/base-llm';
import { AiLLM } from '#llm/services/ai-llm';
import { currentUser } from '#user/userService/userContext';
import { LLM, LlmMessage } from '../llm';
import { MultiLLM } from '../multi-llm';

export const ANTHROPIC_SERVICE = 'anthropic';

export function anthropicLLMRegistry(): Record<string, () => LLM> {
	return {
		[`${ANTHROPIC_SERVICE}:claude-3-5-haiku`]: Claude3_5_Haiku,
		[`${ANTHROPIC_SERVICE}:claude-3-5-sonnet`]: Claude3_5_Sonnet,
		[`${ANTHROPIC_SERVICE}:claude-3-7-sonnet`]: Claude3_7_Sonnet,
	};
}

export function Claude3_5_Sonnet() {
	return new Anthropic('Claude 3.5 Sonnet', 'claude-3-5-sonnet-20241022', 3, 15);
}

export function Claude3_7_Sonnet() {
	return new Anthropic('Claude 3.7 Sonnet', 'claude-3-7-sonnet-latest', 3, 15);
}

export function Claude3_5_Haiku() {
	return new Anthropic('Claude 3.5 Haiku', 'claude-3-5-haiku-20241022', 1, 5);
}

function inputCostFunction(dollarsPerMillionTokens: number): InputCostFunction {
	return (_: string, tokens: number, metadata: any) =>
		(tokens * dollarsPerMillionTokens) / 1_000_000 +
		(metadata.anthropic.cacheCreationInputTokens * dollarsPerMillionTokens * 1.25) / 1_000_000 +
		(metadata.anthropic.cacheReadInputTokens * dollarsPerMillionTokens * 0.1) / 1_000_000;
}

export function ClaudeLLMs(): AgentLLMs {
	const sonnet35 = Claude3_5_Sonnet();
	return {
		easy: Claude3_5_Haiku(),
		medium: sonnet35,
		hard: sonnet35,
		xhard: new MultiLLM([sonnet35], 5),
	};
}

export class Anthropic extends AiLLM<AnthropicProvider> {
	constructor(displayName: string, model: string, inputMilTokens: number, outputMilTokens: number) {
		super(displayName, ANTHROPIC_SERVICE, model, 200_000, inputCostFunction(inputMilTokens), perMilTokens(outputMilTokens));
	}

	protected apiKey(): string {
		return currentUser().llmConfig.anthropicKey || process.env.ANTHROPIC_API_KEY;
	}

	protected processMessages(llmMessages: LlmMessage[]): LlmMessage[] {
		return llmMessages.map((msg) => {
			const clone = { ...msg };
			if (msg.cache === 'ephemeral') {
				clone.experimental_providerMetadata = { anthropic: { cacheControl: { type: 'ephemeral' } } };
			}
			return clone;
		});
	}

	provider(): AnthropicProvider {
		this.aiProvider ??= createAnthropic({
			apiKey: this.apiKey(),
		});
		return this.aiProvider;
	}
}
