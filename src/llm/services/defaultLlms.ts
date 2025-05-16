import { FastMediumLLM } from '#llm/multi-agent/fastMedium';
import { MultiLLM } from '#llm/multi-llm';
import { Claude3_5_Haiku, Claude3_7_Sonnet } from '#llm/services/anthropic';
import { vertexGemini_2_0_Flash_Lite, vertexGemini_2_5_Flash, vertexGemini_2_5_Pro } from '#llm/services/vertexai';
import type { AgentLLMs } from '#shared/model/agent.model';
import type { LLM } from '#shared/model/llm.model';

let _summaryLLM: LLM;

export function summaryLLM(): LLM {
	_summaryLLM ??= defaultLLMs().easy;
	return _summaryLLM;
}

export function defaultLLMs(): AgentLLMs {
	if (process.env.GCLOUD_PROJECT) {
		const flashLite = vertexGemini_2_0_Flash_Lite();
		const flash = vertexGemini_2_5_Flash();
		const pro = vertexGemini_2_5_Pro();
		_summaryLLM = flashLite;
		return {
			easy: flashLite,
			medium: new FastMediumLLM(),
			hard: pro,
			xhard: null,
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
