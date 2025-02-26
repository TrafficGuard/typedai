import { AgentLLMs } from '#agent/agentContextTypes';
import { LLM } from '#llm/llm';
import { MultiLLM } from '#llm/multi-llm';
import { Claude3_5_Haiku, Claude3_7_Sonnet } from '#llm/services/anthropic';
import { Claude3_7_Sonnet_Vertex } from '#llm/services/anthropic-vertex';
import { Gemini_2_0_Flash } from '#llm/services/vertexai';

let _summaryLLM: LLM;

export function summaryLLM(): LLM {
	if (!_summaryLLM) defaultLLMs();
	return _summaryLLM;
}

export function defaultLLMs(): AgentLLMs {
	if (process.env.GCLOUD_PROJECT) {
		const flash = Gemini_2_0_Flash();
		const sonnet = Claude3_7_Sonnet_Vertex();
		_summaryLLM = flash;
		return {
			easy: flash,
			medium: sonnet,
			hard: sonnet,
			xhard: sonnet,
		};
	}

	const sonnet37 = Claude3_7_Sonnet();
	_summaryLLM = Claude3_5_Haiku();
	return {
		easy: Claude3_5_Haiku(),
		medium: sonnet37,
		hard: sonnet37,
		xhard: new MultiLLM([sonnet37], 5),
	};
}
