import { FastMediumLLM } from '#llm/multi-agent/fastMedium';
import { MAD_Balanced, MAD_Fast, MAD_SOTA } from '#llm/multi-agent/reasoning-debate';
import { Claude4_1_Opus_Vertex } from '#llm/services/anthropic-vertex';
import { cerebrasQwen3_235b_Thinking, cerebrasQwen3_Coder } from '#llm/services/cerebras';
import { defaultLLMs } from '#llm/services/defaultLlms';
import { openaiGPT5, openaiGPT5flex, openaiGPT5mini, openaiGPT5nano, openaiGPT5priority } from '#llm/services/openai';
import { perplexityDeepResearchLLM, perplexityLLM, perplexityReasoningProLLM } from '#llm/services/perplexity-llm';
import { xai_Grok4 } from '#llm/services/xai';
import { LLM } from '#shared/llm/llm.model';

export const LLM_CLI_ALIAS: Record<string, () => LLM> = {
	e: () => defaultLLMs().easy,
	m: () => defaultLLMs().medium,
	h: () => defaultLLMs().hard,
	xh: () => defaultLLMs().xhard!,
	fm: () => new FastMediumLLM(),
	f: cerebrasQwen3_235b_Thinking,
	cc: cerebrasQwen3_Coder,
	x: xai_Grok4,
	g5: openaiGPT5,
	g5p: openaiGPT5priority,
	g5f: openaiGPT5flex,
	gpt5: openaiGPT5,
	g5m: openaiGPT5mini,
	g5n: openaiGPT5nano,
	madb: MAD_Balanced,
	mads: MAD_SOTA,
	madf: MAD_Fast,
	opus: Claude4_1_Opus_Vertex,
	pp1: perplexityLLM,
	pp2: perplexityReasoningProLLM,
	pp3: perplexityDeepResearchLLM,
};
