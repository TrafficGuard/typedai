import { AgentLLMs } from '#agent/agentContextTypes';
import { LLM } from '#llm/llm';

import { MultiLLM } from '#llm/multi-llm';
import { Claude3_5_Haiku, Claude3_7_Sonnet } from '#llm/services/anthropic';
import { Gemini_2_0_Flash, Gemini_2_5_Pro } from '#llm/services/vertexai';

let _summaryLLM: LLM;

export function summaryLLM(): LLM {
	if (!_summaryLLM) defaultLLMs();
	return _summaryLLM;
}

export function defaultLLMs(): AgentLLMs {
	if (process.env.GCLOUD_PROJECT) {
		const flash = Gemini_2_0_Flash();
		const pro = Gemini_2_5_Pro();
		_summaryLLM = flash;
		return {
			easy: flash,
			medium: pro,
			hard: pro,
			xhard: pro,
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
