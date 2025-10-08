import { type GoogleVertexAnthropicProvider, createVertexAnthropic } from '@ai-sdk/google-vertex/anthropic';
import { AiLLM } from '#llm/services/ai-llm';
import { logger } from '#o11y/logger';
import type { AgentLLMs } from '#shared/agent/agent.model';
import type { LLM, LlmCostFunction } from '#shared/llm/llm.model';
import { currentUser } from '#user/userContext';
import { envVar } from '#utils/env-var';

export const ANTHROPIC_VERTEX_SERVICE = 'anthropic-vertex';

// https://cloud.google.com/vertex-ai/generative-ai/docs/partner-models/use-claude#anthropic_claude_region_availability

export function anthropicVertexLLMRegistry(): Record<string, () => LLM> {
	return {
		[`${ANTHROPIC_VERTEX_SERVICE}:claude-3-5-haiku`]: Claude3_5_Haiku_Vertex,
		[`${ANTHROPIC_VERTEX_SERVICE}:claude-sonnet-4-5@20250929`]: Claude4_5_Sonnet_Vertex,
		[`${ANTHROPIC_VERTEX_SERVICE}:claude-opus-4-1@20250805`]: Claude4_1_Opus_Vertex,
	};
}

// Supported image types image/jpeg', 'image/png', 'image/gif' or 'image/webp'

// https://cloud.google.com/vertex-ai/generative-ai/pricing#claude-models

// https://cloud.google.com/vertex-ai/generative-ai/docs/partner-models/claude/opus-4-1
export function Claude4_1_Opus_Vertex(): LLM {
	return new AnthropicVertexLLM('Claude 4.1 Opus (Vertex)', 'claude-opus-4-1@20250805', 200_000, 32_000, anthropicCostFunction(15, 75), ['claude-opus-4']);
}

// https://cloud.google.com/vertex-ai/generative-ai/docs/partner-models/claude/sonnet-4-5
export function Claude4_5_Sonnet_Vertex(): LLM {
	return new AnthropicVertexLLM('Claude 4.5 Sonnet (Vertex)', 'claude-sonnet-4-5@20250929', 200_000, 64_000, anthropicCostFunction(3, 15), ['claude-sonnet-4']);
}

// https://cloud.google.com/vertex-ai/generative-ai/docs/partner-models/claude/haiku-3-5
export function Claude3_5_Haiku_Vertex(): LLM {
	return new AnthropicVertexLLM('Claude 3.5 Haiku (Vertex)', 'claude-3-5-haiku@20241022', 200_000, 8_192, anthropicCostFunction(1, 5));
}

export function anthropicCostFunction(inputMil: number, outputMil: number): LlmCostFunction {
	return (inputTokens: number, outputTokens: number, cachedInputTokens: number, usage: any) => {
		const anthropicUsage = usage?.anthropic;
		console.log(usage);
		console.log(anthropicUsage);
		const inputCost =
			(inputTokens * inputMil) / 1_000_000 +
			(anthropicUsage?.cacheCreationInputTokens ?? 0 * inputMil * 1.25) / 1_000_000 +
			(cachedInputTokens * inputMil * 0.1) / 1_000_000;
		const outputCost = (outputTokens * outputMil) / 1_000_000;
		logger.debug(
			`Anthropic usage. Input: ${inputTokens}. Cache creation: ${anthropicUsage?.cacheCreationInputTokens}. Cache read: ${anthropicUsage?.cacheReadInputTokens}. Output: ${outputTokens}`,
		);
		return {
			inputCost,
			outputCost,
			totalCost: inputCost + outputCost,
		};
	};
}

export function ClaudeVertexLLMs(): AgentLLMs {
	return {
		easy: Claude3_5_Haiku_Vertex(),
		medium: Claude4_5_Sonnet_Vertex(),
		hard: Claude4_5_Sonnet_Vertex(),
		xhard: Claude4_1_Opus_Vertex(),
	};
}

const GCLOUD_PROJECTS: string[] = [];

if (process.env.GCLOUD_PROJECT) GCLOUD_PROJECTS.push(process.env.GCLOUD_PROJECT);

for (let i = 2; i <= 9; i++) {
	const projectId = process.env[`GCLOUD_PROJECT_${i}`];
	if (!projectId) break;
	GCLOUD_PROJECTS.push(projectId);
}
let gcloudProjectIndex = 0;

/**
 * Vertex AI models - Gemini
 */
class AnthropicVertexLLM extends AiLLM<GoogleVertexAnthropicProvider> {
	constructor(displayName: string, model: string, maxInputToken: number, maxOutputTokens: number, calculateCosts: LlmCostFunction, oldIds?: string[]) {
		super({ displayName, service: ANTHROPIC_VERTEX_SERVICE, modelId: model, maxInputTokens: maxInputToken, maxOutputTokens, calculateCosts, oldIds });
	}

	protected apiKey(): string | undefined {
		return currentUser()?.llmConfig.vertexProjectId || process.env.GCLOUD_PROJECT;
	}

	provider(): GoogleVertexAnthropicProvider {
		let project: string | undefined;
		if (GCLOUD_PROJECTS.length) {
			project = GCLOUD_PROJECTS[gcloudProjectIndex];
			if (++gcloudProjectIndex >= GCLOUD_PROJECTS.length) gcloudProjectIndex = 0;
		} else {
			project = currentUser()?.llmConfig.vertexProjectId || project || envVar('GCLOUD_PROJECT');
		}

		const location = 'global'; //currentUser()?.llmConfig.vertexRegion || process.env.GCLOUD_CLAUDE_REGION || envVar('GCLOUD_REGION');
		this.aiProvider ??= createVertexAnthropic({
			project: project,
			location,
		});

		return this.aiProvider;
	}
}
