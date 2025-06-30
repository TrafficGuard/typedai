import { openai } from '@ai-sdk/openai';
import { FastMediumLLM } from '#llm/multi-agent/fastMedium';
import { MAD_Balanced } from '#llm/multi-agent/reasoning-debate';
import { MultiLLM } from '#llm/multi-llm';
import { Claude3_5_Haiku, anthropicClaude4_Opus, anthropicClaude4_Sonnet } from '#llm/services/anthropic';
import { vertexGemini_2_0_Flash_Lite, vertexGemini_2_5_Flash, vertexGemini_2_5_Pro } from '#llm/services/vertexai';
import type { AgentLLMs } from '#shared/agent/agent.model';
import type { LLM } from '#shared/llm/llm.model';
import { Ollama_LLMs } from './ollama';
import { openAIo3, openAIo4mini, openaiGPT41, openaiGPT41mini } from './openai';

let _summaryLLM: LLM;

export function summaryLLM(): LLM {
	_summaryLLM ??= defaultLLMs().easy;
	return _summaryLLM;
}

export function defaultLLMs(): AgentLLMs {
	const o3 = openAIo3();
	const gemini25Pro = vertexGemini_2_5_Pro();
	const sonnet4 = anthropicClaude4_Sonnet();

	if (gemini25Pro.isConfigured()) {
		const flashLite = vertexGemini_2_0_Flash_Lite();
		const flash = vertexGemini_2_5_Flash();

		_summaryLLM = flashLite;
		return {
			easy: flashLite,
			medium: new FastMediumLLM(),
			hard: gemini25Pro,
			xhard: null,
		};
	}

	if (sonnet4.isConfigured()) {
		_summaryLLM = Claude3_5_Haiku();
		const opus = anthropicClaude4_Opus();
		return {
			easy: _summaryLLM,
			medium: sonnet4,
			hard: opus,
			xhard: new MultiLLM([opus], 3),
		};
	}

	if (o3.isConfigured()) {
		_summaryLLM = openaiGPT41mini();
		return {
			easy: _summaryLLM,
			medium: openaiGPT41(),
			hard: o3,
			xhard: new MultiLLM([o3], 3),
		};
	}

	if (process.env.OLLAMA_API_URL) {
		return Ollama_LLMs();
	}

	throw new Error('No default LLMs configured');
}
